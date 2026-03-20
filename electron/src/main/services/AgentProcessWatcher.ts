import { execSync } from 'child_process'
import { BrowserWindow } from 'electron'
import Database from 'better-sqlite3'

/**
 * Monitors:
 * 1. The system process tree to detect the running Claude Code CLI process
 * 2. The MCP audit log to detect recent tool call activity by category
 *
 * Broadcasts state to all renderer windows via IPC every 3 seconds.
 */

export interface AgentInfo {
  pid: number
  parentPid: number
  elapsedSeconds: number
  command: string // "Claude Code" for main process
  isPotentiallyFrozen: boolean
  isIdle: boolean
  agentIndex: number
}

/** A recent burst of MCP tool activity in a specific category */
export interface MCPActivity {
  category: string       // e.g. "Git", "Tasks", "Search", "Browser"
  toolName: string       // most recent tool name in this category
  callCount: number      // how many calls in the activity window
  lastCallAt: string     // ISO timestamp of most recent call
  isActive: boolean      // had activity in the last ACTIVE_WINDOW_SECONDS
}

export interface AgentMonitorState {
  claudeProcess: AgentInfo | null
  agents: AgentInfo[]          // kept for backward compat, always empty now
  mcpActivity: MCPActivity[]   // active MCP tool categories
}

/** How many seconds of recency to consider "active" */
const ACTIVE_WINDOW_SECONDS = 15
/** How many seconds before activity fades out entirely */
const FADE_WINDOW_SECONDS = 60

/** Map MCP tool categories to friendly display labels */
const CATEGORY_LABELS: Record<string, string> = {
  read: 'Reading',
  write: 'Writing',
  git: 'Git',
  browser: 'Browser',
  system: 'System',
}

/** Map specific tool name prefixes to more descriptive labels */
const TOOL_LABELS: [RegExp, string][] = [
  [/^(create_task|update_task|get_task|list_tasks)/, 'Tasks'],
  [/^(create_note|update_note|get_note|list_notes|search_notes|create_task_note)/, 'Notes'],
  [/^(git_|github_)/, 'Git'],
  [/^(browser_|detect_browser)/, 'Browser'],
  [/^(search_code|context_search|get_patterns)/, 'Search'],
  [/^(list_projects|get_current_project|get_project)/, 'Projects'],
  [/^(list_sessions|search_sessions)/, 'Sessions'],
  [/^(generate_image|edit_image|get_image|list_images)/, 'Images'],
  [/^(detect_|get_system_info|get_env|get_project_environment|get_project_profile)/, 'System'],
  [/^(list_clients|create_client)/, 'Clients'],
]

function classifyTool(toolName: string, toolCategory: string | null): string {
  for (const [pattern, label] of TOOL_LABELS) {
    if (pattern.test(toolName)) return label
  }
  return CATEGORY_LABELS[toolCategory ?? ''] || 'MCP'
}

export class AgentProcessWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private state: AgentMonitorState = { claudeProcess: null, agents: [], mcpActivity: [] }
  private db: Database.Database | null = null

  /** Provide the database so we can query the audit log */
  setDatabase(db: Database.Database): void {
    this.db = db
  }

  start(): void {
    if (this.timer) return
    this.poll()
    this.timer = setInterval(() => this.poll(), 3000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.state = { claudeProcess: null, agents: [], mcpActivity: [] }
  }

  getState(): AgentMonitorState {
    return this.state
  }

  private poll(): void {
    try {
      const claudeProcess = this.detectClaudeCode()
      const mcpActivity = this.pollMCPActivity()

      const newState: AgentMonitorState = {
        claudeProcess,
        agents: [],
        mcpActivity,
      }

      const changed = JSON.stringify(newState) !== JSON.stringify(this.state)
      this.state = newState
      if (changed) {
        this.broadcast()
      }
    } catch {
      // Silently ignore polling errors
    }
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('agent:update', this.state)
      } catch {
        // Window may be destroyed
      }
    }
  }

  // ─── Claude Code CLI detection ──────────────────────────────────────────────

  private detectClaudeCode(): AgentInfo | null {
    try {
      const records = this.fetchClaudeProcess()
      if (records.length === 0) return null

      // Find the actual Claude Code CLI (not Claude Desktop)
      // Claude Desktop is at WindowsApps path, Claude Code CLI is at .local/bin
      const cliProcess = records.find(r => {
        const cmd = r.command.toLowerCase()
        // Exclude Claude Desktop (Electron app in WindowsApps)
        if (cmd.includes('windowsapps')) return false
        if (cmd.includes('--type=')) return false // Electron sub-processes
        // Match Claude Code CLI
        return /[\\/]\.local[\\/]bin[\\/]claude/i.test(r.command) ||
               /[\\/]claude(?:\.exe)?"?\s*$/i.test(r.command) ||
               (cmd.includes('claude') && cmd.includes('@anthropic'))
      })

      if (!cliProcess) return null

      const now = new Date()
      const elapsedSeconds = cliProcess.startTime
        ? Math.max(0, Math.floor((now.getTime() - cliProcess.startTime.getTime()) / 1000))
        : 0

      return {
        pid: cliProcess.pid,
        parentPid: cliProcess.ppid,
        elapsedSeconds,
        command: 'Claude Code',
        isPotentiallyFrozen: false,
        isIdle: false,
        agentIndex: 0,
      }
    } catch {
      return null
    }
  }

  // ─── MCP Activity from audit log ────────────────────────────────────────────

  private pollMCPActivity(): MCPActivity[] {
    if (!this.db) return []

    try {
      const rows = this.db.prepare(
        `SELECT toolName, toolCategory, timestamp
         FROM agentAuditLog
         WHERE timestamp > datetime('now', '-' || ? || ' seconds')
         ORDER BY timestamp DESC`
      ).all(FADE_WINDOW_SECONDS) as { toolName: string; toolCategory: string | null; timestamp: string }[]

      if (rows.length === 0) return []

      // Group by display category
      const groups = new Map<string, { toolName: string; count: number; lastCallAt: string }>()
      for (const row of rows) {
        const category = classifyTool(row.toolName, row.toolCategory)
        const existing = groups.get(category)
        if (!existing) {
          groups.set(category, { toolName: row.toolName, count: 1, lastCallAt: row.timestamp })
        } else {
          existing.count++
          // Keep most recent timestamp (rows are ordered DESC)
        }
      }

      const now = Date.now()
      const activities: MCPActivity[] = []
      for (const [category, data] of groups) {
        const lastMs = new Date(data.lastCallAt + 'Z').getTime() // SQLite datetime is UTC
        const ageSeconds = (now - lastMs) / 1000
        activities.push({
          category,
          toolName: data.toolName,
          callCount: data.count,
          lastCallAt: data.lastCallAt,
          isActive: ageSeconds < ACTIVE_WINDOW_SECONDS,
        })
      }

      // Sort: active first, then by most recent
      activities.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
        return new Date(b.lastCallAt).getTime() - new Date(a.lastCallAt).getTime()
      })

      return activities
    } catch {
      return []
    }
  }

  // ─── Platform-specific Claude Code CLI detection ────────────────────────────

  private fetchClaudeProcess(): { pid: number; ppid: number; command: string; startTime: Date | null }[] {
    if (process.platform === 'win32') {
      return this.fetchClaudeWindows()
    }
    return this.fetchClaudeUnix()
  }

  private fetchClaudeWindows(): { pid: number; ppid: number; command: string; startTime: Date | null }[] {
    try {
      const output = execSync(
        'wmic process where "CommandLine like \'%claude%\'" get ProcessId,ParentProcessId,CommandLine,CreationDate /FORMAT:CSV',
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      )

      const records: { pid: number; ppid: number; command: string; startTime: Date | null }[] = []
      const lines = output.trim().split('\n').filter(l => l.trim())
      if (lines.length < 2) return records

      const headerLine = lines.find(l => l.includes('ProcessId') && l.includes('CommandLine'))
      if (!headerLine) return records
      const headerIndex = lines.indexOf(headerLine)

      const headers = headerLine.split(',').map(h => h.trim())
      const cmdIdx = headers.indexOf('CommandLine')
      const dateIdx = headers.indexOf('CreationDate')
      const ppidIdx = headers.indexOf('ParentProcessId')
      const pidIdx = headers.indexOf('ProcessId')

      for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        // Parse from the right side since CommandLine may contain commas
        const rightParts: string[] = []
        let remaining = line
        // Skip Node column
        const firstComma = remaining.indexOf(',')
        if (firstComma === -1) continue
        remaining = remaining.substring(firstComma + 1)

        // Extract right-side columns (CreationDate, ParentProcessId, ProcessId)
        for (let j = 0; j < headers.length - 2; j++) {
          const lastComma = remaining.lastIndexOf(',')
          if (lastComma === -1) break
          rightParts.unshift(remaining.substring(lastComma + 1))
          remaining = remaining.substring(0, lastComma)
        }

        const parts = ['', remaining, ...rightParts] // [Node, CommandLine, ...]
        if (parts.length < headers.length) continue

        const pid = parseInt(parts[pidIdx], 10)
        const ppid = parseInt(parts[ppidIdx], 10)
        const command = parts[cmdIdx] || ''
        const startTime = this.parseWmicDate(parts[dateIdx] || '')

        if (isNaN(pid) || isNaN(ppid)) continue
        records.push({ pid, ppid, command, startTime })
      }
      return records
    } catch {
      return []
    }
  }

  private fetchClaudeUnix(): { pid: number; ppid: number; command: string; startTime: Date | null }[] {
    try {
      const output = execSync('ps -eo pid,ppid,lstart,args', {
        encoding: 'utf8',
        timeout: 5000,
      })

      const records: { pid: number; ppid: number; command: string; startTime: Date | null }[] = []
      const lines = output.trim().split('\n')
      for (let i = 1; i < lines.length; i++) {
        const match = lines[i].match(/^\s*(\d+)\s+(\d+)\s+\w{3}\s+(\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/)
        if (!match) continue
        const command = match[4]
        if (!command.toLowerCase().includes('claude')) continue
        records.push({
          pid: parseInt(match[1], 10),
          ppid: parseInt(match[2], 10),
          startTime: new Date(match[3]),
          command,
        })
      }
      return records
    } catch {
      return []
    }
  }

  private parseWmicDate(dateStr: string): Date | null {
    if (!dateStr || dateStr.length < 14) return null
    try {
      const year = parseInt(dateStr.substring(0, 4), 10)
      const month = parseInt(dateStr.substring(4, 6), 10) - 1
      const day = parseInt(dateStr.substring(6, 8), 10)
      const hour = parseInt(dateStr.substring(8, 10), 10)
      const min = parseInt(dateStr.substring(10, 12), 10)
      const sec = parseInt(dateStr.substring(12, 14), 10)
      return new Date(year, month, day, hour, min, sec)
    } catch {
      return null
    }
  }
}

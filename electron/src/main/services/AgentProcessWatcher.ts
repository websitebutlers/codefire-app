import { execSync } from 'child_process'
import { BrowserWindow } from 'electron'

/**
 * Monitors the system process tree to detect running Claude Code agents.
 *
 * Claude Code spawns background agents (Task tool) as child processes:
 *   shell → node/claude (main) → node/claude (agent 1), node/claude (agent 2)
 *
 * Polls every 3 seconds to detect and track these agents.
 * Broadcasts state to all renderer windows via IPC.
 */

export interface AgentInfo {
  pid: number
  parentPid: number
  elapsedSeconds: number
  command: string // "Claude Code" or "Agent"
  isPotentiallyFrozen: boolean
}

export interface AgentMonitorState {
  claudeProcess: AgentInfo | null
  agents: AgentInfo[]
}

interface ProcRecord {
  pid: number
  ppid: number
  command: string
  startTime: Date | null
  cpuTimeMs: number // cumulative CPU time in milliseconds (kernel + user)
}

/**
 * If an agent sub-process has had zero CPU activity for this many consecutive
 * poll cycles (3s each), it is considered potentially frozen.
 * 10 cycles * 3s = 30 seconds of zero CPU delta → frozen.
 */
const FROZEN_IDLE_CYCLES = 10

export class AgentProcessWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private state: AgentMonitorState = { claudeProcess: null, agents: [] }
  /** Tracks the last known CPU time (ms) per PID for delta comparison */
  private lastCpuTime = new Map<number, number>()
  /** How many consecutive polls each PID has been idle (no CPU delta) */
  private idleCycles = new Map<number, number>()

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
    this.state = { claudeProcess: null, agents: [] }
  }

  getState(): AgentMonitorState {
    return this.state
  }

  private poll(): void {
    try {
      const records = this.fetchProcesses()
      const newState = this.scan(records)
      const changed =
        JSON.stringify(newState) !== JSON.stringify(this.state)
      this.state = newState
      if (changed) {
        this.broadcast()
      }
    } catch (err) {
      // Silently ignore polling errors — process listing can occasionally fail
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

  // ─── Process scanning ───────────────────────────────────────────────────────

  private scan(records: ProcRecord[]): AgentMonitorState {
    if (records.length === 0) {
      this.lastCpuTime.clear()
      this.idleCycles.clear()
      return { claudeProcess: null, agents: [] }
    }

    const now = new Date()

    // Build parent→children map and find all claude-like processes
    const procMap = new Map<number, ProcRecord>()
    const childrenOf = new Map<number, number[]>()
    const claudeProcs: ProcRecord[] = []

    for (const r of records) {
      procMap.set(r.pid, r)
      const siblings = childrenOf.get(r.ppid) || []
      siblings.push(r.pid)
      childrenOf.set(r.ppid, siblings)
      if (this.isClaude(r.command)) {
        claudeProcs.push(r)
      }
    }

    if (claudeProcs.length === 0) {
      this.lastCpuTime.clear()
      this.idleCycles.clear()
      return { claudeProcess: null, agents: [] }
    }

    // Update CPU idle tracking for all detected claude processes
    const seenPids = new Set<number>()
    for (const proc of claudeProcs) {
      seenPids.add(proc.pid)
      const prev = this.lastCpuTime.get(proc.pid)
      this.lastCpuTime.set(proc.pid, proc.cpuTimeMs)
      if (prev !== undefined && proc.cpuTimeMs <= prev) {
        // No CPU activity since last poll → increment idle counter
        this.idleCycles.set(proc.pid, (this.idleCycles.get(proc.pid) ?? 0) + 1)
      } else {
        // CPU activity detected → reset idle counter
        this.idleCycles.set(proc.pid, 0)
      }
    }
    // Clean up entries for processes that no longer exist
    for (const pid of this.lastCpuTime.keys()) {
      if (!seenPids.has(pid)) {
        this.lastCpuTime.delete(pid)
        this.idleCycles.delete(pid)
      }
    }

    // Main claude = oldest PID (first launched)
    claudeProcs.sort((a, b) => a.pid - b.pid)
    const main = claudeProcs[0]

    // Main process is never marked as frozen
    const claudeProcess = this.toAgentInfo(main, now, 'Claude Code', false)

    // Agents = other claude processes that are descendants of the main claude process
    const agents: AgentInfo[] = []
    for (let i = 1; i < claudeProcs.length; i++) {
      const proc = claudeProcs[i]
      if (this.isDescendantOf(proc.pid, main.pid, procMap)) {
        const idle = this.idleCycles.get(proc.pid) ?? 0
        agents.push(this.toAgentInfo(proc, now, 'Agent', idle >= FROZEN_IDLE_CYCLES))
      }
    }

    return { claudeProcess, agents }
  }

  private isDescendantOf(pid: number, ancestorPid: number, procMap: Map<number, ProcRecord>): boolean {
    let cursor = pid
    for (let i = 0; i < 10; i++) {
      const proc = procMap.get(cursor)
      if (!proc) return false
      if (proc.ppid === ancestorPid) return true
      cursor = proc.ppid
    }
    return false
  }

  private toAgentInfo(proc: ProcRecord, now: Date, label: string, frozen: boolean): AgentInfo {
    const elapsedSeconds = proc.startTime
      ? Math.max(0, Math.floor((now.getTime() - proc.startTime.getTime()) / 1000))
      : 0
    return {
      pid: proc.pid,
      parentPid: proc.ppid,
      elapsedSeconds,
      command: label,
      isPotentiallyFrozen: frozen,
    }
  }

  private isClaude(command: string): boolean {
    const lower = command.toLowerCase()
    // Native binary: claude.exe on Windows, claude on Unix
    if (/(?:^|[\\/])claude(?:\.exe)?(?:\s|$)/i.test(command)) return true
    // Node-based: look for @anthropic or claude-code in command line args
    if (lower.includes('claude') && (lower.includes('@anthropic') || lower.includes('claude-code'))) return true
    return false
  }

  // ─── Platform-specific process listing ──────────────────────────────────────

  private fetchProcesses(): ProcRecord[] {
    if (process.platform === 'win32') {
      return this.fetchProcessesWindows()
    }
    return this.fetchProcessesUnix()
  }

  /**
   * Windows: use wmic to list processes with claude or node in the command line.
   * Filter at the OS level for efficiency.
   */
  private fetchProcessesWindows(): ProcRecord[] {
    try {
      const output = execSync(
        'wmic process where "CommandLine like \'%claude%\' or CommandLine like \'%anthropic%\'" get ProcessId,ParentProcessId,CommandLine,CreationDate,KernelModeTime,UserModeTime /FORMAT:CSV',
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      )
      return this.parseWmicCsv(output)
    } catch {
      return []
    }
  }

  /**
   * Unix: use ps to list all processes, then filter for claude.
   */
  private fetchProcessesUnix(): ProcRecord[] {
    try {
      const output = execSync('ps -eo pid,ppid,cputime,lstart,args', {
        encoding: 'utf8',
        timeout: 5000,
      })
      return this.parsePsOutput(output)
    } catch {
      return []
    }
  }

  /**
   * Parse WMIC CSV output.
   * Format: Node,CommandLine,CreationDate,ParentProcessId,ProcessId
   * CreationDate format: 20260309123045.123456-060
   */
  private parseWmicCsv(output: string): ProcRecord[] {
    const records: ProcRecord[] = []
    const lines = output.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) return records

    // Find header line to determine column positions
    const headerLine = lines.find(l => l.includes('ProcessId') && l.includes('CommandLine'))
    if (!headerLine) return records
    const headerIndex = lines.indexOf(headerLine)

    const headers = headerLine.split(',').map(h => h.trim())
    const cmdIdx = headers.indexOf('CommandLine')
    const dateIdx = headers.indexOf('CreationDate')
    const ppidIdx = headers.indexOf('ParentProcessId')
    const pidIdx = headers.indexOf('ProcessId')
    const kernelIdx = headers.indexOf('KernelModeTime')
    const userIdx = headers.indexOf('UserModeTime')

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // CSV parsing: handle commas in CommandLine by splitting carefully
      // WMIC CSV has Node as first column, then the requested columns
      const parts = this.splitWmicLine(line, headers.length)
      if (parts.length < headers.length) continue

      const pid = parseInt(parts[pidIdx], 10)
      const ppid = parseInt(parts[ppidIdx], 10)
      const command = parts[cmdIdx] || ''
      const creationDate = this.parseWmicDate(parts[dateIdx] || '')
      // KernelModeTime + UserModeTime are in 100ns units; convert to ms
      const kernelTime = parseInt(parts[kernelIdx] || '0', 10) || 0
      const userTime = parseInt(parts[userIdx] || '0', 10) || 0
      const cpuTimeMs = Math.floor((kernelTime + userTime) / 10000)

      if (isNaN(pid) || isNaN(ppid)) continue

      records.push({ pid, ppid, command, startTime: creationDate, cpuTimeMs })
    }
    return records
  }

  /**
   * Split a WMIC CSV line handling the fact that CommandLine can contain commas.
   * WMIC CSV format: Node,Col1,Col2,...
   * We know the number of expected columns from the header.
   */
  private splitWmicLine(line: string, expectedColumns: number): string[] {
    const parts: string[] = []
    let current = ''
    let remaining = line

    // First column is Node (hostname) — always simple
    const firstComma = remaining.indexOf(',')
    if (firstComma === -1) return [remaining]
    parts.push(remaining.substring(0, firstComma))
    remaining = remaining.substring(firstComma + 1)

    // Last 3 columns (CreationDate, ParentProcessId, ProcessId) are simple numeric values.
    // CommandLine is column index 1 and may contain commas, so extract from the right.
    const rightParts: string[] = []
    for (let j = 0; j < expectedColumns - 2; j++) {
      // -2 because we already have Node, and CommandLine takes the rest
      const lastComma = remaining.lastIndexOf(',')
      if (lastComma === -1) break
      rightParts.unshift(remaining.substring(lastComma + 1))
      remaining = remaining.substring(0, lastComma)
    }

    // What's left is CommandLine
    parts.push(remaining)
    parts.push(...rightParts)

    return parts
  }

  /**
   * Parse WMIC datetime format: 20260309123045.123456-060
   */
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

  /**
   * Parse Unix ps output.
   * Format: PID PPID                 STARTED COMMAND
   *         123  45 Mon Mar  9 12:30:45 2026 node /path/to/claude
   */
  private parsePsOutput(output: string): ProcRecord[] {
    const records: ProcRecord[] = []
    const lines = output.trim().split('\n')
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // ps -eo pid,ppid,cputime,lstart,args
      // cputime format: "HH:MM:SS" or "MM:SS"
      // lstart format: "Day Mon DD HH:MM:SS YYYY"
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d:]+)\s+\w{3}\s+(\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/)
      if (!match) continue

      const pid = parseInt(match[1], 10)
      const ppid = parseInt(match[2], 10)
      const cpuTimeMs = this.parseCpuTime(match[3])
      const startTime = new Date(match[4])
      const command = match[5]

      if (!this.isClaude(command)) continue

      records.push({ pid, ppid, command, startTime: isNaN(startTime.getTime()) ? null : startTime, cpuTimeMs })
    }
    return records
  }

  /** Parse ps cputime format "HH:MM:SS" or "MM:SS" to milliseconds */
  private parseCpuTime(str: string): number {
    const parts = str.split(':').map(Number)
    if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
    if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000
    return 0
  }
}

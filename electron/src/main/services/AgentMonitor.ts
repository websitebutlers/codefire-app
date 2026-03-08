import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const POLL_INTERVAL = 3000 // 3 seconds

export interface AgentProcessInfo {
  pid: number
  parentPid: number
  elapsedSeconds: number
  command: string
  depth: number // tree depth from main Claude process
}

/**
 * Monitors running Claude Code processes on Windows.
 * Equivalent to Swift's AgentMonitor but using WMIC/tasklist.
 */
export class AgentMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private _mainProcess: AgentProcessInfo | null = null
  private _agents: AgentProcessInfo[] = []
  private listeners: Array<() => void> = []

  get mainProcess(): AgentProcessInfo | null {
    return this._mainProcess
  }

  get agents(): AgentProcessInfo[] {
    return this._agents
  }

  onChange(listener: () => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }

  start(): void {
    if (this.timer) return
    this.poll()
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this._mainProcess = null
    this._agents = []
  }

  private async poll(): Promise<void> {
    try {
      const processes = await this.getNodeProcesses()
      const claudeProcesses = processes.filter((p) => this.isClaude(p))

      if (claudeProcesses.length === 0) {
        const hadMain = this._mainProcess !== null
        this._mainProcess = null
        this._agents = []
        if (hadMain) this.notify()
        return
      }

      // Build process tree: find the main (shallowest/oldest) Claude process
      // Sort by creation time (oldest first) to find the orchestrator
      claudeProcesses.sort((a, b) => b.elapsedSeconds - a.elapsedSeconds)

      const main = claudeProcesses[0]
      main.depth = 0

      // Remaining Claude processes are agents
      const agents: AgentProcessInfo[] = []
      for (let i = 1; i < claudeProcesses.length; i++) {
        const p = claudeProcesses[i]
        // Check if this process is a descendant of the main Claude process
        if (this.isDescendant(p.pid, main.pid, processes)) {
          p.depth = 1
          agents.push(p)
        }
      }

      this._mainProcess = main
      this._agents = agents
      this.notify()
    } catch {
      // Process listing may fail temporarily
    }
  }

  /**
   * Get all node/claude processes with their PIDs, PPIDs, and creation times.
   * Uses WMIC on Windows for reliable process enumeration.
   */
  private async getNodeProcesses(): Promise<AgentProcessInfo[]> {
    const results: AgentProcessInfo[] = []

    try {
      // Use PowerShell to get process info including command line
      // This is more reliable than WMIC which is deprecated on newer Windows
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match \'node|claude\' } | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress"',
        { timeout: 5000 }
      )

      if (!stdout.trim()) return results

      const data = JSON.parse(stdout)
      const procs = Array.isArray(data) ? data : [data]
      const now = Date.now()

      for (const proc of procs) {
        if (!proc.ProcessId || !proc.CommandLine) continue

        // Parse creation date from CIM format: "/Date(1234567890000)/"
        let elapsedSeconds = 0
        if (proc.CreationDate) {
          const match = String(proc.CreationDate).match(/\/Date\((\d+)\)\//)
          if (match) {
            elapsedSeconds = Math.floor((now - parseInt(match[1], 10)) / 1000)
          }
        }

        results.push({
          pid: proc.ProcessId,
          parentPid: proc.ParentProcessId || 0,
          elapsedSeconds: Math.max(0, elapsedSeconds),
          command: proc.CommandLine || '',
          depth: 0,
        })
      }
    } catch {
      // Fallback: try tasklist (less info but more compatible)
    }

    return results
  }

  /**
   * Determine if a process is Claude Code based on its command line.
   */
  private isClaude(proc: AgentProcessInfo): boolean {
    const cmd = proc.command.toLowerCase()
    // Native binary
    if (cmd.includes('claude.exe') || cmd.includes('\\claude"') || cmd.endsWith('\\claude')) {
      return true
    }
    // Node-based Claude Code
    if (cmd.includes('@anthropic') || cmd.includes('claude-code') || cmd.includes('/claude ')) {
      return true
    }
    return false
  }

  /**
   * Check if childPid is a descendant of parentPid in the process tree.
   * Maximum 10 hops to avoid infinite loops.
   */
  private isDescendant(
    childPid: number,
    ancestorPid: number,
    allProcesses: AgentProcessInfo[]
  ): boolean {
    let current = childPid
    for (let i = 0; i < 10; i++) {
      const proc = allProcesses.find((p) => p.pid === current)
      if (!proc) return false
      if (proc.parentPid === ancestorPid) return true
      current = proc.parentPid
    }
    return false
  }
}

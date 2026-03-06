import { ChildProcess, fork } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { app } from 'electron'

export type MCPServerStatus = 'connected' | 'disconnected' | 'error'

export class MCPServerManager {
  private process: ChildProcess | null = null
  private _status: MCPServerStatus = 'disconnected'
  private _sessionCount = 0
  private onStatusChange?: (status: MCPServerStatus, sessionCount: number) => void

  get status(): MCPServerStatus {
    return this._status
  }

  get sessionCount(): number {
    return this._sessionCount
  }

  setOnStatusChange(cb: (status: MCPServerStatus, sessionCount: number) => void) {
    this.onStatusChange = cb
  }

  /** Start the MCP server as a child process (not used directly — AI agents spawn it via .mcp.json).
   *  This method is for the Electron app to track active connections. */
  start(): void {
    // The MCP server is spawned by AI agents, not by the Electron app directly.
    // Instead, we poll for active connection files to determine status.
    this.pollConnections()
  }

  stop(): void {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.setStatus('disconnected', 0)
  }

  /** Poll the mcp-connections directory for active connection files */
  pollConnections(): void {
    const poll = () => {
      const connDir = this.getConnectionDir()
      if (!fs.existsSync(connDir)) {
        this.setStatus('disconnected', 0)
        return
      }

      const files = fs.readdirSync(connDir).filter((f) => f.endsWith('.json'))
      let activeCount = 0

      for (const file of files) {
        const filePath = path.join(connDir, file)
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
          const pid = data.pid
          // Check if process is still alive
          if (pid && this.isProcessAlive(pid)) {
            activeCount++
          } else {
            // Clean up stale connection file
            try { fs.unlinkSync(filePath) } catch { /* ignore */ }
          }
        } catch {
          // Invalid file, remove it
          try { fs.unlinkSync(filePath) } catch { /* ignore */ }
        }
      }

      if (activeCount > 0) {
        this.setStatus('connected', activeCount)
      } else {
        this.setStatus('disconnected', 0)
      }
    }

    // Poll immediately, then every 5 seconds
    poll()
    const interval = setInterval(poll, 5000)

    // Clean up on app quit
    app.on('before-quit', () => clearInterval(interval))
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  private setStatus(status: MCPServerStatus, sessionCount: number) {
    if (this._status !== status || this._sessionCount !== sessionCount) {
      this._status = status
      this._sessionCount = sessionCount
      this.onStatusChange?.(status, sessionCount)
    }
  }

  private getConnectionDir(): string {
    switch (process.platform) {
      case 'darwin':
        return path.join(os.homedir(), '.local', 'share', 'CodeFire', 'mcp-connections')
      case 'win32':
        return path.join(
          process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
          'CodeFire',
          'mcp-connections'
        )
      default:
        return path.join(os.homedir(), '.local', 'share', 'CodeFire', 'mcp-connections')
    }
  }

  /** Get the path to the MCP server executable for .mcp.json configuration */
  static getMcpServerPath(): string {
    if (app.isPackaged) {
      // In production, the MCP server is bundled in resources
      return path.join(process.resourcesPath, 'mcp-server.js')
    }
    // In dev, use the compiled output
    return path.join(__dirname, '..', 'mcp', 'server.js')
  }
}

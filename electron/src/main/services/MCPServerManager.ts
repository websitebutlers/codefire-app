import { ChildProcess, fork } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { app } from 'electron'
import type { MCPConnection } from '@shared/models'

/** Stable install directory for the MCP server on Linux (AppImage mounts to ephemeral /tmp paths) */
const LINUX_MCP_DIR = path.join(os.homedir(), '.local', 'share', 'CodeFire', 'mcp-server')

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

  /** Return details of all active MCP connections */
  listConnections(): MCPConnection[] {
    const connDir = this.getConnectionDir()
    if (!fs.existsSync(connDir)) return []

    const connections: MCPConnection[] = []
    const files = fs.readdirSync(connDir).filter((f) => f.endsWith('.json'))

    for (const file of files) {
      const filePath = path.join(connDir, file)
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (data.pid && this.isProcessAlive(data.pid)) {
          connections.push({
            pid: data.pid,
            cwd: data.cwd ?? '',
            projectId: data.projectId ?? null,
            projectName: data.projectName ?? null,
            connectedAt: data.connectedAt ?? '',
          })
        } else {
          try { fs.unlinkSync(filePath) } catch { /* ignore */ }
        }
      } catch {
        try { fs.unlinkSync(filePath) } catch { /* ignore */ }
      }
    }

    return connections
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
    if (!app.isPackaged) {
      // In dev, use the compiled output
      return path.join(__dirname, '..', 'mcp', 'server.js')
    }

    // Linux AppImage: use the stable copy in ~/.local/share/CodeFire/mcp-server/
    // (AppImage mounts to ephemeral /tmp/.mount_* paths that change every launch)
    if (process.platform === 'linux') {
      return path.join(LINUX_MCP_DIR, 'server.js')
    }

    // macOS / Windows: resources path is stable across launches
    return path.join(process.resourcesPath, 'mcp-server', 'server.js')
  }

  /**
   * On Linux, sync the bundled MCP server from the AppImage mount to a stable
   * path so Claude Code can find it even after the AppImage is relaunched.
   * Should be called early in app startup, before any MCP registration.
   */
  static syncMcpServerForLinux(): void {
    if (process.platform !== 'linux' || !app.isPackaged) return

    const source = path.join(process.resourcesPath, 'mcp-server')
    if (!fs.existsSync(source)) {
      console.warn('[MCP] Bundled mcp-server not found at', source)
      return
    }

    try {
      // Ensure target directory exists
      fs.mkdirSync(LINUX_MCP_DIR, { recursive: true })

      // Copy the entire mcp-server directory (server.js + node_modules)
      fs.cpSync(source, LINUX_MCP_DIR, { recursive: true, force: true })
      console.log('[MCP] Synced MCP server to stable path:', LINUX_MCP_DIR)
    } catch (err) {
      console.error('[MCP] Failed to sync MCP server to stable path:', err)
    }
  }
}

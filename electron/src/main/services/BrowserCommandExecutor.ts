import type Database from 'better-sqlite3'
import { BrowserWindow, ipcMain } from 'electron'
import { randomBytes } from 'crypto'

interface BrowserCommand {
  id: number
  tool: string
  args: string | null
  status: string
  result: string | null
  createdAt: string
  completedAt: string | null
  authToken: string | null
}

export class BrowserCommandExecutor {
  private db: Database.Database
  private timer: ReturnType<typeof setInterval> | null = null
  private processing = false
  /** Session token — only commands with a matching token are executed */
  readonly sessionToken: string

  constructor(db: Database.Database, sessionToken?: string) {
    this.db = db
    this.sessionToken = sessionToken ?? randomBytes(32).toString('hex')
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.poll(), 100)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async poll(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      const cmd = this.db.prepare(
        "SELECT * FROM browserCommands WHERE status = 'pending' ORDER BY createdAt ASC LIMIT 1"
      ).get() as BrowserCommand | undefined

      if (!cmd) return

      // Validate auth token — reject commands from unauthorized sources
      if (cmd.authToken !== this.sessionToken) {
        this.db.prepare(
          "UPDATE browserCommands SET status = 'error', result = ?, completedAt = datetime('now') WHERE id = ?"
        ).run(JSON.stringify({ error: 'Invalid auth token — command rejected' }), cmd.id)
        return
      }

      // Mark as executing
      this.db.prepare(
        "UPDATE browserCommands SET status = 'executing' WHERE id = ?"
      ).run(cmd.id)

      try {
        const result = await this.executeCommand(cmd)
        this.db.prepare(
          "UPDATE browserCommands SET status = 'completed', result = ?, completedAt = datetime('now') WHERE id = ?"
        ).run(JSON.stringify(result), cmd.id)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.db.prepare(
          "UPDATE browserCommands SET status = 'error', result = ?, completedAt = datetime('now') WHERE id = ?"
        ).run(JSON.stringify({ error: message }), cmd.id)
      }
    } finally {
      this.processing = false
    }
  }

  private async executeCommand(cmd: BrowserCommand): Promise<unknown> {
    const args = cmd.args ? JSON.parse(cmd.args) : {}

    // Find a BrowserWindow that has a webview (project windows)
    const windows = BrowserWindow.getAllWindows()
    const targetWindow = windows.find(w => {
      const url = w.webContents.getURL()
      return url.includes('projectId=') || windows.length === 1
    }) || windows[0]

    if (!targetWindow) {
      throw new Error('No browser window available to execute command')
    }

    // Send command to renderer and await result via ipcMain.once
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(channel)
        reject(new Error(`Command ${cmd.tool} timed out after 30s`))
      }, 30_000)

      const channel = `browser:commandResult:${cmd.id}`

      ipcMain.once(channel, (_event, result) => {
        clearTimeout(timeout)
        if (result?.error) {
          reject(new Error(result.error))
        } else {
          resolve(result)
        }
      })

      targetWindow.webContents.send('browser:commandRequest', {
        id: cmd.id,
        tool: cmd.tool,
        args,
      })
    })
  }
}

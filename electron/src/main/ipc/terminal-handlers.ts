import { ipcMain, BrowserWindow, webContents, app, powerSaveBlocker } from 'electron'
import { TerminalService } from '../services/TerminalService'
import { NotificationService } from '../services/NotificationService'
import * as path from 'path'
import * as fs from 'fs'

// Prevent macOS App Nap from suspending PTY child processes.
// Without this, backgrounded terminals can receive SIGHUP and exit (code 0).
let powerSaveId: number | null = null

function ensurePowerSaveBlocker() {
  if (powerSaveId === null || !powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension')
  }
}

function releasePowerSaveBlocker() {
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId)
    powerSaveId = null
  }
}

/**
 * Look up a BrowserWindow by webContents ID. More resilient than capturing
 * the BrowserWindow reference in a closure — survives renderer reloads and
 * avoids stale references in multi-window setups (project windows).
 */
function getWindowByWebContentsId(wcId: number): BrowserWindow | null {
  const wc = webContents.fromId(wcId)
  if (!wc || wc.isDestroyed()) return null
  return BrowserWindow.fromWebContents(wc)
}

/**
 * Register IPC handlers for terminal management.
 *
 * Data flow:
 * - Renderer → Main (keystrokes): `terminal:write` via send (fire-and-forget)
 * - Main → Renderer (output):     `terminal:data` via webContents.send
 * - Renderer → Main (resize):     `terminal:resize` via send (fire-and-forget)
 * - Main → Renderer (exit):       `terminal:exit` via webContents.send
 * - Lifecycle (create/kill):       `terminal:create` / `terminal:kill` via handle (request-response)
 */
export function registerTerminalHandlers(terminalService: TerminalService) {
  // ─── Availability check ─────────────────────────────────────────────────────

  ipcMain.handle('terminal:available', () => {
    return terminalService.isAvailable()
  })

  // ─── Lifecycle (request-response) ─────────────────────────────────────────

  ipcMain.handle(
    'terminal:create',
    (_event, id: string, projectPath: string) => {
      if (!id || typeof id !== 'string') {
        throw new Error('Terminal id is required and must be a string')
      }
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }

      terminalService.create(id, projectPath)
      ensurePowerSaveBlocker()

      // Capture the generation of the PTY we just created.  React StrictMode
      // (dev mode) mount→unmount→remount causes terminal:create to be called
      // twice for the same ID.  The first PTY gets killed, but its onExit
      // callback fires asynchronously with exit code -1073741510 (Windows
      // ConPTY kill).  Without this guard, that stale exit event reaches the
      // renderer and makes the terminal appear "crashed" even though the
      // second PTY is alive and working.
      const createdGeneration = terminalService.getSession(id)?.generation ?? 0

      if (terminalService.markListenersRegistered(id)) {
        // Store the webContents ID instead of capturing the BrowserWindow ref.
        // This allows dynamic lookup on each event, which is more resilient
        // when project windows reload or recover from crashes.
        const senderWebContentsId = _event.sender.id

        terminalService.onData(id, (data) => {
          // Drop data from a stale (killed) PTY generation
          const current = terminalService.getSession(id)
          if (!current || current.generation !== createdGeneration) return
          const win = getWindowByWebContentsId(senderWebContentsId)
          if (win && !win.isDestroyed()) {
            win.webContents.send('terminal:data', id, data)
          }
        })

        terminalService.onExit(id, (exitCode, signal) => {
          // Drop exit events from a stale (killed) PTY generation.
          // When create() kills an old PTY, the exit callback fires later
          // with -1073741510 on Windows — this must be silently ignored.
          const current = terminalService.getSession(id)
          if (current && current.generation !== createdGeneration) return
          console.error(`[TERMINAL] PTY exited: id=${id} exitCode=${exitCode} signal=${signal ?? 'none'}`)
          const win = getWindowByWebContentsId(senderWebContentsId)
          if (win && !win.isDestroyed()) {
            win.webContents.send('terminal:exit', id, exitCode, signal)
          }
          NotificationService.getInstance().notifyClaudeDone(id)
          if (terminalService.getActiveIds().length === 0) {
            releasePowerSaveBlocker()
          }
        })
      }

      return { id }
    }
  )

  ipcMain.handle('terminal:kill', (_event, id: string) => {
    if (!id || typeof id !== 'string') {
      throw new Error('Terminal id is required and must be a string')
    }
    terminalService.kill(id)
    if (terminalService.getActiveIds().length === 0) {
      releasePowerSaveBlocker()
    }
    return { success: true }
  })

  // ─── Fire-and-forget (renderer → main) ───────────────────────────────────

  ipcMain.on('terminal:write', (_event, id: string, data: string) => {
    terminalService.write(id, data)
  })

  // Write to the first active terminal — only if one already exists.
  // Does NOT auto-create terminals to prevent shell injection from XSS.
  ipcMain.on('terminal:writeToActive', (_event, data: string) => {
    const ids = terminalService.getActiveIds()
    if (ids.length > 0) {
      terminalService.write(ids[0], data)
    }
    // If no terminal exists, silently ignore — the renderer must create one first
    // via the terminal:create handle (which requires explicit user action).
  })

  ipcMain.on(
    'terminal:resize',
    (_event, id: string, cols: number, rows: number) => {
      terminalService.resize(id, cols, rows)
    }
  )

  // ─── Clipboard image save (for pasting images into terminal) ──────────────

  ipcMain.handle(
    'terminal:saveClipboardImage',
    async (_event, imageData: number[], ext: string) => {
      const safeExt = (ext || 'png').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)
      const tempDir = path.join(app.getPath('temp'), 'codefire-clipboard')
      fs.mkdirSync(tempDir, { recursive: true })
      const fileName = `clipboard-${Date.now()}.${safeExt}`
      const filePath = path.join(tempDir, fileName)
      fs.writeFileSync(filePath, Buffer.from(imageData))
      return filePath
    }
  )
}

import { ipcMain, BrowserWindow } from 'electron'
import { TerminalService } from '../services/TerminalService'

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

      // Wire up PTY output → renderer
      const senderWindow = BrowserWindow.fromWebContents(_event.sender)

      terminalService.onData(id, (data) => {
        // Send output to the window that created this terminal
        if (senderWindow && !senderWindow.isDestroyed()) {
          senderWindow.webContents.send('terminal:data', id, data)
        }
      })

      terminalService.onExit(id, (exitCode, signal) => {
        if (senderWindow && !senderWindow.isDestroyed()) {
          senderWindow.webContents.send('terminal:exit', id, exitCode, signal)
        }
        // Clean up the session after exit
        terminalService.kill(id)
      })

      return { id }
    }
  )

  ipcMain.handle('terminal:kill', (_event, id: string) => {
    if (!id || typeof id !== 'string') {
      throw new Error('Terminal id is required and must be a string')
    }
    terminalService.kill(id)
    return { success: true }
  })

  // ─── Fire-and-forget (renderer → main) ───────────────────────────────────

  ipcMain.on('terminal:write', (_event, id: string, data: string) => {
    terminalService.write(id, data)
  })

  ipcMain.on(
    'terminal:resize',
    (_event, id: string, cols: number, rows: number) => {
      terminalService.resize(id, cols, rows)
    }
  )
}

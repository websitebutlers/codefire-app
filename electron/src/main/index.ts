import { app, BrowserWindow, nativeImage } from 'electron'
import path from 'path'
import { getDatabase, closeDatabase } from './database/connection'
import { registerAllHandlers } from './ipc'
import { WindowManager } from './windows/WindowManager'
import { TrayManager } from './windows/TrayManager'
import { TerminalService } from './services/TerminalService'
import { GitService } from './services/GitService'
import { GoogleOAuth } from './services/GoogleOAuth'
import { GmailService } from './services/GmailService'
import { readConfig } from './services/ConfigStore'

process.env.DIST_ELECTRON = path.join(__dirname, '..')
process.env.DIST = path.join(process.env.DIST_ELECTRON, '../dist')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

// Initialize database, window manager, terminal service, and git service
const db = getDatabase()
const windowManager = WindowManager.getInstance()
const trayManager = new TrayManager(windowManager)
const terminalService = new TerminalService()
const gitService = new GitService()

// Initialize Gmail service from config store or env vars
let gmailService: GmailService | undefined
const config = readConfig()
const googleClientId = config.googleClientId || process.env.GOOGLE_CLIENT_ID
const googleClientSecret = config.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET
if (googleClientId && googleClientSecret) {
  const oauth = new GoogleOAuth(googleClientId, googleClientSecret)
  gmailService = new GmailService(db, oauth)
}

// Register all IPC handlers (including window, terminal, and git management)
registerAllHandlers(db, windowManager, terminalService, gitService, undefined, gmailService)

let isQuitting = false

app.whenReady().then(() => {
  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../resources/icon.png')
    const icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) {
      app.dock.setIcon(icon)
    }
  }

  // Create system tray
  trayManager.create()

  const mainWin = windowManager.createMainWindow()

  // Minimize to tray instead of closing on Windows/Linux
  mainWin.on('close', (e) => {
    if (!isQuitting && process.platform !== 'darwin') {
      e.preventDefault()
      mainWin.hide()
    }
  })
})

app.on('window-all-closed', () => {
  // No-op: app stays alive in tray
})

app.on('activate', () => {
  // On macOS, re-create the main window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.createMainWindow()
  } else {
    // If main window exists but is hidden, show it
    const mainWin = windowManager.getMainWindow()
    if (mainWin) {
      mainWin.show()
      mainWin.focus()
    }
  }
})

app.on('before-quit', () => {
  isQuitting = true
  trayManager.destroy()
  terminalService.killAll()
  closeDatabase()
})

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, session } from 'electron'
import path from 'path'
import { getDatabase, closeDatabase } from './database/connection'
import { registerAllHandlers } from './ipc'
import { WindowManager } from './windows/WindowManager'
import { TrayManager } from './windows/TrayManager'
import type { TerminalService as TerminalServiceType } from './services/TerminalService'
import { GitService } from './services/GitService'
import { GoogleOAuth } from './services/GoogleOAuth'
import { GmailService } from './services/GmailService'
import { readConfig } from './services/ConfigStore'
import { MCPServerManager } from './services/MCPServerManager'
import { DeepLinkService } from './services/DeepLinkService'
import { SearchEngine } from './services/SearchEngine'
import { ContextEngine } from './services/ContextEngine'
import { EmbeddingClient } from './services/EmbeddingClient'

// Prevent crashes from uncaught errors
process.on('uncaughtException', (err) => {
  console.error('[MAIN] Uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[MAIN] Unhandled rejection:', reason)
})

process.env.DIST_ELECTRON = path.join(__dirname, '..')
process.env.DIST = path.join(process.env.DIST_ELECTRON, '../dist')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

// Initialize database, window manager, terminal service, and git service
const db = getDatabase()
const windowManager = WindowManager.getInstance()
const trayManager = new TrayManager(windowManager)
// Lazy-load TerminalService — node-pty may not be available if build tools are missing
let terminalService: TerminalServiceType | undefined
try {
  const { TerminalService } = require('./services/TerminalService')
  terminalService = new TerminalService()
} catch {
  console.warn('[Main] Terminal service unavailable — node-pty failed to load')
}
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

// Initialize MCP server manager (polls for active MCP connections)
const mcpManager = new MCPServerManager()

// Initialize search and context engines for code indexing
const embeddingClient = new EmbeddingClient(config.openRouterKey || undefined)
const searchEngine = new SearchEngine(db, embeddingClient)
const contextEngine = new ContextEngine(db)

// Initialize deep link service and register codefire:// protocol
const deepLinkService = new DeepLinkService()

if (process.defaultApp) {
  // Dev mode: register with the path to electron + script
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('codefire', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('codefire')
}

/** Process a codefire:// URL and broadcast result to all renderer windows */
function handleDeepLinkURL(url: string) {
  const result = deepLinkService.handleURL(url)
  if (!result) return
  // Ensure the app window is visible and focused
  const mainWin = windowManager.getMainWindow()
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show()
    mainWin.focus()
  }
  // Broadcast result to all renderer windows
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('deeplink:result', result)
  }
}

// Windows/Linux: second instance passes the URL via argv
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // On Windows, the deep link URL is the last argument
    const url = argv.find((arg) => arg.startsWith('codefire://'))
    if (url) handleDeepLinkURL(url)
    // Focus existing window
    const mainWin = windowManager.getMainWindow()
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.show()
      mainWin.focus()
    }
  })
}

// macOS: open-url event fires when the app is already running
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLinkURL(url)
})

// Register all IPC handlers (including window, terminal, and git management)
registerAllHandlers(db, windowManager, terminalService, gitService, undefined, gmailService, searchEngine, contextEngine, mcpManager)

// Register Agent Arena handler
import { openAgentArena } from './windows/AgentArenaWindow'
ipcMain.handle('arena:open', () => {
  openAgentArena()
})

let isQuitting = false

// Start MCP connection polling and broadcast status to all renderer windows
if (config.mcpServerAutoStart) {
  mcpManager.setOnStatusChange((status, sessionCount) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('mcp:statusChanged', { status, sessionCount })
    }
  })
  mcpManager.start()
}

app.whenReady().then(() => {
  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../resources/icon.png')
    const icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) {
      app.dock?.setIcon(icon)
    }
  }

  // Create system tray
  trayManager.create()

  // Build custom application menu
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CommandOrControl+,',
          click: () => {
            const focused = BrowserWindow.getFocusedWindow()
            if (focused) focused.webContents.send('menu:openSettings')
          },
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    { role: 'editMenu' as const },
    { role: 'viewMenu' as const },
    { role: 'windowMenu' as const },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  const mainWin = windowManager.createMainWindow()

  // Global shortcut: Ctrl+Shift+H to show/focus the planner window
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    const win = windowManager.getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  // Auto-recover from renderer crashes
  mainWin.webContents.on('render-process-gone', (_event, details) => {
    console.error('[MAIN] Renderer crashed:', details.reason, details.exitCode)
    if (details.reason !== 'clean-exit') {
      mainWin.webContents.reload()
    }
  })
  mainWin.webContents.on('unresponsive', () => {
    console.error('[MAIN] Renderer became unresponsive')
  })
  mainWin.webContents.on('responsive', () => {
    console.log('[MAIN] Renderer became responsive again')
  })

  // Handle deep link URL if the app was launched via protocol (cold start)
  const deepLinkArg = process.argv.find((arg) => arg.startsWith('codefire://'))
  if (deepLinkArg) {
    // Wait for the renderer to be ready before sending the result
    mainWin.webContents.once('did-finish-load', () => {
      handleDeepLinkURL(deepLinkArg)
    })
  }

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
  terminalService?.killAll()
  closeDatabase()
})

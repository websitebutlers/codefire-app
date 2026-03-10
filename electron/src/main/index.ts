import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, session } from 'electron'
import { randomBytes } from 'crypto'
import * as fs from 'fs'
import path from 'path'
import { getDatabase, closeDatabase } from './database/connection'
import { initPathValidator } from './services/PathValidator'
import { registerAllHandlers } from './ipc'
import { registerSearchHandlers } from './ipc/search-handlers'
import { registerGmailHandlers } from './ipc/gmail-handlers'
import { WindowManager } from './windows/WindowManager'
import { TrayManager } from './windows/TrayManager'
import { TerminalService } from './services/TerminalService'
import { GitService } from './services/GitService'
import { GoogleOAuth } from './services/GoogleOAuth'
import { GmailService } from './services/GmailService'
import { readConfig, writeMCPSecrets } from './services/ConfigStore'
import { MCPServerManager } from './services/MCPServerManager'
import { DeepLinkService } from './services/DeepLinkService'
import { SearchEngine } from './services/SearchEngine'
import { ContextEngine } from './services/ContextEngine'
import { EmbeddingClient } from './services/EmbeddingClient'
import { BrowserCommandExecutor } from './services/BrowserCommandExecutor'
import { LiveSessionWatcher } from './services/LiveSessionWatcher'
import { AgentProcessWatcher } from './services/AgentProcessWatcher'
import { SessionWatcher } from './services/SessionWatcher'
import { FileWatcher } from './services/FileWatcher'
import { ProjectDAO } from './database/dao/ProjectDAO'
import { AuthService } from './services/premium/AuthService'
import { TeamService } from './services/premium/TeamService'
import { SyncEngine } from './services/premium/SyncEngine'
import { PresenceService } from './services/premium/PresenceService'
import { registerPremiumHandlers } from './ipc/premium-handlers'

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

// Initialize path validator for IPC security
initPathValidator(db)
const windowManager = WindowManager.getInstance()
const trayManager = new TrayManager(windowManager)
const terminalService = new TerminalService()
if (!terminalService.isAvailable()) {
  console.warn('[Main] Terminal service unavailable — node-pty failed to load')
}
const gitService = new GitService()

// Read config early (lightweight)
const config = readConfig()

// On Linux AppImage, copy the MCP server to a stable path before anything else
MCPServerManager.syncMcpServerForLinux()

// Initialize MCP server manager (polls for active MCP connections)
const mcpManager = new MCPServerManager()

// Initialize agent process watcher (detects running Claude Code agents)
const agentWatcher = new AgentProcessWatcher()

// Deferred services — initialized after window shows for faster startup
let gmailService: GmailService | undefined
let searchEngine: SearchEngine
let contextEngine: ContextEngine
let fileWatcher: FileWatcher
let browserExecutor: BrowserCommandExecutor | null = null
/** Session token for browser command auth — shared between IPC handlers, executor, and MCP server */
const browserSessionToken = randomBytes(32).toString('hex')
// Write token to app data so MCP server can read it
const tokenPath = path.join(app.getPath('userData'), '.browser-session-token')
try { fs.writeFileSync(tokenPath, browserSessionToken, { mode: 0o600 }) } catch { /* ignore */ }

// Write decrypted API keys for MCP server (separate process can't use safeStorage)
writeMCPSecrets()
let liveWatcher: LiveSessionWatcher
let sessionWatcher: SessionWatcher

let deferredServicesInitialized = false
function initDeferredServices() {
  if (deferredServicesInitialized) return
  deferredServicesInitialized = true
  // Gmail
  const googleClientId = config.googleClientId || process.env.GOOGLE_CLIENT_ID
  const googleClientSecret = config.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET
  if (googleClientId && googleClientSecret) {
    const oauth = new GoogleOAuth(googleClientId, googleClientSecret)
    gmailService = new GmailService(db, oauth)
  }

  // Search and context engines
  const embeddingClient = new EmbeddingClient(config.openRouterKey || undefined)
  searchEngine = new SearchEngine(db, embeddingClient)
  contextEngine = new ContextEngine(db)

  // File watcher for incremental index updates
  fileWatcher = new FileWatcher()
  const projectDAO = new ProjectDAO(db)

  fileWatcher.onFilesChanged = (projectId: string, changedPaths: string[]) => {
    const project = projectDAO.getById(projectId)
    if (!project) return

    console.log(`[FileWatcher] Re-indexing ${changedPaths.length} changed file(s) in project ${projectId}`)
    for (const absPath of changedPaths) {
      const relativePath = path.relative(project.path, absPath)
      contextEngine.indexFile(projectId, project.path, relativePath).catch((err) => {
        console.error(`[FileWatcher] Failed to re-index ${relativePath}:`, err)
      })
    }
  }

  // Browser command executor
  browserExecutor = new BrowserCommandExecutor(db, browserSessionToken)
  browserExecutor.start()

  // Start agent process watcher
  agentWatcher.start()

  // Live session watcher
  liveWatcher = new LiveSessionWatcher()
  liveWatcher.start()

  // Session watcher — auto-import sessions from Claude project directories
  sessionWatcher = new SessionWatcher(db)
  sessionWatcher.onSessionChange((sessionId, projectId) => {
    // Notify all windows that sessions changed
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('sessions:updated', { sessionId, projectId })
    }
  })
  // Watch all projects that have a claudeProject directory
  const allProjects = projectDAO.list()
  for (const project of allProjects) {
    if (project.claudeProject) {
      sessionWatcher.watchProject(project.id, project.claudeProject)
    }
  }

  // Register deferred IPC handlers
  registerSearchHandlers(db, searchEngine, contextEngine)
  if (gmailService) registerGmailHandlers(gmailService)

  // Teams services — always register handlers so the Team tab works.
  // Cloud sync only activates when user explicitly signs in (opt-in).
  try {
    const authSvc = new AuthService()
    const teamSvc = new TeamService()
    const syncEng = new SyncEngine(db)
    const presenceSvc = new PresenceService()
    registerPremiumHandlers(authSvc, teamSvc, syncEng, presenceSvc)
    if (config.supabaseUrl && config.supabaseAnonKey) {
      syncEng.start()
    }
    console.log('[Main] Teams services initialized')
  } catch (err) {
    console.warn('[Main] Teams services unavailable:', err)
  }
}

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
async function handleDeepLinkURL(url: string) {
  // Validate URL structure
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    console.error('[DeepLink] Invalid URL:', url)
    return
  }

  if (parsed.protocol !== 'codefire:') {
    console.error('[DeepLink] Unexpected protocol:', parsed.protocol)
    return
  }

  // Handle auth callback: codefire://auth/callback#access_token=...&refresh_token=...
  if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
    try {
      // Supabase puts tokens in the hash fragment (after #)
      const hashPart = url.split('#')[1] || ''
      const params = new URLSearchParams(hashPart)
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')

      // Basic JWT format validation (3 dot-separated base64 segments)
      const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
      if (accessToken && refreshToken && jwtPattern.test(accessToken)) {
        const { getSupabaseClient } = require('./services/premium/SupabaseClient')
        const client = getSupabaseClient()
        if (client) {
          await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          console.log('[DeepLink] Auth callback: session set successfully')
        }
      } else {
        console.error('[DeepLink] Invalid token format in auth callback')
      }
    } catch (e) {
      console.error('[DeepLink] Failed to handle auth callback:', e)
    }

    // Focus window and notify renderer to refresh auth status
    const mainWin = windowManager.getMainWindow()
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.show()
      mainWin.focus()
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('deeplink:result', { success: true, type: 'auth-callback' })
    }
    return
  }

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

// Register essential IPC handlers immediately (db, window, terminal, git, MCP)
registerAllHandlers(db, windowManager, terminalService, gitService, undefined, undefined, undefined, undefined, mcpManager, undefined, agentWatcher, browserSessionToken)


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
  // ─── Content Security Policy ────────────────────────────────────────────────
  // Applied only to the app's own pages, not to webview content (which has its own origin)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Only apply CSP to our own app pages, not external URLs loaded in webviews
    const isAppContent =
      details.url.startsWith('file://') ||
      (process.env.VITE_DEV_SERVER_URL && details.url.startsWith(process.env.VITE_DEV_SERVER_URL))

    if (isAppContent) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self';" +
            " script-src 'self' 'unsafe-inline';" + // unsafe-inline needed for Vite HMR in dev
            " style-src 'self' 'unsafe-inline';" +
            " img-src 'self' data: blob: https:;" +
            " font-src 'self' data:;" +
            " connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:*;" +
            " media-src 'self' blob:;" +
            " worker-src 'self' blob:;"
          ],
        },
      })
    } else {
      callback({ responseHeaders: details.responseHeaders })
    }
  })

  // ─── Navigation guards ──────────────────────────────────────────────────────
  // Block BrowserWindow navigation to unexpected URLs.
  // Webview tags manage their own navigation and are excluded.
  app.on('web-contents-created', (_event, contents) => {
    // Only guard BrowserWindow frames, not webview guests
    if (contents.getType() === 'webview') return

    // Block navigation away from app content
    contents.on('will-navigate', (event, navigationUrl) => {
      try {
        const parsedUrl = new URL(navigationUrl)
        // Allow file:// (app content in production)
        if (parsedUrl.protocol === 'file:') return
        // Allow Vite dev server
        if (process.env.VITE_DEV_SERVER_URL && navigationUrl.startsWith(process.env.VITE_DEV_SERVER_URL)) return
      } catch {
        // Invalid URL — block it
      }
      event.preventDefault()
    })

    // Block new window creation — deny popup windows from the main renderer
    contents.setWindowOpenHandler(() => {
      return { action: 'deny' }
    })
  })

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

  // Defer heavy service init until after window is visible
  mainWin.once('ready-to-show', () => {
    setTimeout(() => initDeferredServices(), 100)
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
  agentWatcher.stop()
  if (fileWatcher) fileWatcher.unwatchAll()
  if (liveWatcher) liveWatcher.stop()
  if (sessionWatcher) sessionWatcher.unwatchAll()
  if (browserExecutor) browserExecutor.stop()
  trayManager.destroy()
  terminalService?.killAll()
  closeDatabase()
})

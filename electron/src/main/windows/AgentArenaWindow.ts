import { app, BrowserWindow, nativeImage, screen } from 'electron'
import path from 'path'
import { AgentMonitor } from '../services/AgentMonitor'
import { AgentArenaDataSource } from '../services/AgentArenaDataSource'
import { LiveSessionWatcher } from '../services/LiveSessionWatcher'

function getAppIcon() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../../resources/icon.png')
  return nativeImage.createFromPath(iconPath)
}

let arenaWindow: BrowserWindow | null = null
let agentMonitor: AgentMonitor | null = null
let dataSource: AgentArenaDataSource | null = null
let pushTimer: ReturnType<typeof setInterval> | null = null

export function openAgentArena(sessionWatcher?: LiveSessionWatcher): BrowserWindow {
  if (arenaWindow && !arenaWindow.isDestroyed()) {
    arenaWindow.focus()
    return arenaWindow
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize

  arenaWindow = new BrowserWindow({
    icon: getAppIcon(),
    width: 600,
    height: 250,
    minWidth: 300,
    minHeight: 180,
    x: screenW - 620,
    y: screenH - 280,
    alwaysOnTop: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a1a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Load the shared HTML renderer
  const htmlPath = path.isAbsolute(__dirname)
    ? path.join(__dirname, '../../../shared/agent-arena/agent-arena.html')
    : path.join(process.cwd(), 'shared/agent-arena/agent-arena.html')
  arenaWindow.loadFile(htmlPath)

  // Start agent monitoring when the arena window opens
  startMonitoring(sessionWatcher)

  arenaWindow.on('closed', () => {
    arenaWindow = null
    stopMonitoring()
  })

  return arenaWindow
}

function startMonitoring(sessionWatcher?: LiveSessionWatcher): void {
  if (agentMonitor) return

  agentMonitor = new AgentMonitor()
  const watcher = sessionWatcher ?? new LiveSessionWatcher()
  dataSource = new AgentArenaDataSource(agentMonitor, watcher)

  // Listen for process changes and push state immediately
  agentMonitor.onChange(() => pushStateToWindow())

  agentMonitor.start()

  // Also push state every 3 seconds as a fallback
  pushTimer = setInterval(() => pushStateToWindow(), 3000)
}

function stopMonitoring(): void {
  if (agentMonitor) {
    agentMonitor.stop()
    agentMonitor = null
  }
  dataSource = null
  if (pushTimer) {
    clearInterval(pushTimer)
    pushTimer = null
  }
}

function pushStateToWindow(): void {
  const win = getArenaWindow()
  if (!win || !dataSource) return

  const json = dataSource.jsonString()
  if (!json) return

  win.webContents
    .executeJavaScript(`if(typeof updateAgentState==='function')updateAgentState(${json})`)
    .catch(() => {
      // Page may not be ready yet
    })
}

export function getArenaWindow(): BrowserWindow | null {
  return arenaWindow && !arenaWindow.isDestroyed() ? arenaWindow : null
}

export function pushArenaState(state: object): void {
  const win = getArenaWindow()
  if (win) {
    const json = JSON.stringify(state)
    win.webContents.executeJavaScript(`updateAgentState(${json})`).catch(() => {})
  }
}

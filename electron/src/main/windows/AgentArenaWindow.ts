import { app, BrowserWindow, nativeImage, screen } from 'electron'
import path from 'path'

function getAppIcon() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../../resources/icon.png')
  return nativeImage.createFromPath(iconPath)
}

let arenaWindow: BrowserWindow | null = null

export function openAgentArena(): BrowserWindow {
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
  const htmlPath = path.join(__dirname, '../../../shared/agent-arena/agent-arena.html')
  arenaWindow.loadFile(htmlPath)

  arenaWindow.on('closed', () => {
    arenaWindow = null
  })

  return arenaWindow
}

export function getArenaWindow(): BrowserWindow | null {
  return arenaWindow && !arenaWindow.isDestroyed() ? arenaWindow : null
}

export function pushArenaState(state: object): void {
  const win = getArenaWindow()
  if (win) {
    const json = JSON.stringify(state)
    win.webContents.executeJavaScript(`updateAgentState(${json})`)
  }
}

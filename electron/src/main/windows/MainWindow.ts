import { app, BrowserWindow, nativeImage, screen } from 'electron'
import path from 'path'
import { WINDOW_SIZES } from '@shared/theme'
import { WindowStateStore, type WindowState } from './WindowStateStore'

function getAppIcon() {
  const ext = process.platform === 'win32' ? 'ico' : 'png'
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, `icon.${ext}`)
    : path.join(__dirname, `../../../resources/icon.${ext}`)
  return nativeImage.createFromPath(iconPath)
}

export class MainWindow {
  private window: BrowserWindow | null = null
  private stateStore: WindowStateStore

  constructor(stateStore: WindowStateStore) {
    this.stateStore = stateStore
  }

  create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus()
      return this.window
    }

    const savedState = this.stateStore.get('main')
    const defaults = {
      width: WINDOW_SIZES.main.width,
      height: WINDOW_SIZES.main.height,
    }

    const bounds = this.getValidBounds(savedState, defaults)

    this.window = new BrowserWindow({
      ...bounds,
      icon: getAppIcon(),
      minWidth: 900,
      minHeight: 600,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      frame: true,
      backgroundColor: '#171717',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // webviewTag not needed on main window — only ProjectWindow hosts the browser
      },
    })

    this.window.once('ready-to-show', () => {
      this.window?.show()
    })

    this.loadContent(this.window)
    this.attachStateListeners(this.window)

    this.window.on('closed', () => {
      this.window = null
    })

    return this.window
  }

  getWindow(): BrowserWindow | null {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }
    return null
  }

  private loadContent(win: BrowserWindow): void {
    if (process.env.VITE_DEV_SERVER_URL) {
      win.loadURL(process.env.VITE_DEV_SERVER_URL)
      // win.webContents.openDevTools({ mode: 'detach' })
    } else {
      win.loadFile(path.join(process.env.DIST!, 'index.html'))
    }
  }

  private attachStateListeners(win: BrowserWindow): void {
    const saveState = () => {
      if (win.isDestroyed()) return
      const bounds = win.getBounds()
      const isMaximized = win.isMaximized()
      this.stateStore.set('main', {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized,
      })
    }

    win.on('resize', saveState)
    win.on('move', saveState)
    win.on('maximize', saveState)
    win.on('unmaximize', saveState)
  }

  /**
   * Returns validated bounds, falling back to defaults if the saved position
   * is off-screen (e.g., external monitor was disconnected).
   */
  private getValidBounds(
    saved: WindowState | undefined,
    defaults: { width: number; height: number }
  ): { x?: number; y?: number; width: number; height: number } {
    if (!saved) {
      return { width: defaults.width, height: defaults.height }
    }

    const width = saved.width || defaults.width
    const height = saved.height || defaults.height

    // Verify the saved position is still on a visible display
    if (saved.x !== undefined && saved.y !== undefined) {
      const displays = screen.getAllDisplays()
      const isOnScreen = displays.some((display) => {
        const { x, y, width: dw, height: dh } = display.bounds
        // Check if at least 100px of the window is visible on this display
        return (
          saved.x! < x + dw - 100 &&
          saved.x! + width > x + 100 &&
          saved.y! < y + dh - 100 &&
          saved.y! + height > y + 100
        )
      })

      if (isOnScreen) {
        return { x: saved.x, y: saved.y, width, height }
      }
    }

    return { width, height }
  }
}

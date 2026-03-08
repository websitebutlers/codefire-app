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

export class ProjectWindow {
  private window: BrowserWindow | null = null
  private stateStore: WindowStateStore
  readonly projectId: string

  constructor(projectId: string, stateStore: WindowStateStore) {
    this.projectId = projectId
    this.stateStore = stateStore
  }

  create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus()
      return this.window
    }

    const stateKey = `project:${this.projectId}`
    const savedState = this.stateStore.get(stateKey)
    const defaults = {
      width: WINDOW_SIZES.project.width,
      height: WINDOW_SIZES.project.height,
    }

    const bounds = this.getValidBounds(savedState, defaults)

    this.window = new BrowserWindow({
      ...bounds,
      icon: getAppIcon(),
      minWidth: 800,
      minHeight: 500,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      frame: true,
      backgroundColor: '#171717',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: true,
      },
    })

    this.window.once('ready-to-show', () => {
      this.window?.show()
    })

    this.loadContent(this.window)
    this.attachStateListeners(this.window, stateKey)

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

  close(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close()
    }
  }

  private loadContent(win: BrowserWindow): void {
    if (process.env.VITE_DEV_SERVER_URL) {
      const url = new URL(process.env.VITE_DEV_SERVER_URL)
      url.searchParams.set('projectId', this.projectId)
      win.loadURL(url.toString())
      // win.webContents.openDevTools()
    } else {
      win.loadFile(path.join(process.env.DIST!, 'index.html'), {
        query: { projectId: this.projectId },
      })
    }
  }

  private attachStateListeners(win: BrowserWindow, stateKey: string): void {
    const saveState = () => {
      if (win.isDestroyed()) return
      const bounds = win.getBounds()
      const isMaximized = win.isMaximized()
      this.stateStore.set(stateKey, {
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

  private getValidBounds(
    saved: WindowState | undefined,
    defaults: { width: number; height: number }
  ): { x?: number; y?: number; width: number; height: number } {
    if (!saved) {
      return { width: defaults.width, height: defaults.height }
    }

    const width = saved.width || defaults.width
    const height = saved.height || defaults.height

    if (saved.x !== undefined && saved.y !== undefined) {
      const displays = screen.getAllDisplays()
      const isOnScreen = displays.some((display) => {
        const { x, y, width: dw, height: dh } = display.bounds
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

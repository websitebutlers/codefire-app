import { app, Menu, Tray, nativeImage } from 'electron'
import path from 'path'
import { WindowManager } from './WindowManager'

/**
 * Manages the system tray icon and context menu.
 * Supports minimize-to-tray on Windows/Linux.
 */
export class TrayManager {
  private tray: Tray | null = null
  private windowManager: WindowManager

  constructor(windowManager: WindowManager) {
    this.windowManager = windowManager
  }

  create(): Tray {
    const ext = process.platform === 'win32' ? 'ico' : 'png'
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, `icon.${ext}`)
      : path.join(__dirname, `../../../resources/icon.${ext}`)

    const icon = nativeImage.createFromPath(iconPath)
    // Resize for tray (recommended 16x16 on Windows/Linux)
    const trayIcon = icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 })

    this.tray = new Tray(trayIcon)
    this.tray.setToolTip('CodeFire')

    this.updateContextMenu()

    this.tray.on('double-click', () => {
      this.showMainWindow()
    })

    return this.tray
  }

  private updateContextMenu(): void {
    if (!this.tray) return

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show CodeFire',
        click: () => this.showMainWindow(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit()
        },
      },
    ])

    this.tray.setContextMenu(contextMenu)
  }

  private showMainWindow(): void {
    const mainWin = this.windowManager.getMainWindow()
    if (mainWin) {
      mainWin.show()
      mainWin.focus()
    } else {
      this.windowManager.createMainWindow()
    }
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }
}

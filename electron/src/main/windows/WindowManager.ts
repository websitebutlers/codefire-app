import { BrowserWindow } from 'electron'
import { MainWindow } from './MainWindow'
import { ProjectWindow } from './ProjectWindow'
import { WindowStateStore } from './WindowStateStore'

/**
 * Singleton that manages all application windows.
 *
 * - One main window (dashboard with sidebar, clients, planner, global tasks)
 * - Multiple project windows (one per project, keyed by projectId)
 *
 * Closing all project windows leaves the main window open.
 * Duplicate windows for the same project are prevented.
 */
export class WindowManager {
  private static instance: WindowManager | null = null

  private mainWindow: MainWindow
  private projectWindows: Map<string, ProjectWindow> = new Map()
  private stateStore: WindowStateStore

  constructor(stateStore?: WindowStateStore) {
    this.stateStore = stateStore ?? new WindowStateStore()
    this.mainWindow = new MainWindow(this.stateStore)
  }

  static getInstance(): WindowManager {
    if (!WindowManager.instance) {
      WindowManager.instance = new WindowManager()
    }
    return WindowManager.instance
  }

  /**
   * Reset the singleton — primarily for testing.
   */
  static resetInstance(): void {
    WindowManager.instance = null
  }

  // ─── Main Window ──────────────────────────────────────────────────────────

  createMainWindow(): BrowserWindow {
    return this.mainWindow.create()
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow.getWindow()
  }

  // ─── Project Windows ──────────────────────────────────────────────────────

  createProjectWindow(projectId: string): BrowserWindow {
    // If a window for this project already exists, focus it
    const existing = this.projectWindows.get(projectId)
    if (existing) {
      const win = existing.getWindow()
      if (win) {
        win.focus()
        return win
      }
      // Window was destroyed; clean up the stale entry
      this.projectWindows.delete(projectId)
    }

    const projectWindow = new ProjectWindow(projectId, this.stateStore)
    const win = projectWindow.create()

    this.projectWindows.set(projectId, projectWindow)

    // Auto-recover from renderer crashes (matches main window behavior)
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[PROJECT:${projectId}] Renderer crashed:`, details.reason, details.exitCode)
      if (details.reason !== 'clean-exit') {
        win.webContents.reload()
      }
    })

    win.on('closed', () => {
      this.projectWindows.delete(projectId)
    })

    return win
  }

  getProjectWindow(projectId: string): BrowserWindow | null {
    const pw = this.projectWindows.get(projectId)
    if (!pw) return null
    const win = pw.getWindow()
    if (!win) {
      this.projectWindows.delete(projectId)
      return null
    }
    return win
  }

  getAllProjectWindows(): Map<string, BrowserWindow> {
    const result = new Map<string, BrowserWindow>()
    for (const [id, pw] of this.projectWindows) {
      const win = pw.getWindow()
      if (win) {
        result.set(id, win)
      } else {
        this.projectWindows.delete(id)
      }
    }
    return result
  }

  closeProjectWindow(projectId: string): boolean {
    const pw = this.projectWindows.get(projectId)
    if (!pw) return false
    pw.close()
    this.projectWindows.delete(projectId)
    return true
  }

  /**
   * Close all windows and flush state to disk.
   */
  closeAll(): void {
    for (const [id, pw] of this.projectWindows) {
      pw.close()
      this.projectWindows.delete(id)
    }
    const mainWin = this.mainWindow.getWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.close()
    }
    this.stateStore.saveNow()
  }

  /**
   * Returns the number of open project windows.
   */
  getProjectWindowCount(): number {
    // Clean up stale entries while counting
    let count = 0
    for (const [id, pw] of this.projectWindows) {
      if (pw.getWindow()) {
        count++
      } else {
        this.projectWindows.delete(id)
      }
    }
    return count
  }
}

import { ipcMain, shell } from 'electron'
import { WindowManager } from '../windows/WindowManager'

export function registerWindowHandlers(windowManager: WindowManager) {
  ipcMain.handle('window:openProject', (_e, projectId: string) => {
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('projectId is required and must be a string')
    }
    const win = windowManager.createProjectWindow(projectId)
    return { windowId: win.id }
  })

  ipcMain.handle('window:closeProject', (_e, projectId: string) => {
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('projectId is required and must be a string')
    }
    return windowManager.closeProjectWindow(projectId)
  })

  ipcMain.handle('window:getProjectWindows', () => {
    const windows = windowManager.getAllProjectWindows()
    return Array.from(windows.keys())
  })

  ipcMain.handle('window:focusMain', () => {
    const mainWin = windowManager.getMainWindow()
    if (mainWin) {
      mainWin.focus()
      return true
    }
    return false
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:'))) {
      await shell.openExternal(url)
      return true
    }
    return false
  })
}

import { ipcMain, app } from 'electron'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { BrowserScreenshotDAO } from '../database/dao/BrowserScreenshotDAO'

export function registerBrowserScreenshotHandlers(db: Database.Database) {
  const dao = new BrowserScreenshotDAO(db)

  /**
   * Save a screenshot (data URL) to disk and record in DB.
   * Returns the file path.
   */
  ipcMain.handle(
    'browser:saveScreenshot',
    async (
      _e,
      projectId: string,
      dataUrl: string,
      pageUrl?: string,
      pageTitle?: string
    ): Promise<string> => {
      const dir = path.join(app.getPath('userData'), 'browser-screenshots')
      fs.mkdirSync(dir, { recursive: true })

      const timestamp = Date.now()
      const fileName = `screenshot-${timestamp}.png`
      const filePath = path.join(dir, fileName)

      // Strip data URL prefix and write binary
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))

      dao.create({
        projectId,
        filePath,
        pageURL: pageUrl,
        pageTitle: pageTitle,
      })

      return filePath
    }
  )

  ipcMain.handle(
    'browser:listScreenshots',
    (_e, projectId: string, limit?: number) => dao.list(projectId, limit)
  )

  ipcMain.handle(
    'browser:deleteScreenshot',
    (_e, id: number) => {
      const screenshot = dao.getById(id)
      if (screenshot) {
        // Delete file from disk
        try {
          fs.unlinkSync(screenshot.filePath)
        } catch {
          // File may already be gone
        }
        dao.delete(id)
      }
      return true
    }
  )
}

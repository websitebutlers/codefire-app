import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { PatternDAO } from '../database/dao/PatternDAO'

export function registerPatternHandlers(db: Database.Database) {
  const patternDAO = new PatternDAO(db)

  ipcMain.handle(
    'patterns:list',
    (_e, projectId: string, category?: string) =>
      patternDAO.list(projectId, category)
  )

  ipcMain.handle('patterns:get', (_e, id: number) => patternDAO.getById(id))

  ipcMain.handle(
    'patterns:create',
    (
      _e,
      data: {
        projectId: string
        category: string
        title: string
        description: string
        sourceSession?: string
        autoDetected?: boolean
      }
    ) => patternDAO.create(data)
  )

  ipcMain.handle(
    'patterns:update',
    (
      _e,
      id: number,
      data: {
        category?: string
        title?: string
        description?: string
      }
    ) => patternDAO.update(id, data)
  )

  ipcMain.handle('patterns:delete', (_e, id: number) => patternDAO.delete(id))

  ipcMain.handle(
    'patterns:categories',
    (_e, projectId: string) => patternDAO.categories(projectId)
  )
}

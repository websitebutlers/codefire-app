import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { ProjectDAO } from '../database/dao/ProjectDAO'

export function registerProjectHandlers(db: Database.Database) {
  const projectDAO = new ProjectDAO(db)

  ipcMain.handle('projects:list', () => projectDAO.list())

  ipcMain.handle('projects:get', (_e, id: string) => projectDAO.getById(id))

  ipcMain.handle('projects:getByPath', (_e, path: string) =>
    projectDAO.getByPath(path)
  )

  ipcMain.handle(
    'projects:create',
    (
      _e,
      data: {
        id?: string
        name: string
        path: string
        claudeProject?: string
        clientId?: string
        tags?: string
      }
    ) => projectDAO.create(data)
  )

  ipcMain.handle(
    'projects:update',
    (
      _e,
      id: string,
      data: {
        name?: string
        path?: string
        claudeProject?: string | null
        clientId?: string | null
        tags?: string | null
        sortOrder?: number
        color?: string | null
      }
    ) => projectDAO.update(id, data)
  )

  ipcMain.handle('projects:updateLastOpened', (_e, id: string) =>
    projectDAO.updateLastOpened(id)
  )

  ipcMain.handle('projects:delete', (_e, id: string) => projectDAO.delete(id))
}

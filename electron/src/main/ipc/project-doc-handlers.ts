import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { ProjectDocDAO } from '../database/dao/ProjectDocDAO'

export function registerProjectDocHandlers(db: Database.Database) {
  const dao = new ProjectDocDAO(db)

  ipcMain.handle('projectDocs:list', (_e, projectId: string) => dao.list(projectId))

  ipcMain.handle('projectDocs:get', (_e, id: number) => dao.getById(id))

  ipcMain.handle(
    'projectDocs:create',
    (_e, data: { projectId: string; title: string; content?: string }) => dao.create(data)
  )

  ipcMain.handle(
    'projectDocs:update',
    (_e, id: number, data: { title?: string; content?: string }) => dao.update(id, data)
  )

  ipcMain.handle('projectDocs:delete', (_e, id: number) => dao.delete(id))
}

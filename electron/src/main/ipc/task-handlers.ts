import { ipcMain, app, dialog } from 'electron'
import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { TaskDAO } from '../database/dao/TaskDAO'
import { TaskNoteDAO } from '../database/dao/TaskNoteDAO'

export function registerTaskHandlers(db: Database.Database) {
  const taskDAO = new TaskDAO(db)
  const taskNoteDAO = new TaskNoteDAO(db)

  ipcMain.handle(
    'tasks:list',
    (_e, projectId: string, status?: string) =>
      taskDAO.list(projectId, status)
  )

  ipcMain.handle('tasks:listGlobal', (_e, status?: string) =>
    taskDAO.listGlobal(status)
  )

  ipcMain.handle('tasks:listAll', (_e, status?: string) =>
    taskDAO.listAll(status)
  )

  ipcMain.handle('tasks:get', (_e, id: number) => taskDAO.getById(id))

  ipcMain.handle(
    'tasks:create',
    (
      _e,
      data: {
        projectId: string
        title: string
        description?: string
        priority?: number
        source?: string
        labels?: string[]
        isGlobal?: boolean
      }
    ) => taskDAO.create(data)
  )

  ipcMain.handle(
    'tasks:update',
    (
      _e,
      id: number,
      data: {
        title?: string
        description?: string
        status?: string
        priority?: number
        labels?: string[]
      }
    ) => taskDAO.update(id, data)
  )

  ipcMain.handle('tasks:delete', (_e, id: number) => taskDAO.delete(id))

  // Attachments
  ipcMain.handle(
    'tasks:addAttachment',
    async (_e, taskId: number, filePath?: string) => {
      let targetPath = filePath
      if (!targetPath) {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        })
        if (result.canceled || result.filePaths.length === 0) return undefined
        targetPath = result.filePaths[0]
      }
      // Copy to app data attachments folder
      const attachDir = path.join(app.getPath('userData'), 'attachments')
      if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true })
      const fileName = `${Date.now()}-${path.basename(targetPath)}`
      const destPath = path.join(attachDir, fileName)
      fs.copyFileSync(targetPath, destPath)
      return taskDAO.addAttachment(taskId, destPath)
    }
  )

  ipcMain.handle(
    'tasks:removeAttachment',
    (_e, taskId: number, filePath: string) =>
      taskDAO.removeAttachment(taskId, filePath)
  )

  // Task notes
  ipcMain.handle('taskNotes:list', (_e, taskId: number) =>
    taskNoteDAO.list(taskId)
  )

  ipcMain.handle(
    'taskNotes:create',
    (
      _e,
      data: {
        taskId: number
        content: string
        source?: string
        sessionId?: string
      }
    ) => taskNoteDAO.create(data)
  )

  ipcMain.handle('taskNotes:delete', (_e, noteId: number) =>
    taskNoteDAO.delete(noteId)
  )
}

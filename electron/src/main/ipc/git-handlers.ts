import { ipcMain } from 'electron'
import { GitService } from '../services/GitService'

/**
 * Register IPC handlers for git operations.
 *
 * All handlers delegate to the GitService, which shells out to the git CLI.
 * Each operation takes a `projectPath` as its first argument.
 */
export function registerGitHandlers(gitService: GitService) {
  ipcMain.handle('git:status', (_event, projectPath: string) => {
    if (!projectPath || typeof projectPath !== 'string') {
      throw new Error('projectPath is required and must be a string')
    }
    return gitService.status(projectPath)
  })

  ipcMain.handle(
    'git:diff',
    (
      _event,
      projectPath: string,
      options?: { staged?: boolean; file?: string }
    ) => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }
      return gitService.diff(projectPath, options)
    }
  )

  ipcMain.handle(
    'git:log',
    (
      _event,
      projectPath: string,
      options?: { limit?: number; file?: string }
    ) => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }
      return gitService.log(projectPath, options)
    }
  )

  ipcMain.handle(
    'git:stage',
    (_event, projectPath: string, files: string[]) => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error('files must be a non-empty array of strings')
      }
      return gitService.stage(projectPath, files)
    }
  )

  ipcMain.handle(
    'git:unstage',
    (_event, projectPath: string, files: string[]) => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error('files must be a non-empty array of strings')
      }
      return gitService.unstage(projectPath, files)
    }
  )

  ipcMain.handle(
    'git:commit',
    (_event, projectPath: string, message: string) => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }
      if (!message || typeof message !== 'string') {
        throw new Error('message is required and must be a string')
      }
      return gitService.commit(projectPath, message)
    }
  )
}

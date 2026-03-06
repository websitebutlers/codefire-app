import { ipcMain } from 'electron'
import type { SearchEngine, SearchOptions } from '../services/SearchEngine'
import type { ContextEngine } from '../services/ContextEngine'
import { ProjectDAO } from '../database/dao/ProjectDAO'
import { IndexDAO } from '../database/dao/IndexDAO'
import Database from 'better-sqlite3'

/**
 * Register IPC handlers for search and re-indexing operations.
 */
export function registerSearchHandlers(
  db: Database.Database,
  searchEngine: SearchEngine,
  contextEngine: ContextEngine
) {
  const projectDAO = new ProjectDAO(db)
  const indexDAO = new IndexDAO(db)

  ipcMain.handle(
    'search:query',
    async (
      _event,
      projectId: string,
      query: string,
      options?: SearchOptions
    ) => {
      if (!projectId || typeof projectId !== 'string') {
        throw new Error('projectId is required and must be a string')
      }
      if (!query || typeof query !== 'string') {
        throw new Error('query is required and must be a string')
      }
      return searchEngine.search(projectId, query, options)
    }
  )

  ipcMain.handle(
    'search:reindex',
    async (_event, projectId: string) => {
      if (!projectId || typeof projectId !== 'string') {
        throw new Error('projectId is required and must be a string')
      }

      const project = projectDAO.getById(projectId)
      if (!project) {
        throw new Error(`Project not found: ${projectId}`)
      }

      await contextEngine.indexProject(projectId, project.path)
      return { success: true }
    }
  )

  ipcMain.handle(
    'search:getIndexState',
    async (_event, projectId: string) => {
      if (!projectId || typeof projectId !== 'string') {
        throw new Error('projectId is required and must be a string')
      }
      return indexDAO.getState(projectId) ?? null
    }
  )

  ipcMain.handle(
    'search:clearIndex',
    async (_event, projectId: string) => {
      if (!projectId || typeof projectId !== 'string') {
        throw new Error('projectId is required and must be a string')
      }

      // Delete all indexed files and code chunks for this project
      db.prepare('DELETE FROM codeChunks WHERE projectId = ?').run(projectId)
      db.prepare('DELETE FROM indexedFiles WHERE projectId = ?').run(projectId)
      indexDAO.updateState(projectId, {
        status: 'idle',
        totalChunks: 0,
        lastFullIndexAt: null,
        lastError: null,
      })
      return { success: true }
    }
  )
}

import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import Database from 'better-sqlite3'
import { SessionDAO } from '../database/dao/SessionDAO'
import { ProjectDAO } from '../database/dao/ProjectDAO'
import { parseLiveSession, type LiveSessionState } from '../services/SessionParser'

export function registerSessionHandlers(db: Database.Database) {
  const sessionDAO = new SessionDAO(db)

  ipcMain.handle('sessions:list', (_e, projectId: string) =>
    sessionDAO.list(projectId)
  )

  ipcMain.handle('sessions:get', (_e, id: string) => sessionDAO.getById(id))

  ipcMain.handle(
    'sessions:create',
    (
      _e,
      data: {
        id: string
        projectId: string
        slug?: string
        startedAt?: string
        model?: string
        gitBranch?: string
        summary?: string
      }
    ) => sessionDAO.create(data)
  )

  ipcMain.handle(
    'sessions:update',
    (
      _e,
      id: string,
      data: {
        endedAt?: string
        summary?: string
        messageCount?: number
        toolUseCount?: number
        filesChanged?: string
        inputTokens?: number
        outputTokens?: number
        cacheCreationTokens?: number
        cacheReadTokens?: number
      }
    ) => sessionDAO.update(id, data)
  )

  ipcMain.handle('sessions:search', (_e, query: string) =>
    sessionDAO.searchFTS(query)
  )

  ipcMain.handle('sessions:getLiveState', (_e, projectId: string): LiveSessionState | null => {
    const projectDAO = new ProjectDAO(db)
    const project = projectDAO.getById(projectId)
    if (!project?.claudeProject) return null

    const sessionDir = path.join(homedir(), '.claude', 'projects', project.claudeProject)
    try {
      if (!fs.statSync(sessionDir).isDirectory()) return null
    } catch {
      return null
    }

    // Find the most recently modified .jsonl file
    const files = fs.readdirSync(sessionDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const fullPath = path.join(sessionDir, f)
        try {
          const stat = fs.statSync(fullPath)
          return { name: f, path: fullPath, mtime: stat.mtimeMs }
        } catch {
          return null
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length === 0) return null

    const latest = files[0]
    const sessionId = latest.name.replace('.jsonl', '')

    try {
      const content = fs.readFileSync(latest.path, 'utf-8')
      return parseLiveSession(content, sessionId)
    } catch {
      return null
    }
  })
}

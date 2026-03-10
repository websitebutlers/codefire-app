// ─── Session Watcher ────────────────────────────────────────────────────────
//
// Watches a Claude project directory for new/modified .jsonl session files
// and automatically imports them into the database.
//
// Uses chokidar for cross-platform file watching with debouncing.
//

import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import { watch, type FSWatcher } from 'chokidar'
import Database from 'better-sqlite3'
import { SessionDAO } from '../database/dao/SessionDAO'
import { parseSessionFile } from './SessionParser'

export type SessionChangeCallback = (sessionId: string, projectId: string) => void

interface WatcherState {
  watcher: FSWatcher
  projectId: string
  encodedName: string
  debounceTimer: ReturnType<typeof setTimeout> | null
  pendingFiles: Set<string>
}

/**
 * Watches Claude project directories for session file changes and
 * automatically syncs them to the database.
 */
export class SessionWatcher {
  private watchers = new Map<string, WatcherState>()
  private db: Database.Database
  private onChange: SessionChangeCallback | null = null
  private debounceMs: number

  constructor(db: Database.Database, debounceMs = 5000) {
    this.db = db
    this.debounceMs = debounceMs
  }

  /**
   * Register a callback to be notified when sessions are updated.
   */
  onSessionChange(callback: SessionChangeCallback): void {
    this.onChange = callback
  }

  /**
   * Start watching a Claude project directory for session changes.
   *
   * @param projectId - The database project ID
   * @param encodedName - The encoded Claude directory name
   */
  watchProject(projectId: string, encodedName: string): void {
    // Don't watch the same project twice
    if (this.watchers.has(projectId)) return

    const watchDir = path.join(homedir(), '.claude', 'projects', encodedName)

    // Verify the directory exists
    try {
      if (!fs.statSync(watchDir).isDirectory()) return
    } catch {
      return
    }

    const watcher = watch(path.join(watchDir, '*.jsonl'), {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 200,
      },
    })

    const state: WatcherState = {
      watcher,
      projectId,
      encodedName,
      debounceTimer: null,
      pendingFiles: new Set(),
    }

    watcher.on('add', (filePath: string) => this.handleFileEvent(state, filePath))
    watcher.on('change', (filePath: string) => this.handleFileEvent(state, filePath))

    this.watchers.set(projectId, state)
  }

  /**
   * Stop watching a specific project.
   */
  async unwatchProject(projectId: string): Promise<void> {
    const state = this.watchers.get(projectId)
    if (!state) return

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
    }
    await state.watcher.close()
    this.watchers.delete(projectId)
  }

  /**
   * Stop watching all projects. Call on app quit.
   */
  async unwatchAll(): Promise<void> {
    const promises = Array.from(this.watchers.keys()).map((id) => this.unwatchProject(id))
    await Promise.all(promises)
  }

  /**
   * Handle a file event (add or change) with debouncing.
   */
  private handleFileEvent(state: WatcherState, filePath: string): void {
    const filename = path.basename(filePath)

    // Only process .jsonl files with UUID names
    if (!filename.endsWith('.jsonl')) return
    const sessionId = filename.replace('.jsonl', '')
    if (!isUUID(sessionId)) return

    state.pendingFiles.add(filePath)

    // Reset debounce timer
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
    }

    state.debounceTimer = setTimeout(() => {
      this.processPendingFiles(state)
    }, this.debounceMs)
  }

  /**
   * Process all pending file changes after debounce period.
   */
  private processPendingFiles(state: WatcherState): void {
    const sessionDAO = new SessionDAO(this.db)
    const filesToProcess = Array.from(state.pendingFiles)
    state.pendingFiles.clear()
    state.debounceTimer = null

    for (const filePath of filesToProcess) {
      const filename = path.basename(filePath)
      const sessionId = filename.replace('.jsonl', '')

      // Skip if session already exists with token data
      const existing = sessionDAO.getById(sessionId)
      if (existing && (existing.inputTokens > 0 || existing.outputTokens > 0)) {
        continue
      }

      let content: string
      try {
        content = fs.readFileSync(filePath, 'utf-8')
      } catch {
        continue
      }

      const parsed = parseSessionFile(content, sessionId)

      const updateData = {
        endedAt: parsed.endedAt ?? undefined,
        summary: parsed.summary ?? undefined,
        messageCount: parsed.messageCount,
        toolUseCount: parsed.toolUseCount,
        filesChanged:
          parsed.filesChanged.length > 0 ? JSON.stringify(parsed.filesChanged) : undefined,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        cacheCreationTokens: parsed.cacheCreationTokens,
        cacheReadTokens: parsed.cacheReadTokens,
      }

      if (existing) {
        sessionDAO.update(sessionId, updateData)
      } else {
        sessionDAO.create({
          id: sessionId,
          projectId: state.projectId,
          slug: parsed.slug ?? undefined,
          startedAt: parsed.startedAt ?? undefined,
          model: parsed.model ?? undefined,
          gitBranch: parsed.gitBranch ?? undefined,
        })
        sessionDAO.update(sessionId, updateData)
      }

      // Notify listeners
      this.onChange?.(sessionId, state.projectId)
    }
  }
}

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

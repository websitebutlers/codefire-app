import Database from 'better-sqlite3'
import type { Session } from '@shared/models'
import { sanitizeFtsQuery } from '../fts-utils'

export class SessionDAO {
  constructor(private db: Database.Database) {}

  list(projectId: string): Session[] {
    return this.db
      .prepare('SELECT * FROM sessions WHERE projectId = ? ORDER BY startedAt DESC')
      .all(projectId) as Session[]
  }

  getById(id: string): Session | undefined {
    return this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as Session | undefined
  }

  create(data: {
    id: string
    projectId: string
    slug?: string
    startedAt?: string
    model?: string
    gitBranch?: string
    summary?: string
  }): Session {
    this.db
      .prepare(
        `INSERT INTO sessions (id, projectId, slug, startedAt, model, gitBranch, summary, messageCount, toolUseCount, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0)`
      )
      .run(
        data.id,
        data.projectId,
        data.slug ?? null,
        data.startedAt ?? new Date().toISOString(),
        data.model ?? null,
        data.gitBranch ?? null,
        data.summary ?? null
      )
    return this.getById(data.id)!
  }

  update(
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
  ): Session | undefined {
    const existing = this.getById(id)
    if (!existing) return undefined

    this.db
      .prepare(
        `UPDATE sessions
         SET endedAt = ?, summary = ?, messageCount = ?, toolUseCount = ?,
             filesChanged = ?, inputTokens = ?, outputTokens = ?,
             cacheCreationTokens = ?, cacheReadTokens = ?
         WHERE id = ?`
      )
      .run(
        data.endedAt ?? existing.endedAt,
        data.summary ?? existing.summary,
        data.messageCount ?? existing.messageCount,
        data.toolUseCount ?? existing.toolUseCount,
        data.filesChanged ?? existing.filesChanged,
        data.inputTokens ?? existing.inputTokens,
        data.outputTokens ?? existing.outputTokens,
        data.cacheCreationTokens ?? existing.cacheCreationTokens,
        data.cacheReadTokens ?? existing.cacheReadTokens,
        id
      )
    return this.getById(id)
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM sessions WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  searchFTS(query: string): Session[] {
    const sanitized = sanitizeFtsQuery(query)
    if (!sanitized) return []

    return this.db
      .prepare(
        `SELECT sessions.* FROM sessions
         JOIN sessionsFts ON sessions.rowid = sessionsFts.rowid
         WHERE sessionsFts MATCH ?
         ORDER BY rank`
      )
      .all(sanitized) as Session[]
  }
}

import Database from 'better-sqlite3'
import type { Note } from '@shared/models'

export class NoteDAO {
  constructor(private db: Database.Database) {}

  list(projectId: string, pinnedOnly?: boolean, isGlobal?: boolean): Note[] {
    if (isGlobal) {
      if (pinnedOnly) {
        return this.db
          .prepare(
            'SELECT * FROM notes WHERE isGlobal = 1 AND pinned = 1 ORDER BY updatedAt DESC'
          )
          .all() as Note[]
      }
      return this.db
        .prepare('SELECT * FROM notes WHERE isGlobal = 1 ORDER BY updatedAt DESC')
        .all() as Note[]
    }

    if (pinnedOnly) {
      return this.db
        .prepare(
          'SELECT * FROM notes WHERE projectId = ? AND pinned = 1 ORDER BY updatedAt DESC'
        )
        .all(projectId) as Note[]
    }
    return this.db
      .prepare('SELECT * FROM notes WHERE projectId = ? ORDER BY updatedAt DESC')
      .all(projectId) as Note[]
  }

  getById(id: number): Note | undefined {
    return this.db
      .prepare('SELECT * FROM notes WHERE id = ?')
      .get(id) as Note | undefined
  }

  create(data: {
    projectId: string
    title: string
    content?: string
    pinned?: boolean
    sessionId?: string
    isGlobal?: boolean
  }): Note {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO notes (projectId, title, content, pinned, sessionId, isGlobal, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.projectId,
        data.title,
        data.content ?? '',
        data.pinned ? 1 : 0,
        data.sessionId ?? null,
        data.isGlobal ? 1 : 0,
        now,
        now
      )
    return this.getById(Number(result.lastInsertRowid))!
  }

  update(
    id: number,
    data: {
      title?: string
      content?: string
      pinned?: boolean
    }
  ): Note | undefined {
    const existing = this.getById(id)
    if (!existing) return undefined

    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE notes SET title = ?, content = ?, pinned = ?, updatedAt = ? WHERE id = ?`
      )
      .run(
        data.title ?? existing.title,
        data.content ?? existing.content,
        data.pinned !== undefined ? (data.pinned ? 1 : 0) : existing.pinned,
        now,
        id
      )
    return this.getById(id)
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM notes WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  searchFTS(projectId: string, query: string, isGlobal?: boolean): Note[] {
    if (isGlobal) {
      return this.db
        .prepare(
          `SELECT notes.* FROM notes
           JOIN notesFts ON notes.id = notesFts.rowid
           WHERE notesFts MATCH ? AND notes.isGlobal = 1
           ORDER BY rank`
        )
        .all(query) as Note[]
    }
    return this.db
      .prepare(
        `SELECT notes.* FROM notes
         JOIN notesFts ON notes.id = notesFts.rowid
         WHERE notesFts MATCH ? AND notes.projectId = ?
         ORDER BY rank`
      )
      .all(query, projectId) as Note[]
  }
}

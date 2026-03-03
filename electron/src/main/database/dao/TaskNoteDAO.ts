import Database from 'better-sqlite3'
import type { TaskNote } from '@shared/models'

export class TaskNoteDAO {
  constructor(private db: Database.Database) {}

  list(taskId: number): TaskNote[] {
    return this.db
      .prepare('SELECT * FROM taskNotes WHERE taskId = ? ORDER BY createdAt ASC')
      .all(taskId) as TaskNote[]
  }

  getById(id: number): TaskNote | undefined {
    return this.db
      .prepare('SELECT * FROM taskNotes WHERE id = ?')
      .get(id) as TaskNote | undefined
  }

  create(data: {
    taskId: number
    content: string
    source?: string
    sessionId?: string
  }): TaskNote {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO taskNotes (taskId, content, source, sessionId, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        data.taskId,
        data.content,
        data.source ?? 'manual',
        data.sessionId ?? null,
        now
      )
    return this.getById(Number(result.lastInsertRowid))!
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM taskNotes WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}

import Database from 'better-sqlite3'
import type { TaskItem } from '@shared/models'

export class TaskDAO {
  constructor(private db: Database.Database) {}

  list(projectId: string, status?: string): TaskItem[] {
    if (status) {
      return this.db
        .prepare(
          'SELECT * FROM taskItems WHERE projectId = ? AND status = ? ORDER BY createdAt DESC'
        )
        .all(projectId, status) as TaskItem[]
    }
    return this.db
      .prepare(
        'SELECT * FROM taskItems WHERE projectId = ? ORDER BY createdAt DESC'
      )
      .all(projectId) as TaskItem[]
  }

  listAll(status?: string): TaskItem[] {
    if (status) {
      return this.db
        .prepare(
          'SELECT * FROM taskItems WHERE status = ? ORDER BY createdAt DESC'
        )
        .all(status) as TaskItem[]
    }
    return this.db
      .prepare(
        'SELECT * FROM taskItems ORDER BY createdAt DESC'
      )
      .all() as TaskItem[]
  }

  listGlobal(status?: string): TaskItem[] {
    if (status) {
      return this.db
        .prepare(
          'SELECT * FROM taskItems WHERE status = ? ORDER BY createdAt DESC'
        )
        .all(status) as TaskItem[]
    }
    return this.db
      .prepare(
        'SELECT * FROM taskItems ORDER BY createdAt DESC'
      )
      .all() as TaskItem[]
  }

  getById(id: number): TaskItem | undefined {
    return this.db
      .prepare('SELECT * FROM taskItems WHERE id = ?')
      .get(id) as TaskItem | undefined
  }

  create(data: {
    projectId: string
    title: string
    description?: string
    priority?: number
    source?: string
    labels?: string[]
    isGlobal?: boolean
  }): TaskItem {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO taskItems (projectId, title, description, status, priority, source, labels, isGlobal, createdAt)
         VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, ?)`
      )
      .run(
        data.projectId,
        data.title,
        data.description ?? null,
        Math.min(4, Math.max(0, data.priority ?? 0)),
        data.source ?? 'claude',
        data.labels ? JSON.stringify(data.labels) : null,
        data.isGlobal ? 1 : 0,
        now
      )
    return this.getById(Number(result.lastInsertRowid))!
  }

  update(
    id: number,
    data: {
      title?: string
      description?: string
      status?: string
      priority?: number
      labels?: string[]
      attachments?: string[]
    }
  ): TaskItem | undefined {
    const existing = this.getById(id)
    if (!existing) return undefined

    const completedAt =
      data.status === 'done' && existing.status !== 'done'
        ? new Date().toISOString()
        : data.status && data.status !== 'done'
          ? null
          : existing.completedAt

    this.db
      .prepare(
        `UPDATE taskItems
         SET title = ?, description = ?, status = ?, priority = ?, labels = ?, attachments = ?, completedAt = ?
         WHERE id = ?`
      )
      .run(
        data.title ?? existing.title,
        data.description ?? existing.description,
        data.status ?? existing.status,
        data.priority ?? existing.priority,
        data.labels ? JSON.stringify(data.labels) : existing.labels,
        data.attachments ? JSON.stringify(data.attachments) : existing.attachments,
        completedAt,
        id
      )
    return this.getById(id)
  }

  addAttachment(id: number, filePath: string): TaskItem | undefined {
    const existing = this.getById(id)
    if (!existing) return undefined
    const current: string[] = existing.attachments ? JSON.parse(existing.attachments) : []
    current.push(filePath)
    return this.update(id, { attachments: current })
  }

  removeAttachment(id: number, filePath: string): TaskItem | undefined {
    const existing = this.getById(id)
    if (!existing) return undefined
    const current: string[] = existing.attachments ? JSON.parse(existing.attachments) : []
    const filtered = current.filter((p) => p !== filePath)
    return this.update(id, { attachments: filtered })
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM taskItems WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}

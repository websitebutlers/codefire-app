import Database from 'better-sqlite3'
import type { Pattern } from '@shared/models'

export class PatternDAO {
  constructor(private db: Database.Database) {}

  list(projectId: string, category?: string): Pattern[] {
    if (category) {
      return this.db
        .prepare(
          'SELECT * FROM patterns WHERE projectId = ? AND category = ? ORDER BY category, createdAt DESC'
        )
        .all(projectId, category) as Pattern[]
    }
    return this.db
      .prepare(
        'SELECT * FROM patterns WHERE projectId = ? ORDER BY category, createdAt DESC'
      )
      .all(projectId) as Pattern[]
  }

  getById(id: number): Pattern | undefined {
    return this.db
      .prepare('SELECT * FROM patterns WHERE id = ?')
      .get(id) as Pattern | undefined
  }

  create(data: {
    projectId: string
    category: string
    title: string
    description: string
    sourceSession?: string
    autoDetected?: boolean
  }): Pattern {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO patterns (projectId, category, title, description, sourceSession, autoDetected, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.projectId,
        data.category,
        data.title,
        data.description,
        data.sourceSession ?? null,
        data.autoDetected ? 1 : 0,
        now
      )
    return this.getById(Number(result.lastInsertRowid))!
  }

  update(
    id: number,
    data: {
      category?: string
      title?: string
      description?: string
    }
  ): Pattern | undefined {
    const existing = this.getById(id)
    if (!existing) return undefined

    this.db
      .prepare(
        'UPDATE patterns SET category = ?, title = ?, description = ? WHERE id = ?'
      )
      .run(
        data.category ?? existing.category,
        data.title ?? existing.title,
        data.description ?? existing.description,
        id
      )
    return this.getById(id)
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM patterns WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  categories(projectId: string): string[] {
    const rows = this.db
      .prepare(
        'SELECT DISTINCT category FROM patterns WHERE projectId = ? ORDER BY category'
      )
      .all(projectId) as Array<{ category: string }>
    return rows.map((r) => r.category)
  }
}

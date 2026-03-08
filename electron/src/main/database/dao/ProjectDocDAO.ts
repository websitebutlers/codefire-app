import Database from 'better-sqlite3'

export interface LocalProjectDoc {
  id: number
  projectId: string
  title: string
  content: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export class ProjectDocDAO {
  constructor(private db: Database.Database) {}

  list(projectId: string): LocalProjectDoc[] {
    return this.db
      .prepare('SELECT * FROM projectDocs WHERE projectId = ? ORDER BY sortOrder ASC, createdAt ASC')
      .all(projectId) as LocalProjectDoc[]
  }

  getById(id: number): LocalProjectDoc | undefined {
    return this.db
      .prepare('SELECT * FROM projectDocs WHERE id = ?')
      .get(id) as LocalProjectDoc | undefined
  }

  create(data: { projectId: string; title: string; content?: string }): LocalProjectDoc {
    const now = new Date().toISOString()

    // Get next sort order
    const last = this.db
      .prepare('SELECT MAX(sortOrder) as maxOrder FROM projectDocs WHERE projectId = ?')
      .get(data.projectId) as { maxOrder: number | null } | undefined
    const nextOrder = (last?.maxOrder ?? -1) + 1

    const result = this.db
      .prepare(
        `INSERT INTO projectDocs (projectId, title, content, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(data.projectId, data.title, data.content ?? '', nextOrder, now, now)

    return this.getById(Number(result.lastInsertRowid))!
  }

  update(id: number, data: { title?: string; content?: string }): LocalProjectDoc | undefined {
    const existing = this.getById(id)
    if (!existing) return undefined

    const now = new Date().toISOString()
    this.db
      .prepare('UPDATE projectDocs SET title = ?, content = ?, updatedAt = ? WHERE id = ?')
      .run(data.title ?? existing.title, data.content ?? existing.content, now, id)

    return this.getById(id)
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM projectDocs WHERE id = ?').run(id)
    return result.changes > 0
  }
}

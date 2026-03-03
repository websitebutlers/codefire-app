import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { Project } from '@shared/models'

export class ProjectDAO {
  constructor(private db: Database.Database) {}

  list(): Project[] {
    return this.db
      .prepare('SELECT * FROM projects ORDER BY sortOrder ASC, name ASC')
      .all() as Project[]
  }

  getById(id: string): Project | undefined {
    return this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as Project | undefined
  }

  getByPath(path: string): Project | undefined {
    return this.db
      .prepare('SELECT * FROM projects WHERE path = ?')
      .get(path) as Project | undefined
  }

  create(data: {
    id?: string
    name: string
    path: string
    claudeProject?: string
    clientId?: string
    tags?: string
  }): Project {
    const id = data.id ?? randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO projects (id, name, path, claudeProject, createdAt, clientId, tags, sortOrder)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        id,
        data.name,
        data.path,
        data.claudeProject ?? null,
        now,
        data.clientId ?? null,
        data.tags ?? null
      )
    return this.getById(id)!
  }

  update(
    id: string,
    data: {
      name?: string
      path?: string
      claudeProject?: string | null
      clientId?: string | null
      tags?: string | null
      sortOrder?: number
    }
  ): Project | undefined {
    const existing = this.getById(id)
    if (!existing) return undefined

    this.db
      .prepare(
        `UPDATE projects
         SET name = ?, path = ?, claudeProject = ?, clientId = ?, tags = ?, sortOrder = ?
         WHERE id = ?`
      )
      .run(
        data.name ?? existing.name,
        data.path ?? existing.path,
        data.claudeProject !== undefined ? data.claudeProject : existing.claudeProject,
        data.clientId !== undefined ? data.clientId : existing.clientId,
        data.tags !== undefined ? data.tags : existing.tags,
        data.sortOrder ?? existing.sortOrder,
        id
      )
    return this.getById(id)
  }

  updateLastOpened(id: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare('UPDATE projects SET lastOpened = ? WHERE id = ?')
      .run(now, id)
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM projects WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}

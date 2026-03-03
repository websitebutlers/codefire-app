import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { Client } from '@shared/models'

export class ClientDAO {
  constructor(private db: Database.Database) {}

  list(): Client[] {
    return this.db
      .prepare('SELECT * FROM clients ORDER BY sortOrder ASC, name ASC')
      .all() as Client[]
  }

  getById(id: string): Client | undefined {
    return this.db
      .prepare('SELECT * FROM clients WHERE id = ?')
      .get(id) as Client | undefined
  }

  create(data: { name: string; color?: string }): Client {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO clients (id, name, color, sortOrder, createdAt)
         VALUES (?, ?, ?, 0, ?)`
      )
      .run(id, data.name, data.color ?? '#3B82F6', now)
    return this.getById(id)!
  }

  update(
    id: string,
    data: {
      name?: string
      color?: string
      sortOrder?: number
    }
  ): Client | undefined {
    const existing = this.getById(id)
    if (!existing) return undefined

    this.db
      .prepare(
        `UPDATE clients SET name = ?, color = ?, sortOrder = ? WHERE id = ?`
      )
      .run(
        data.name ?? existing.name,
        data.color ?? existing.color,
        data.sortOrder ?? existing.sortOrder,
        id
      )
    return this.getById(id)
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM clients WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}

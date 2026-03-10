import Database from 'better-sqlite3'
import type { BrowserScreenshot } from '@shared/models'

export class BrowserScreenshotDAO {
  constructor(private db: Database.Database) {}

  list(projectId: string, limit = 20): BrowserScreenshot[] {
    return this.db
      .prepare(
        'SELECT * FROM browserScreenshots WHERE projectId = ? ORDER BY createdAt DESC LIMIT ?'
      )
      .all(projectId, limit) as BrowserScreenshot[]
  }

  getById(id: number): BrowserScreenshot | undefined {
    return this.db
      .prepare('SELECT * FROM browserScreenshots WHERE id = ?')
      .get(id) as BrowserScreenshot | undefined
  }

  create(data: {
    projectId: string
    filePath: string
    pageURL?: string
    pageTitle?: string
  }): BrowserScreenshot {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO browserScreenshots (projectId, filePath, pageURL, pageTitle, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        data.projectId,
        data.filePath,
        data.pageURL ?? null,
        data.pageTitle ?? null,
        now
      )
    return this.getById(Number(result.lastInsertRowid))!
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM browserScreenshots WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}

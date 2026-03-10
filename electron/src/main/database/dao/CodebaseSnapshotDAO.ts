import Database from 'better-sqlite3'
import type { CodebaseSnapshot } from '@shared/models'

export class CodebaseSnapshotDAO {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  getLatest(projectId: string): CodebaseSnapshot | undefined {
    return this.db
      .prepare(
        'SELECT * FROM codebaseSnapshots WHERE projectId = ? ORDER BY capturedAt DESC LIMIT 1'
      )
      .get(projectId) as CodebaseSnapshot | undefined
  }

  upsert(data: {
    projectId: string
    fileTree?: string | null
    schemaHash?: string | null
    keySymbols?: string | null
    profileText?: string | null
  }): CodebaseSnapshot {
    // Delete previous snapshots for this project (keep only latest)
    this.db
      .prepare('DELETE FROM codebaseSnapshots WHERE projectId = ?')
      .run(data.projectId)

    const result = this.db
      .prepare(
        `INSERT INTO codebaseSnapshots (projectId, capturedAt, fileTree, schemaHash, keySymbols, profileText)
         VALUES (?, datetime('now'), ?, ?, ?, ?)`
      )
      .run(
        data.projectId,
        data.fileTree ?? null,
        data.schemaHash ?? null,
        data.keySymbols ?? null,
        data.profileText ?? null
      )

    return this.db
      .prepare('SELECT * FROM codebaseSnapshots WHERE id = ?')
      .get(result.lastInsertRowid) as CodebaseSnapshot
  }

  deleteByProject(projectId: string): void {
    this.db
      .prepare('DELETE FROM codebaseSnapshots WHERE projectId = ?')
      .run(projectId)
  }
}

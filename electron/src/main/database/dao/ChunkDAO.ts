import Database from 'better-sqlite3'
import type { CodeChunk } from '@shared/models'

export class ChunkDAO {
  constructor(private db: Database.Database) {}

  /**
   * Insert a code chunk (used during indexing).
   */
  insert(chunk: {
    id: string
    fileId: string
    projectId: string
    chunkType: string
    symbolName: string | null
    content: string
    startLine: number | null
    endLine: number | null
    embedding: Buffer | null
  }): void {
    this.db
      .prepare(
        `INSERT INTO codeChunks (id, fileId, projectId, chunkType, symbolName, content, startLine, endLine, embedding)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        chunk.id,
        chunk.fileId,
        chunk.projectId,
        chunk.chunkType,
        chunk.symbolName,
        chunk.content,
        chunk.startLine,
        chunk.endLine,
        chunk.embedding
      )
  }

  /**
   * Get all chunks for a project.
   */
  listByProject(projectId: string): CodeChunk[] {
    return this.db
      .prepare('SELECT * FROM codeChunks WHERE projectId = ?')
      .all(projectId) as CodeChunk[]
  }

  /**
   * Get all chunks for a file.
   */
  listByFile(fileId: string): CodeChunk[] {
    return this.db
      .prepare('SELECT * FROM codeChunks WHERE fileId = ?')
      .all(fileId) as CodeChunk[]
  }

  /**
   * Delete all chunks for a file (before re-indexing).
   */
  deleteByFile(fileId: string): void {
    this.db.prepare('DELETE FROM codeChunks WHERE fileId = ?').run(fileId)
  }

  /**
   * Delete all chunks for a project.
   */
  deleteByProject(projectId: string): void {
    this.db.prepare('DELETE FROM codeChunks WHERE projectId = ?').run(projectId)
  }

  /**
   * FTS keyword search using the codeChunksFts virtual table.
   * FTS5 BM25 rank values are negative (more negative = better match).
   * We normalize them to positive values for consistent scoring.
   */
  searchFTS(
    projectId: string,
    query: string,
    limit: number = 20
  ): (CodeChunk & { rank: number })[] {
    // Escape special FTS5 characters to prevent syntax errors
    const sanitized = sanitizeFtsQuery(query)
    if (!sanitized) return []

    const rows = this.db
      .prepare(
        `SELECT c.*, codeChunksFts.rank
         FROM codeChunks c
         JOIN codeChunksFts ON c.rowid = codeChunksFts.rowid
         WHERE codeChunksFts MATCH ?
           AND c.projectId = ?
         ORDER BY codeChunksFts.rank
         LIMIT ?`
      )
      .all(sanitized, projectId, limit) as (CodeChunk & { rank: number })[]

    // Normalize ranks from negative to positive (FTS5 BM25 ranks are negative)
    return rows.map((row) => ({
      ...row,
      rank: Math.abs(row.rank),
    }))
  }

  /**
   * Get all chunks with non-null embeddings for a project (for vector search).
   */
  getChunksWithEmbeddings(
    projectId: string
  ): (CodeChunk & { embedding: Buffer })[] {
    return this.db
      .prepare(
        'SELECT * FROM codeChunks WHERE projectId = ? AND embedding IS NOT NULL'
      )
      .all(projectId) as (CodeChunk & { embedding: Buffer })[]
  }

  /**
   * Update the embedding for a chunk.
   */
  updateEmbedding(chunkId: string, embedding: Buffer): void {
    this.db
      .prepare('UPDATE codeChunks SET embedding = ? WHERE id = ?')
      .run(embedding, chunkId)
  }

  /**
   * Get total chunk count for a project.
   */
  countByProject(projectId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM codeChunks WHERE projectId = ?')
      .get(projectId) as { count: number }
    return row.count
  }
}

/**
 * Sanitize a query string for FTS5 MATCH syntax.
 * Wraps each token in quotes to treat them as literal terms.
 */
function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .replace(/['"]/g, '') // Remove quotes
    .split(/\s+/)
    .filter((t) => t.length > 0)

  if (tokens.length === 0) return ''

  // Wrap each token in double quotes to escape FTS5 special characters
  return tokens.map((t) => `"${t}"`).join(' ')
}

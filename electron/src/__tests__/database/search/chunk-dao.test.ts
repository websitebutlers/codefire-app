import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Migrator } from '../../../main/database/migrator'
import { migrations } from '../../../main/database/migrations'
import { ChunkDAO } from '../../../main/database/dao/ChunkDAO'
import { float32ArrayToBlob } from '../../../main/database/search/vector-search'

describe('ChunkDAO', () => {
  let db: Database.Database
  let dbPath: string
  let dao: ChunkDAO
  const projectId = 'test-project'
  const fileId = 'test-file-1'

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-chunk-dao-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    )
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const migrator = new Migrator(db, migrations)
    migrator.migrate()
    dao = new ChunkDAO(db)

    // Insert prerequisite: an indexed file (foreign key not enforced on codeChunks,
    // but we insert a project for consistency)
    db.prepare(
      `INSERT INTO projects (id, name, path, createdAt, sortOrder) VALUES (?, ?, ?, datetime('now'), 0)`
    ).run(projectId, 'Test Project', '/test/project')
  })

  afterEach(() => {
    db.close()
    try { fs.unlinkSync(dbPath) } catch {}
    try { fs.unlinkSync(dbPath + '-wal') } catch {}
    try { fs.unlinkSync(dbPath + '-shm') } catch {}
  })

  function insertChunk(overrides: Partial<Parameters<typeof dao.insert>[0]> = {}) {
    const id = overrides.id ?? `chunk-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const chunk = {
      id,
      fileId: overrides.fileId ?? fileId,
      projectId: overrides.projectId ?? projectId,
      chunkType: overrides.chunkType ?? 'function',
      symbolName: overrides.symbolName ?? null,
      content: overrides.content ?? 'function hello() { return "world" }',
      startLine: 'startLine' in overrides ? overrides.startLine! : 1,
      endLine: 'endLine' in overrides ? overrides.endLine! : 3,
      embedding: 'embedding' in overrides ? overrides.embedding! : null,
    }
    dao.insert(chunk)
    return chunk
  }

  describe('insert', () => {
    it('inserts a chunk with all fields', () => {
      const embedding = float32ArrayToBlob(new Float32Array([0.1, 0.2, 0.3]))
      insertChunk({
        id: 'chunk-1',
        symbolName: 'hello',
        embedding,
      })

      const chunks = dao.listByProject(projectId)
      expect(chunks).toHaveLength(1)
      expect(chunks[0].id).toBe('chunk-1')
      expect(chunks[0].symbolName).toBe('hello')
      expect(chunks[0].chunkType).toBe('function')
      expect(chunks[0].content).toContain('hello')
    })

    it('inserts a chunk with null optional fields', () => {
      insertChunk({
        id: 'chunk-null',
        symbolName: null,
        startLine: null,
        endLine: null,
        embedding: null,
      })

      const chunks = dao.listByProject(projectId)
      expect(chunks).toHaveLength(1)
      expect(chunks[0].symbolName).toBeNull()
      expect(chunks[0].startLine).toBeNull()
      expect(chunks[0].endLine).toBeNull()
    })

    it('rejects duplicate chunk IDs', () => {
      insertChunk({ id: 'dup' })
      expect(() => insertChunk({ id: 'dup' })).toThrow()
    })
  })

  describe('listByProject', () => {
    it('returns only chunks for the specified project', () => {
      // Insert a project for the "other" project
      db.prepare(
        `INSERT INTO projects (id, name, path, createdAt, sortOrder) VALUES (?, ?, ?, datetime('now'), 0)`
      ).run('other-project', 'Other', '/other')

      insertChunk({ id: 'c1', projectId })
      insertChunk({ id: 'c2', projectId })
      insertChunk({ id: 'c3', projectId: 'other-project' })

      const chunks = dao.listByProject(projectId)
      expect(chunks).toHaveLength(2)
      expect(chunks.every(c => c.projectId === projectId)).toBe(true)
    })

    it('returns empty array for project with no chunks', () => {
      const chunks = dao.listByProject('nonexistent')
      expect(chunks).toEqual([])
    })
  })

  describe('listByFile', () => {
    it('returns only chunks for the specified file', () => {
      insertChunk({ id: 'c1', fileId: 'file-a' })
      insertChunk({ id: 'c2', fileId: 'file-a' })
      insertChunk({ id: 'c3', fileId: 'file-b' })

      const chunks = dao.listByFile('file-a')
      expect(chunks).toHaveLength(2)
      expect(chunks.every(c => c.fileId === 'file-a')).toBe(true)
    })
  })

  describe('deleteByFile', () => {
    it('deletes all chunks for a file', () => {
      insertChunk({ id: 'c1', fileId: 'file-a' })
      insertChunk({ id: 'c2', fileId: 'file-a' })
      insertChunk({ id: 'c3', fileId: 'file-b' })

      dao.deleteByFile('file-a')

      expect(dao.listByFile('file-a')).toHaveLength(0)
      expect(dao.listByFile('file-b')).toHaveLength(1)
    })

    it('does nothing when no chunks match', () => {
      insertChunk({ id: 'c1' })
      dao.deleteByFile('nonexistent')
      expect(dao.listByProject(projectId)).toHaveLength(1)
    })
  })

  describe('deleteByProject', () => {
    it('deletes all chunks for a project', () => {
      db.prepare(
        `INSERT INTO projects (id, name, path, createdAt, sortOrder) VALUES (?, ?, ?, datetime('now'), 0)`
      ).run('other-project', 'Other', '/other')

      insertChunk({ id: 'c1', projectId })
      insertChunk({ id: 'c2', projectId })
      insertChunk({ id: 'c3', projectId: 'other-project' })

      dao.deleteByProject(projectId)

      expect(dao.listByProject(projectId)).toHaveLength(0)
      expect(dao.listByProject('other-project')).toHaveLength(1)
    })
  })

  describe('searchFTS', () => {
    it('finds chunks by content keyword', () => {
      insertChunk({ id: 'c1', content: 'function authenticate(user) { return token }', symbolName: 'authenticate' })
      insertChunk({ id: 'c2', content: 'function fetchData() { return [] }', symbolName: 'fetchData' })

      const results = dao.searchFTS(projectId, 'authenticate')
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].id).toBe('c1')
      expect(results[0].rank).toBeDefined()
    })

    it('finds chunks by symbol name', () => {
      insertChunk({ id: 'c1', content: 'class UserService {}', symbolName: 'UserService' })
      insertChunk({ id: 'c2', content: 'class OrderService {}', symbolName: 'OrderService' })

      const results = dao.searchFTS(projectId, 'UserService')
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.some(r => r.id === 'c1')).toBe(true)
    })

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        insertChunk({ id: `c${i}`, content: `function handler${i}() { return process(data) }` })
      }

      const results = dao.searchFTS(projectId, 'process', 3)
      expect(results).toHaveLength(3)
    })

    it('returns empty array for no matches', () => {
      insertChunk({ id: 'c1', content: 'function hello() {}' })
      const results = dao.searchFTS(projectId, 'zzzznonexistent')
      expect(results).toEqual([])
    })

    it('only returns chunks from the specified project', () => {
      db.prepare(
        `INSERT INTO projects (id, name, path, createdAt, sortOrder) VALUES (?, ?, ?, datetime('now'), 0)`
      ).run('other-project', 'Other', '/other')

      insertChunk({ id: 'c1', projectId, content: 'function search() { return results }' })
      insertChunk({ id: 'c2', projectId: 'other-project', content: 'function search() { return data }' })

      const results = dao.searchFTS(projectId, 'search')
      expect(results).toHaveLength(1)
      expect(results[0].projectId).toBe(projectId)
    })

    it('returns positive rank values (normalized from FTS5 negative ranks)', () => {
      insertChunk({ id: 'c1', content: 'function authenticate(user) { validate credentials }' })
      const results = dao.searchFTS(projectId, 'authenticate')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].rank).toBeGreaterThan(0)
    })
  })

  describe('getChunksWithEmbeddings', () => {
    it('returns only chunks that have embeddings', () => {
      const embedding = float32ArrayToBlob(new Float32Array([0.1, 0.2, 0.3]))
      insertChunk({ id: 'c1', embedding })
      insertChunk({ id: 'c2', embedding: null })
      insertChunk({ id: 'c3', embedding })

      const results = dao.getChunksWithEmbeddings(projectId)
      expect(results).toHaveLength(2)
      expect(results.every(r => r.embedding !== null)).toBe(true)
    })

    it('returns empty array when no chunks have embeddings', () => {
      insertChunk({ id: 'c1', embedding: null })
      const results = dao.getChunksWithEmbeddings(projectId)
      expect(results).toEqual([])
    })

    it('only returns chunks for the specified project', () => {
      db.prepare(
        `INSERT INTO projects (id, name, path, createdAt, sortOrder) VALUES (?, ?, ?, datetime('now'), 0)`
      ).run('other-project', 'Other', '/other')

      const embedding = float32ArrayToBlob(new Float32Array([0.1, 0.2]))
      insertChunk({ id: 'c1', projectId, embedding })
      insertChunk({ id: 'c2', projectId: 'other-project', embedding })

      const results = dao.getChunksWithEmbeddings(projectId)
      expect(results).toHaveLength(1)
      expect(results[0].projectId).toBe(projectId)
    })
  })

  describe('updateEmbedding', () => {
    it('updates the embedding for a chunk', () => {
      insertChunk({ id: 'c1', embedding: null })
      expect(dao.getChunksWithEmbeddings(projectId)).toHaveLength(0)

      const embedding = float32ArrayToBlob(new Float32Array([0.5, 0.6, 0.7]))
      dao.updateEmbedding('c1', embedding)

      const results = dao.getChunksWithEmbeddings(projectId)
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('c1')
    })

    it('overwrites existing embedding', () => {
      const oldEmbedding = float32ArrayToBlob(new Float32Array([0.1, 0.2]))
      insertChunk({ id: 'c1', embedding: oldEmbedding })

      const newEmbedding = float32ArrayToBlob(new Float32Array([0.9, 0.8]))
      dao.updateEmbedding('c1', newEmbedding)

      const results = dao.getChunksWithEmbeddings(projectId)
      expect(results).toHaveLength(1)
      // Verify it was actually changed by checking the buffer content
      expect(Buffer.from(results[0].embedding)).not.toEqual(oldEmbedding)
    })
  })

  describe('countByProject', () => {
    it('returns the total number of chunks for a project', () => {
      insertChunk({ id: 'c1' })
      insertChunk({ id: 'c2' })
      insertChunk({ id: 'c3' })

      expect(dao.countByProject(projectId)).toBe(3)
    })

    it('returns 0 for project with no chunks', () => {
      expect(dao.countByProject('nonexistent')).toBe(0)
    })

    it('does not count chunks from other projects', () => {
      db.prepare(
        `INSERT INTO projects (id, name, path, createdAt, sortOrder) VALUES (?, ?, ?, datetime('now'), 0)`
      ).run('other-project', 'Other', '/other')

      insertChunk({ id: 'c1', projectId })
      insertChunk({ id: 'c2', projectId: 'other-project' })

      expect(dao.countByProject(projectId)).toBe(1)
    })
  })
})

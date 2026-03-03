import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Migrator } from '../../../main/database/migrator'
import { migrations } from '../../../main/database/migrations'
import { ChunkDAO } from '../../../main/database/dao/ChunkDAO'
import { HybridSearchEngine } from '../../../main/database/search/hybrid-search'
import { float32ArrayToBlob } from '../../../main/database/search/vector-search'

describe('HybridSearchEngine', () => {
  let db: Database.Database
  let dbPath: string
  let engine: HybridSearchEngine
  let chunkDAO: ChunkDAO
  const projectId = 'test-project'

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-hybrid-search-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    )
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const migrator = new Migrator(db, migrations)
    migrator.migrate()

    chunkDAO = new ChunkDAO(db)
    engine = new HybridSearchEngine(db)

    // Insert prerequisite project
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

  function insertChunk(overrides: {
    id: string
    content: string
    symbolName?: string | null
    chunkType?: string
    fileId?: string
    embedding?: Buffer | null
  }) {
    chunkDAO.insert({
      id: overrides.id,
      fileId: overrides.fileId ?? 'file-1',
      projectId,
      chunkType: overrides.chunkType ?? 'function',
      symbolName: overrides.symbolName ?? null,
      content: overrides.content,
      startLine: 1,
      endLine: 10,
      embedding: overrides.embedding ?? null,
    })
  }

  describe('keyword-only search (no embedding)', () => {
    it('returns FTS results when no query embedding is provided', () => {
      insertChunk({ id: 'c1', content: 'function authenticate(user) { return token }', symbolName: 'authenticate' })
      insertChunk({ id: 'c2', content: 'function fetchData() { return data }', symbolName: 'fetchData' })

      const { results, processedQuery } = engine.search(projectId, 'authenticate', null)

      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].chunkId).toBe('c1')
      expect(results[0].matchType).toBe('keyword')
      expect(results[0].score).toBeGreaterThan(0)
      expect(processedQuery.original).toBe('authenticate')
    })

    it('returns empty results for non-matching query', () => {
      insertChunk({ id: 'c1', content: 'function hello() {}' })
      const { results } = engine.search(projectId, 'zzzznonexistent', null)
      expect(results).toEqual([])
    })
  })

  describe('vector-only search', () => {
    it('returns semantic results when chunks have embeddings but FTS has no match', () => {
      // Create embeddings that are similar to the query embedding
      const queryEmbedding = new Float32Array([1, 0, 0, 0])
      const similarEmbedding = float32ArrayToBlob(new Float32Array([0.9, 0.1, 0, 0]))
      const dissimilarEmbedding = float32ArrayToBlob(new Float32Array([0, 0, 0, 1]))

      insertChunk({
        id: 'c1',
        content: 'validates user credentials and returns session token',
        embedding: similarEmbedding,
      })
      insertChunk({
        id: 'c2',
        content: 'renders the dashboard component with charts',
        embedding: dissimilarEmbedding,
      })

      // Query that won't match FTS but has embedding
      const { results } = engine.search(projectId, 'zzzznonexistent', queryEmbedding)

      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].matchType).toBe('semantic')
      expect(results[0].chunkId).toBe('c1')
    })
  })

  describe('hybrid search (combined)', () => {
    it('combines keyword and vector scores', () => {
      const queryEmbedding = new Float32Array([1, 0, 0, 0])
      const highSimilarity = float32ArrayToBlob(new Float32Array([0.95, 0.05, 0, 0]))
      const lowSimilarity = float32ArrayToBlob(new Float32Array([0.1, 0.9, 0, 0]))

      // Chunk that matches both keyword AND is semantically similar
      insertChunk({
        id: 'c1',
        content: 'function login(username, password) { return authenticate(username, password) }',
        symbolName: 'login',
        embedding: highSimilarity,
      })

      // Chunk that matches keyword but is semantically different
      insertChunk({
        id: 'c2',
        content: 'function login_validator() { check format }',
        symbolName: 'login_validator',
        embedding: lowSimilarity,
      })

      const { results } = engine.search(projectId, 'login', queryEmbedding)

      expect(results.length).toBeGreaterThanOrEqual(1)
      // c1 should score higher since it matches both keyword and semantic
      const c1 = results.find(r => r.chunkId === 'c1')
      const c2 = results.find(r => r.chunkId === 'c2')
      expect(c1).toBeDefined()
      if (c1 && c2) {
        expect(c1.score).toBeGreaterThan(c2.score)
        expect(c1.matchType).toBe('hybrid')
        expect(c2.matchType).toBe('hybrid')
      }
    })
  })

  describe('result consolidation', () => {
    it('limits to max 2 chunks per file', () => {
      // Insert 5 chunks from the same file
      for (let i = 0; i < 5; i++) {
        insertChunk({
          id: `c${i}`,
          fileId: 'same-file',
          content: `function handler${i}() { return process(data) }`,
        })
      }

      const { results } = engine.search(projectId, 'process', null)

      const sameFileResults = results.filter(r => r.fileId === 'same-file')
      expect(sameFileResults.length).toBeLessThanOrEqual(2)
    })

    it('allows 2 chunks per file from different files', () => {
      // Insert 2 chunks in file-a and 2 in file-b
      insertChunk({ id: 'a1', fileId: 'file-a', content: 'function process_a1() { process data }' })
      insertChunk({ id: 'a2', fileId: 'file-a', content: 'function process_a2() { process data }' })
      insertChunk({ id: 'b1', fileId: 'file-b', content: 'function process_b1() { process data }' })
      insertChunk({ id: 'b2', fileId: 'file-b', content: 'function process_b2() { process data }' })

      const { results } = engine.search(projectId, 'process', null)

      const fileAResults = results.filter(r => r.fileId === 'file-a')
      const fileBResults = results.filter(r => r.fileId === 'file-b')
      expect(fileAResults.length).toBeLessThanOrEqual(2)
      expect(fileBResults.length).toBeLessThanOrEqual(2)
    })
  })

  describe('result limit', () => {
    it('respects the limit parameter', () => {
      for (let i = 0; i < 20; i++) {
        insertChunk({
          id: `c${i}`,
          fileId: `file-${i}`,  // Different files to avoid consolidation filtering
          content: `function handler${i}() { return process(data) }`,
        })
      }

      const { results } = engine.search(projectId, 'process', null, 5)
      expect(results.length).toBeLessThanOrEqual(5)
    })
  })

  describe('processed query metadata', () => {
    it('returns the processed query with classification', () => {
      const { processedQuery } = engine.search(projectId, 'how does authentication work', null)

      expect(processedQuery.original).toBe('how does authentication work')
      expect(processedQuery.queryType).toBe('concept')
      expect(processedQuery.semanticWeight).toBe(0.85)
      expect(processedQuery.keywordWeight).toBe(0.15)
      expect(processedQuery.tokens.length).toBeGreaterThan(0)
    })
  })

  describe('result shape', () => {
    it('returns correctly shaped SearchResult objects', () => {
      insertChunk({
        id: 'c1',
        content: 'function hello() { return world }',
        symbolName: 'hello',
        chunkType: 'function',
        fileId: 'file-1',
      })

      const { results } = engine.search(projectId, 'hello', null)

      expect(results.length).toBeGreaterThanOrEqual(1)
      const result = results[0]
      expect(result).toHaveProperty('chunkId')
      expect(result).toHaveProperty('fileId')
      expect(result).toHaveProperty('projectId')
      expect(result).toHaveProperty('chunkType')
      expect(result).toHaveProperty('symbolName')
      expect(result).toHaveProperty('content')
      expect(result).toHaveProperty('startLine')
      expect(result).toHaveProperty('endLine')
      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('matchType')

      expect(result.chunkId).toBe('c1')
      expect(result.fileId).toBe('file-1')
      expect(result.projectId).toBe(projectId)
      expect(result.chunkType).toBe('function')
      expect(result.symbolName).toBe('hello')
      expect(result.content).toContain('hello')
      expect(typeof result.score).toBe('number')
      expect(['keyword', 'semantic', 'hybrid']).toContain(result.matchType)
    })
  })

  describe('empty project', () => {
    it('returns empty results for project with no chunks', () => {
      const { results } = engine.search(projectId, 'anything', null)
      expect(results).toEqual([])
    })
  })
})

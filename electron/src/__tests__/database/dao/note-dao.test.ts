import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Migrator } from '../../../main/database/migrator'
import { migrations } from '../../../main/database/migrations'
import { NoteDAO } from '../../../main/database/dao/NoteDAO'
import { SessionDAO } from '../../../main/database/dao/SessionDAO'

describe('NoteDAO', () => {
  let db: Database.Database
  let dbPath: string
  let dao: NoteDAO
  let sessionDAO: SessionDAO
  const projectId = '__global__' // seeded by migration

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-note-dao-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    )
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const migrator = new Migrator(db, migrations)
    migrator.migrate()
    dao = new NoteDAO(db)
    sessionDAO = new SessionDAO(db)
  })

  afterEach(() => {
    db.close()
    try { fs.unlinkSync(dbPath) } catch {}
    try { fs.unlinkSync(dbPath + '-wal') } catch {}
    try { fs.unlinkSync(dbPath + '-shm') } catch {}
  })

  describe('create', () => {
    it('creates a note with required fields', () => {
      const note = dao.create({ projectId, title: 'My Note' })

      expect(note.id).toBeGreaterThan(0)
      expect(note.title).toBe('My Note')
      expect(note.content).toBe('')
      expect(note.pinned).toBe(0)
      expect(note.isGlobal).toBe(0)
      expect(note.sessionId).toBeNull()
      expect(note.createdAt).toBeTruthy()
      expect(note.updatedAt).toBeTruthy()
    })

    it('creates a note with all optional fields', () => {
      // Create a real session to satisfy FK constraint
      const session = sessionDAO.create({ id: 'session-123', projectId })

      const note = dao.create({
        projectId,
        title: 'Full Note',
        content: 'Some content here',
        pinned: true,
        isGlobal: true,
        sessionId: session.id,
      })

      expect(note.title).toBe('Full Note')
      expect(note.content).toBe('Some content here')
      expect(note.pinned).toBe(1)
      expect(note.isGlobal).toBe(1)
      expect(note.sessionId).toBe('session-123')
    })
  })

  describe('getById', () => {
    it('returns note by id', () => {
      const created = dao.create({ projectId, title: 'Find Me' })
      const found = dao.getById(created.id)
      expect(found).toBeDefined()
      expect(found!.title).toBe('Find Me')
    })

    it('returns undefined for nonexistent id', () => {
      expect(dao.getById(999999)).toBeUndefined()
    })
  })

  describe('list', () => {
    it('lists notes for a project', () => {
      dao.create({ projectId, title: 'A' })
      dao.create({ projectId, title: 'B' })
      const notes = dao.list(projectId)
      expect(notes.length).toBe(2)
    })

    it('filters by pinned only', () => {
      dao.create({ projectId, title: 'Pinned', pinned: true })
      dao.create({ projectId, title: 'Not Pinned', pinned: false })

      const pinned = dao.list(projectId, true)
      expect(pinned.length).toBe(1)
      expect(pinned[0].title).toBe('Pinned')
    })

    it('lists global notes', () => {
      dao.create({ projectId, title: 'Local' })
      dao.create({ projectId, title: 'Global', isGlobal: true })

      const globals = dao.list(projectId, false, true)
      expect(globals.length).toBe(1)
      expect(globals[0].title).toBe('Global')
    })

    it('lists global pinned notes', () => {
      dao.create({ projectId, title: 'G-Pinned', isGlobal: true, pinned: true })
      dao.create({ projectId, title: 'G-Not-Pinned', isGlobal: true, pinned: false })
      dao.create({ projectId, title: 'Local-Pinned', pinned: true })

      const globalPinned = dao.list(projectId, true, true)
      expect(globalPinned.length).toBe(1)
      expect(globalPinned[0].title).toBe('G-Pinned')
    })

    it('orders by updatedAt descending', () => {
      const first = dao.create({ projectId, title: 'First' })
      dao.create({ projectId, title: 'Second' })

      // Update 'First' to give it a newer updatedAt
      dao.update(first.id, { content: 'updated' })

      const notes = dao.list(projectId)
      expect(notes[0].title).toBe('First')
      expect(notes[1].title).toBe('Second')
    })
  })

  describe('update', () => {
    it('updates specified fields', () => {
      const note = dao.create({ projectId, title: 'Original', content: 'Old' })
      const updated = dao.update(note.id, {
        title: 'Updated',
        content: 'New content',
      })

      expect(updated).toBeDefined()
      expect(updated!.title).toBe('Updated')
      expect(updated!.content).toBe('New content')
    })

    it('updates pinned status', () => {
      const note = dao.create({ projectId, title: 'Pin Me' })
      expect(note.pinned).toBe(0)

      const updated = dao.update(note.id, { pinned: true })
      expect(updated!.pinned).toBe(1)
    })

    it('updates updatedAt timestamp', () => {
      // Insert with an old timestamp to guarantee the update produces a different one
      const now = new Date().toISOString()
      const result = db
        .prepare(
          `INSERT INTO notes (projectId, title, content, pinned, isGlobal, createdAt, updatedAt)
           VALUES (?, ?, ?, 0, 0, ?, ?)`
        )
        .run(projectId, 'Timestamp', '', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')
      const noteId = Number(result.lastInsertRowid)

      const updated = dao.update(noteId, { content: 'changed' })
      expect(updated!.updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
    })

    it('returns undefined for nonexistent id', () => {
      expect(dao.update(999999, { title: 'X' })).toBeUndefined()
    })
  })

  describe('delete', () => {
    it('deletes an existing note', () => {
      const note = dao.create({ projectId, title: 'Delete Me' })
      expect(dao.delete(note.id)).toBe(true)
      expect(dao.getById(note.id)).toBeUndefined()
    })

    it('returns false for nonexistent id', () => {
      expect(dao.delete(999999)).toBe(false)
    })
  })

  describe('searchFTS', () => {
    it('finds notes by full-text search on title', () => {
      dao.create({ projectId, title: 'Architecture Decision', content: 'Use React' })
      dao.create({ projectId, title: 'Bug Report', content: 'Login broken' })

      const results = dao.searchFTS(projectId, 'Architecture')
      expect(results.length).toBe(1)
      expect(results[0].title).toBe('Architecture Decision')
    })

    it('finds notes by full-text search on content', () => {
      dao.create({ projectId, title: 'Note A', content: 'The database migration failed' })
      dao.create({ projectId, title: 'Note B', content: 'Everything works fine' })

      const results = dao.searchFTS(projectId, 'migration')
      expect(results.length).toBe(1)
      expect(results[0].title).toBe('Note A')
    })

    it('searches global notes', () => {
      dao.create({ projectId, title: 'Local Note', content: 'important pattern', isGlobal: false })
      dao.create({ projectId, title: 'Global Note', content: 'important pattern', isGlobal: true })

      const globalResults = dao.searchFTS(projectId, 'important', true)
      expect(globalResults.length).toBe(1)
      expect(globalResults[0].title).toBe('Global Note')
    })

    it('returns empty array for no matches', () => {
      dao.create({ projectId, title: 'Note', content: 'Hello' })
      const results = dao.searchFTS(projectId, 'xyznonexistent')
      expect(results.length).toBe(0)
    })
  })
})

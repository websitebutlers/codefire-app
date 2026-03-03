import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Migrator } from '../../../main/database/migrator'
import { migrations } from '../../../main/database/migrations'
import { ProjectDAO } from '../../../main/database/dao/ProjectDAO'

describe('ProjectDAO', () => {
  let db: Database.Database
  let dbPath: string
  let dao: ProjectDAO

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-project-dao-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    )
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const migrator = new Migrator(db, migrations)
    migrator.migrate()
    dao = new ProjectDAO(db)
  })

  afterEach(() => {
    db.close()
    try { fs.unlinkSync(dbPath) } catch {}
    try { fs.unlinkSync(dbPath + '-wal') } catch {}
    try { fs.unlinkSync(dbPath + '-shm') } catch {}
  })

  describe('create', () => {
    it('creates a project with required fields', () => {
      const project = dao.create({
        name: 'Test Project',
        path: '/Users/test/project',
      })

      expect(project.id).toBeTruthy()
      expect(project.name).toBe('Test Project')
      expect(project.path).toBe('/Users/test/project')
      expect(project.claudeProject).toBeNull()
      expect(project.clientId).toBeNull()
      expect(project.tags).toBeNull()
      expect(project.sortOrder).toBe(0)
      expect(project.createdAt).toBeTruthy()
    })

    it('creates a project with all fields', () => {
      const project = dao.create({
        id: 'custom-id',
        name: 'Full Project',
        path: '/Users/test/full',
        claudeProject: 'cp-123',
        tags: '["web", "api"]',
      })

      expect(project.id).toBe('custom-id')
      expect(project.claudeProject).toBe('cp-123')
      expect(project.tags).toBe('["web", "api"]')
    })

    it('rejects duplicate paths', () => {
      dao.create({ name: 'A', path: '/same/path' })
      expect(() => dao.create({ name: 'B', path: '/same/path' })).toThrow()
    })
  })

  describe('getById', () => {
    it('returns project by id', () => {
      const created = dao.create({ name: 'Find Me', path: '/find/me' })
      const found = dao.getById(created.id)
      expect(found).toBeDefined()
      expect(found!.name).toBe('Find Me')
    })

    it('returns undefined for nonexistent id', () => {
      expect(dao.getById('nonexistent')).toBeUndefined()
    })
  })

  describe('getByPath', () => {
    it('returns project by path', () => {
      dao.create({ name: 'Path Project', path: '/unique/path' })
      const found = dao.getByPath('/unique/path')
      expect(found).toBeDefined()
      expect(found!.name).toBe('Path Project')
    })

    it('returns undefined for nonexistent path', () => {
      expect(dao.getByPath('/no/such/path')).toBeUndefined()
    })
  })

  describe('list', () => {
    it('lists all projects including seeded __global__', () => {
      const projects = dao.list()
      // __global__ is seeded by migration 11
      expect(projects.length).toBeGreaterThanOrEqual(1)
      expect(projects.some((p) => p.id === '__global__')).toBe(true)
    })

    it('returns projects sorted by sortOrder then name', () => {
      dao.create({ id: 'z-project', name: 'Zebra', path: '/z' })
      dao.create({ id: 'a-project', name: 'Apple', path: '/a' })
      const projects = dao.list()
      const userProjects = projects.filter((p) => p.id !== '__global__')
      expect(userProjects[0].name).toBe('Apple')
      expect(userProjects[1].name).toBe('Zebra')
    })
  })

  describe('update', () => {
    it('updates specified fields', () => {
      const project = dao.create({ name: 'Original', path: '/orig' })
      const updated = dao.update(project.id, { name: 'Updated' })
      expect(updated).toBeDefined()
      expect(updated!.name).toBe('Updated')
      expect(updated!.path).toBe('/orig') // unchanged
    })

    it('can set nullable fields to null', () => {
      const project = dao.create({
        name: 'Test',
        path: '/test',
        claudeProject: 'cp-1',
      })
      const updated = dao.update(project.id, { claudeProject: null })
      expect(updated!.claudeProject).toBeNull()
    })

    it('returns undefined for nonexistent id', () => {
      expect(dao.update('nope', { name: 'X' })).toBeUndefined()
    })
  })

  describe('updateLastOpened', () => {
    it('sets lastOpened timestamp', () => {
      const project = dao.create({ name: 'Opener', path: '/open' })
      expect(project.lastOpened).toBeNull()

      dao.updateLastOpened(project.id)
      const refreshed = dao.getById(project.id)
      expect(refreshed!.lastOpened).toBeTruthy()
    })
  })

  describe('delete', () => {
    it('deletes an existing project', () => {
      const project = dao.create({ name: 'Delete Me', path: '/del' })
      expect(dao.delete(project.id)).toBe(true)
      expect(dao.getById(project.id)).toBeUndefined()
    })

    it('returns false for nonexistent id', () => {
      expect(dao.delete('nonexistent')).toBe(false)
    })
  })
})

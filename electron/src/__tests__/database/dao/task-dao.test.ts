import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Migrator } from '../../../main/database/migrator'
import { migrations } from '../../../main/database/migrations'
import { TaskDAO } from '../../../main/database/dao/TaskDAO'

describe('TaskDAO', () => {
  let db: Database.Database
  let dbPath: string
  let dao: TaskDAO
  const projectId = '__global__' // seeded by migration

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-task-dao-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    )
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const migrator = new Migrator(db, migrations)
    migrator.migrate()
    dao = new TaskDAO(db)
  })

  afterEach(() => {
    db.close()
    try { fs.unlinkSync(dbPath) } catch {}
    try { fs.unlinkSync(dbPath + '-wal') } catch {}
    try { fs.unlinkSync(dbPath + '-shm') } catch {}
  })

  describe('create', () => {
    it('creates a task with default values', () => {
      const task = dao.create({ projectId, title: 'My Task' })

      expect(task.id).toBeGreaterThan(0)
      expect(task.title).toBe('My Task')
      expect(task.status).toBe('todo')
      expect(task.priority).toBe(0)
      expect(task.source).toBe('claude')
      expect(task.isGlobal).toBe(0)
      expect(task.labels).toBeNull()
      expect(task.description).toBeNull()
      expect(task.completedAt).toBeNull()
      expect(task.createdAt).toBeTruthy()
    })

    it('creates a task with all optional fields', () => {
      const task = dao.create({
        projectId,
        title: 'Full Task',
        description: 'A detailed description',
        priority: 3,
        source: 'manual',
        labels: ['bug', 'urgent'],
        isGlobal: true,
      })

      expect(task.title).toBe('Full Task')
      expect(task.description).toBe('A detailed description')
      expect(task.priority).toBe(3)
      expect(task.source).toBe('manual')
      expect(task.labels).toBe('["bug","urgent"]')
      expect(task.isGlobal).toBe(1)
    })

    it('clamps priority between 0 and 4', () => {
      const low = dao.create({ projectId, title: 'Low', priority: -5 })
      const high = dao.create({ projectId, title: 'High', priority: 99 })
      expect(low.priority).toBe(0)
      expect(high.priority).toBe(4)
    })
  })

  describe('getById', () => {
    it('returns task by id', () => {
      const created = dao.create({ projectId, title: 'Find' })
      const found = dao.getById(created.id)
      expect(found).toBeDefined()
      expect(found!.title).toBe('Find')
    })

    it('returns undefined for nonexistent id', () => {
      expect(dao.getById(999999)).toBeUndefined()
    })
  })

  describe('list', () => {
    it('lists tasks for a project', () => {
      dao.create({ projectId, title: 'A' })
      dao.create({ projectId, title: 'B' })
      const tasks = dao.list(projectId)
      expect(tasks.length).toBe(2)
    })

    it('filters by status', () => {
      const task = dao.create({ projectId, title: 'A' })
      dao.create({ projectId, title: 'B' })
      dao.update(task.id, { status: 'done' })

      const todos = dao.list(projectId, 'todo')
      expect(todos.length).toBe(1)
      expect(todos[0].title).toBe('B')

      const done = dao.list(projectId, 'done')
      expect(done.length).toBe(1)
      expect(done[0].title).toBe('A')
    })

    it('orders by priority descending then createdAt descending', () => {
      dao.create({ projectId, title: 'Low', priority: 1 })
      dao.create({ projectId, title: 'High', priority: 4 })
      dao.create({ projectId, title: 'Medium', priority: 2 })

      const tasks = dao.list(projectId)
      expect(tasks[0].title).toBe('High')
      expect(tasks[1].title).toBe('Medium')
      expect(tasks[2].title).toBe('Low')
    })
  })

  describe('listGlobal', () => {
    it('lists only global tasks', () => {
      dao.create({ projectId, title: 'Local', isGlobal: false })
      dao.create({ projectId, title: 'Global', isGlobal: true })

      const globals = dao.listGlobal()
      expect(globals.length).toBe(1)
      expect(globals[0].title).toBe('Global')
    })

    it('filters global tasks by status', () => {
      const task = dao.create({ projectId, title: 'G1', isGlobal: true })
      dao.create({ projectId, title: 'G2', isGlobal: true })
      dao.update(task.id, { status: 'done' })

      const todos = dao.listGlobal('todo')
      expect(todos.length).toBe(1)
      expect(todos[0].title).toBe('G2')
    })
  })

  describe('update', () => {
    it('updates specified fields', () => {
      const task = dao.create({ projectId, title: 'Original' })
      const updated = dao.update(task.id, {
        title: 'Updated',
        priority: 2,
      })

      expect(updated).toBeDefined()
      expect(updated!.title).toBe('Updated')
      expect(updated!.priority).toBe(2)
      expect(updated!.status).toBe('todo') // unchanged
    })

    it('sets completedAt when status changes to done', () => {
      const task = dao.create({ projectId, title: 'To Complete' })
      expect(task.completedAt).toBeNull()

      const updated = dao.update(task.id, { status: 'done' })
      expect(updated!.completedAt).toBeTruthy()
    })

    it('clears completedAt when status changes away from done', () => {
      const task = dao.create({ projectId, title: 'Re-open' })
      dao.update(task.id, { status: 'done' })
      const reopened = dao.update(task.id, { status: 'in_progress' })
      expect(reopened!.completedAt).toBeNull()
    })

    it('returns undefined for nonexistent id', () => {
      expect(dao.update(999999, { title: 'X' })).toBeUndefined()
    })

    it('updates labels as JSON', () => {
      const task = dao.create({ projectId, title: 'Labels' })
      const updated = dao.update(task.id, { labels: ['feature', 'v2'] })
      expect(updated!.labels).toBe('["feature","v2"]')
    })
  })

  describe('delete', () => {
    it('deletes an existing task', () => {
      const task = dao.create({ projectId, title: 'Delete Me' })
      expect(dao.delete(task.id)).toBe(true)
      expect(dao.getById(task.id)).toBeUndefined()
    })

    it('returns false for nonexistent id', () => {
      expect(dao.delete(999999)).toBe(false)
    })
  })
})

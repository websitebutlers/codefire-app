import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { Migrator } from '../../main/database/migrator'
import { migrations } from '../../main/database/migrations'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('all migrations', () => {
  let db: Database.Database
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-migrations-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
  })

  afterEach(() => {
    db.close()
    try { fs.unlinkSync(dbPath) } catch {}
    // Clean up WAL/SHM files
    try { fs.unlinkSync(dbPath + '-wal') } catch {}
    try { fs.unlinkSync(dbPath + '-shm') } catch {}
  })

  it('runs all migrations without error', () => {
    const migrator = new Migrator(db, migrations)
    expect(() => migrator.migrate()).not.toThrow()
    expect(migrator.getCurrentVersion()).toBe(migrations.length)
  })

  it('creates all base tables', () => {
    const migrator = new Migrator(db, migrations)
    migrator.migrate()

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_version' ORDER BY name"
    ).all() as { name: string }[]
    const names = tables.map(t => t.name)

    const expected = [
      'briefingDigests', 'briefingItems', 'browserCommands', 'browserScreenshots',
      'chatConversations', 'chatMessages', 'clients', 'codeChunks', 'codebaseSnapshots',
      'generatedImages', 'gmailAccounts', 'indexRequests', 'indexState', 'indexedFiles',
      'notes', 'patterns', 'processedEmails', 'projects', 'recordings',
      'sessions', 'syncState', 'taskItems', 'taskNotes', 'whitelistRules'
    ]

    for (const table of expected) {
      expect(names).toContain(table)
    }
  })

  it('creates FTS virtual tables', () => {
    const migrator = new Migrator(db, migrations)
    migrator.migrate()

    // FTS tables appear in sqlite_master
    const all = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%Fts%' OR name LIKE '%fts%'").all() as { name: string }[]
    const names = all.map(t => t.name)

    expect(names.some(n => n.includes('sessionsFts'))).toBe(true)
    expect(names.some(n => n.includes('notesFts'))).toBe(true)
    expect(names.some(n => n.includes('codeChunksFts'))).toBe(true)
  })

  it('seeds the __global__ project', () => {
    const migrator = new Migrator(db, migrations)
    migrator.migrate()
    const row = db.prepare("SELECT id, name FROM projects WHERE id = '__global__'").get() as { id: string; name: string }
    expect(row).toBeTruthy()
    expect(row.name).toBe('Global')
  })

  it('is idempotent', () => {
    const migrator = new Migrator(db, migrations)
    migrator.migrate()
    migrator.migrate() // should not throw or duplicate data
    expect(migrator.getCurrentVersion()).toBe(migrations.length)

    // __global__ project should still be exactly 1
    const count = db.prepare("SELECT COUNT(*) as c FROM projects WHERE id = '__global__'").get() as { c: number }
    expect(count.c).toBe(1)
  })

  it('creates indices on indexedFiles and codeChunks', () => {
    const migrator = new Migrator(db, migrations)
    migrator.migrate()
    const indices = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    const names = indices.map(i => i.name)

    expect(names).toContain('indexedFiles_projectId')
    expect(names).toContain('indexedFiles_path')
    expect(names).toContain('codeChunks_projectId')
    expect(names).toContain('codeChunks_fileId')
  })

  it('migration 25 reconciles Swift-style syncState to Electron schema', () => {
    const migrator = new Migrator(db, migrations)
    migrator.migrate()

    const cols = db.pragma('table_info(syncState)') as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('dirty')
    expect(colNames).not.toContain('isDirty')
    expect(colNames).not.toContain('syncVersion')

    const triggers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%_dirty_%'"
    ).all() as { name: string }[]
    const triggerNames = triggers.map(t => t.name)
    expect(triggerNames).toContain('sync_task_dirty_update')
    expect(triggerNames).toContain('sync_note_dirty_update')
    expect(triggerNames).toContain('sync_task_note_dirty_insert')

    const oldTriggers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'syncState_%'"
    ).all() as { name: string }[]
    expect(oldTriggers).toHaveLength(0)
  })

  it('migration 25 preserves data when reconciling Swift-style syncState', () => {
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, createdAt DATETIME NOT NULL);
      INSERT INTO projects (id, name, path, createdAt) VALUES ('__global__', 'Global', '/global', datetime('now'));
      CREATE TABLE taskItems (id INTEGER PRIMARY KEY AUTOINCREMENT, projectId TEXT NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'todo', priority INTEGER NOT NULL DEFAULT 0, sourceSession TEXT, source TEXT NOT NULL DEFAULT 'manual', createdAt DATETIME NOT NULL, completedAt DATETIME, labels TEXT, attachments TEXT, isGlobal INTEGER NOT NULL DEFAULT 0, updatedAt DATETIME);
      CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, projectId TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL);
      CREATE TABLE taskNotes (id INTEGER PRIMARY KEY AUTOINCREMENT, taskId INTEGER NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', createdAt DATETIME NOT NULL, mentions TEXT, updatedAt DATETIME);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, slug TEXT, startedAt DATETIME, endedAt DATETIME, model TEXT, gitBranch TEXT, summary TEXT, messageCount INTEGER NOT NULL DEFAULT 0, toolUseCount INTEGER NOT NULL DEFAULT 0, filesChanged TEXT);
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (24);
    `)

    db.exec(`
      CREATE TABLE syncState (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entityType TEXT NOT NULL,
        localId INTEGER NOT NULL,
        remoteId TEXT,
        projectId TEXT NOT NULL,
        isDirty INTEGER NOT NULL DEFAULT 1,
        isDeleted INTEGER NOT NULL DEFAULT 0,
        lastSyncedAt DATETIME,
        syncVersion INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX syncState_unique ON syncState (entityType, localId);
    `)

    db.prepare(
      `INSERT INTO syncState (entityType, localId, remoteId, projectId, isDirty, isDeleted, syncVersion)
       VALUES ('task', 1, 'remote-uuid-1', 'proj-1', 1, 0, 3)`
    ).run()
    db.prepare(
      `INSERT INTO syncState (entityType, localId, remoteId, projectId, isDirty, isDeleted, syncVersion)
       VALUES ('note', 2, NULL, 'proj-1', 0, 0, 0)`
    ).run()

    const migrator = new Migrator(db, migrations)
    migrator.migrate()

    const rows = db.prepare('SELECT * FROM syncState ORDER BY localId').all() as any[]
    expect(rows).toHaveLength(2)
    expect(rows[0].entityType).toBe('task')
    expect(rows[0].localId).toBe('1')
    expect(rows[0].remoteId).toBe('remote-uuid-1')
    expect(rows[0].dirty).toBe(1)
    expect(rows[1].entityType).toBe('note')
    expect(rows[1].dirty).toBe(0)

    const cols = db.pragma('table_info(syncState)') as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).not.toContain('isDirty')
    expect(colNames).not.toContain('syncVersion')
  })

  it('triggers mark syncState dirty on taskItem update', () => {
    const migrator = new Migrator(db, migrations)
    migrator.migrate()

    db.prepare(
      `INSERT OR IGNORE INTO projects (id, name, path, createdAt) VALUES ('proj-1', 'Test', '/test', datetime('now'))`
    ).run()

    db.prepare(
      `INSERT INTO taskItems (projectId, title, status, priority, source, createdAt, updatedAt)
       VALUES ('proj-1', 'Test task', 'todo', 0, 'manual', datetime('now'), datetime('now'))`
    ).run()
    const taskId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }

    db.prepare(
      `INSERT INTO syncState (entityType, localId, projectId, dirty, isDeleted)
       VALUES ('task', CAST(? AS TEXT), 'proj-1', 0, 0)`
    ).run(taskId.id)

    // Check triggers exist
    const triggers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name = 'sync_task_dirty_update'"
    ).all() as { name: string }[]
    expect(triggers).toHaveLength(1)

    // Check syncState before update
    const before = db.prepare('SELECT * FROM syncState').all()

    db.prepare('UPDATE taskItems SET title = ? WHERE id = ?').run('Updated title', taskId.id)

    // Check all syncState rows after update
    const allRows = db.prepare('SELECT * FROM syncState').all() as any[]
    const state = allRows.find(r => r.entityType === 'task' && r.localId === String(taskId.id))
    expect(state).toBeTruthy()
    expect(state.dirty).toBe(1)
  })

  it('runs migration 25 on Swift-created DB after fast-forward', () => {
    db.exec("CREATE TABLE grdb_migrations (identifier TEXT NOT NULL)")
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, claudeProject TEXT, lastOpened DATETIME, createdAt DATETIME NOT NULL, repoUrl TEXT);
      INSERT INTO projects (id, name, path, createdAt) VALUES ('__global__', 'Global', '/global', datetime('now'));
      CREATE TABLE taskItems (id INTEGER PRIMARY KEY AUTOINCREMENT, projectId TEXT NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'todo', priority INTEGER NOT NULL DEFAULT 0, sourceSession TEXT, source TEXT NOT NULL DEFAULT 'manual', createdAt DATETIME NOT NULL, completedAt DATETIME, labels TEXT, attachments TEXT, isGlobal INTEGER NOT NULL DEFAULT 0, updatedAt DATETIME);
      CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, projectId TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL);
      CREATE TABLE taskNotes (id INTEGER PRIMARY KEY AUTOINCREMENT, taskId INTEGER NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', createdAt DATETIME NOT NULL, mentions TEXT, updatedAt DATETIME);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, slug TEXT, startedAt DATETIME, endedAt DATETIME, model TEXT, gitBranch TEXT, summary TEXT, messageCount INTEGER NOT NULL DEFAULT 0, toolUseCount INTEGER NOT NULL DEFAULT 0, filesChanged TEXT);
      CREATE TABLE syncState (id INTEGER PRIMARY KEY AUTOINCREMENT, entityType TEXT NOT NULL, localId INTEGER NOT NULL, remoteId TEXT, projectId TEXT NOT NULL, isDirty INTEGER NOT NULL DEFAULT 1, isDeleted INTEGER NOT NULL DEFAULT 0, lastSyncedAt DATETIME, syncVersion INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX syncState_unique ON syncState (entityType, localId);
    `)

    const migrator = new Migrator(db, migrations)
    migrator.migrate()

    expect(migrator.getCurrentVersion()).toBe(migrations.length)

    const cols = db.pragma('table_info(syncState)') as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('dirty')
    expect(colNames).not.toContain('isDirty')

    const triggers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%_dirty_%'"
    ).all() as { name: string }[]
    expect(triggers.length).toBeGreaterThanOrEqual(3)
  })
})

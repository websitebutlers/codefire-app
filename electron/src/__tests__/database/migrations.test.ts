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

  it('runs all 19 migrations without error', () => {
    const migrator = new Migrator(db, migrations)
    expect(() => migrator.migrate()).not.toThrow()
    expect(migrator.getCurrentVersion()).toBe(19)
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
      'sessions', 'taskItems', 'taskNotes', 'whitelistRules'
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
    expect(migrator.getCurrentVersion()).toBe(19)

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
})

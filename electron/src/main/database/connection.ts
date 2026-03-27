import Database from 'better-sqlite3'
import { getDatabasePath } from './paths'
import { Migrator } from './migrator'

let _db: Database.Database | null = null
let _walCheckpointInterval: ReturnType<typeof setInterval> | null = null

/** Checkpoint interval: 5 minutes */
const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000

export function getDatabase(): Database.Database {
  if (!_db) {
    const dbPath = getDatabasePath()
    _db = new Database(dbPath)
    _db.pragma('journal_mode = WAL')
    _db.pragma('busy_timeout = 30000')
    _db.pragma('foreign_keys = ON')

    const migrator = new Migrator(_db)
    migrator.migrate()

    // Periodically checkpoint WAL to prevent unbounded growth
    startWalCheckpoint(_db)
  }
  return _db
}

export function closeDatabase(): void {
  if (_walCheckpointInterval) {
    clearInterval(_walCheckpointInterval)
    _walCheckpointInterval = null
  }
  if (_db) {
    try { _db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* closing anyway */ }
    _db.close()
    _db = null
  }
}

function startWalCheckpoint(db: Database.Database): void {
  _walCheckpointInterval = setInterval(() => {
    try {
      db.pragma('wal_checkpoint(PASSIVE)')
    } catch {
      // Non-critical — checkpoint will succeed on the next cycle
    }
  }, WAL_CHECKPOINT_INTERVAL_MS)
}

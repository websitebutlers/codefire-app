# SyncState Schema Unification Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the `syncState` table schema, triggers, and application code between Swift and Electron so both platforms work correctly against the same shared SQLite database.

**Architecture:** Electron's schema is the source of truth (more users expected, simpler design). Swift's migration, model, and SyncEngine will be updated to match. A reconciliation migration in Electron handles Swift-created DBs that already exist with the wrong schema.

**Tech Stack:** SQLite, TypeScript (Electron), Swift/GRDB (macOS)

---

## Root Cause Summary

Both platforms create a `syncState` table with incompatible schemas:

| Aspect | Swift (current) | Electron (canonical) |
|--------|----------------|---------------------|
| Dirty column | `isDirty BOOLEAN` | `dirty INTEGER` |
| Primary key | Auto-increment `id` + unique index | Composite `(entityType, localId)` |
| Extra columns | `syncVersion INTEGER` | none |
| localId type | `INTEGER` | `TEXT` |
| projectId | `NOT NULL` | nullable |
| Trigger names | `syncState_task_update` etc. | `sync_task_dirty_update` etc. |
| Trigger logic | `UPDATE syncState SET isDirty = 1` | `INSERT OR REPLACE INTO syncState (..., dirty)` |
| entityType for task notes | `task_note` | `taskNote` |

On macOS, both apps share the same SQLite file. Swift runs first and creates the table with `isDirty`. The Electron migrator fast-forwards past its migrations (detecting `grdb_migrations`), so the Electron triggers that reference `dirty` either don't get created or fail when they fire against the Swift schema.

## Canonical Schema (Electron = source of truth)

```sql
CREATE TABLE IF NOT EXISTS syncState (
  entityType TEXT NOT NULL,
  localId TEXT NOT NULL,
  remoteId TEXT,
  projectId TEXT,
  lastSyncedAt TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  isDeleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entityType, localId)
);
```

Trigger pattern (Electron standard — INSERT OR REPLACE):
```sql
CREATE TRIGGER IF NOT EXISTS sync_task_dirty_update
AFTER UPDATE ON taskItems BEGIN
  INSERT OR REPLACE INTO syncState (entityType, localId, projectId, remoteId, lastSyncedAt, dirty)
  VALUES ('task', CAST(NEW.id AS TEXT), NEW.projectId,
    (SELECT remoteId FROM syncState WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT)),
    (SELECT lastSyncedAt FROM syncState WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT)),
    1);
END;
```

Entity type values: `'task'`, `'note'`, `'taskNote'` (camelCase)

---

### Task 1: Reconciliation migration in Electron

**Files:**
- Modify: `electron/src/main/database/migrations/index.ts` (add migration 25)
- Modify: `electron/src/__tests__/database/migrations.test.ts`

This migration handles the case where a Swift-created DB has `isDirty` instead of `dirty`. It:
1. Detects if `syncState` has Swift schema (`isDirty` column)
2. Recreates the table with Electron schema, migrating data
3. Drops Swift-style triggers, ensures Electron-style triggers exist

**Step 1: Write the failing test**

Add to `electron/src/__tests__/database/migrations.test.ts`:

```typescript
it('migration 25 reconciles Swift-style syncState to Electron schema', () => {
  const migrator = new Migrator(db, migrations)
  migrator.migrate()

  // Verify syncState has dirty column (not isDirty)
  const cols = db.pragma('table_info(syncState)') as { name: string }[]
  const colNames = cols.map(c => c.name)
  expect(colNames).toContain('dirty')
  expect(colNames).not.toContain('isDirty')
  expect(colNames).not.toContain('syncVersion')

  // Verify correct triggers exist
  const triggers = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%_dirty_%'"
  ).all() as { name: string }[]
  const triggerNames = triggers.map(t => t.name)
  expect(triggerNames).toContain('sync_task_dirty_update')
  expect(triggerNames).toContain('sync_note_dirty_update')
  expect(triggerNames).toContain('sync_task_note_dirty_insert')

  // Verify old Swift-style triggers do NOT exist
  const oldTriggers = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'syncState_%'"
  ).all() as { name: string }[]
  expect(oldTriggers).toHaveLength(0)
})

it('migration 25 preserves data when reconciling Swift-style syncState', () => {
  // Simulate a Swift-created syncState table
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

  // Create Swift-style syncState
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

  // Insert Swift-style data
  db.prepare(
    `INSERT INTO syncState (entityType, localId, remoteId, projectId, isDirty, isDeleted, syncVersion)
     VALUES ('task', 1, 'remote-uuid-1', 'proj-1', 1, 0, 3)`
  ).run()
  db.prepare(
    `INSERT INTO syncState (entityType, localId, remoteId, projectId, isDirty, isDeleted, syncVersion)
     VALUES ('note', 2, NULL, 'proj-1', 0, 0, 0)`
  ).run()

  // Run only migration 25
  const migrator = new Migrator(db, migrations)
  migrator.migrate()

  // Verify data was preserved and converted
  const rows = db.prepare('SELECT * FROM syncState ORDER BY localId').all() as any[]
  expect(rows).toHaveLength(2)
  expect(rows[0].entityType).toBe('task')
  expect(rows[0].localId).toBe('1')  // now TEXT
  expect(rows[0].remoteId).toBe('remote-uuid-1')
  expect(rows[0].dirty).toBe(1)
  expect(rows[1].entityType).toBe('note')
  expect(rows[1].dirty).toBe(0)

  // Verify no isDirty or syncVersion columns
  const cols = db.pragma('table_info(syncState)') as { name: string }[]
  const colNames = cols.map(c => c.name)
  expect(colNames).not.toContain('isDirty')
  expect(colNames).not.toContain('syncVersion')
})

it('triggers mark syncState dirty on taskItem update', () => {
  const migrator = new Migrator(db, migrations)
  migrator.migrate()

  // Create a task
  db.prepare(
    `INSERT INTO taskItems (projectId, title, status, priority, source, createdAt, updatedAt)
     VALUES ('proj-1', 'Test task', 'todo', 0, 'manual', datetime('now'), datetime('now'))`
  ).run()
  const taskId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }

  // Register it in syncState (mark as clean)
  db.prepare(
    `INSERT INTO syncState (entityType, localId, projectId, dirty, isDeleted)
     VALUES ('task', CAST(? AS TEXT), 'proj-1', 0, 0)`
  ).run(taskId.id)

  // Update the task — trigger should fire
  db.prepare('UPDATE taskItems SET title = ? WHERE id = ?').run('Updated title', taskId.id)

  // Check that syncState was marked dirty
  const state = db.prepare(
    'SELECT dirty FROM syncState WHERE entityType = ? AND localId = CAST(? AS TEXT)'
  ).get('task', taskId.id) as { dirty: number }
  expect(state.dirty).toBe(1)
})
```

**Step 2: Run tests to verify they fail**

Run: `cd electron && npm test`
Expected: FAIL — migration 25 doesn't exist yet

**Step 3: Write migration 25**

In `electron/src/main/database/migrations/index.ts`, add after migration 24:

```typescript
// Migration 25: Reconcile syncState — if Swift created the table with isDirty/syncVersion,
// convert to Electron's canonical schema (dirty, composite PK, TEXT localId)
{
  version: 25,
  name: 'v24_reconcileSyncState',
  up: (db) => {
    const cols = db.pragma('table_info(syncState)') as { name: string }[]
    const colNames = cols.map(c => c.name)
    const hasSwiftSchema = colNames.includes('isDirty')

    if (hasSwiftSchema) {
      // Drop ALL Swift-style triggers
      const triggers = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'syncState_%' OR name LIKE 'sync_%')"
      ).all() as { name: string }[]
      for (const t of triggers) {
        db.exec(`DROP TRIGGER IF EXISTS "${t.name}"`)
      }

      // Recreate table with Electron schema, migrating data
      db.exec(`
        CREATE TABLE syncState_new (
          entityType TEXT NOT NULL,
          localId TEXT NOT NULL,
          remoteId TEXT,
          projectId TEXT,
          lastSyncedAt TEXT,
          dirty INTEGER NOT NULL DEFAULT 0,
          isDeleted INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (entityType, localId)
        );
        INSERT INTO syncState_new (entityType, localId, remoteId, projectId, lastSyncedAt, dirty, isDeleted)
          SELECT entityType, CAST(localId AS TEXT), remoteId, projectId, lastSyncedAt, isDirty, isDeleted
          FROM syncState;
        DROP TABLE syncState;
        ALTER TABLE syncState_new RENAME TO syncState;
      `)

      // Recreate Electron-style triggers
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS sync_task_dirty_update
        AFTER UPDATE ON taskItems BEGIN
          INSERT OR REPLACE INTO syncState (entityType, localId, projectId, remoteId, lastSyncedAt, dirty)
          VALUES ('task', CAST(NEW.id AS TEXT), NEW.projectId,
            (SELECT remoteId FROM syncState WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT)),
            (SELECT lastSyncedAt FROM syncState WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT)),
            1);
        END;

        CREATE TRIGGER IF NOT EXISTS sync_note_dirty_update
        AFTER UPDATE ON notes BEGIN
          INSERT OR REPLACE INTO syncState (entityType, localId, projectId, remoteId, lastSyncedAt, dirty)
          VALUES ('note', CAST(NEW.id AS TEXT), NEW.projectId,
            (SELECT remoteId FROM syncState WHERE entityType='note' AND localId=CAST(NEW.id AS TEXT)),
            (SELECT lastSyncedAt FROM syncState WHERE entityType='note' AND localId=CAST(NEW.id AS TEXT)),
            1);
        END;

        CREATE TRIGGER IF NOT EXISTS sync_task_note_dirty_insert
        AFTER INSERT ON taskNotes BEGIN
          INSERT OR REPLACE INTO syncState (entityType, localId, projectId, remoteId, lastSyncedAt, dirty)
          VALUES ('taskNote', CAST(NEW.id AS TEXT),
            (SELECT projectId FROM taskItems WHERE id = NEW.taskId),
            NULL, NULL, 1);
        END;
      `)
    }
  },
},
```

**Step 4: Update existing test expectations**

- Change `'runs all 24 migrations without error'` → `'runs all 25 migrations without error'`
- Change `expect(migrator.getCurrentVersion()).toBe(24)` → `toBe(25)` (two occurrences)

**Step 5: Run tests**

Run: `cd electron && npm test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add electron/src/main/database/migrations/index.ts electron/src/__tests__/database/migrations.test.ts
git commit -m "fix: add migration 25 to reconcile Swift-style syncState to Electron schema"
```

---

### Task 2: Update the migrator's fast-forward logic

**Files:**
- Modify: `electron/src/main/database/migrator.ts`

The current fast-forward skips ALL migrations when `grdb_migrations` exists (Swift DB). Migration 25 (reconciliation) must ALWAYS run on Swift-created DBs.

**Step 1: Update fast-forward to cap at version 24**

In `electron/src/main/database/migrator.ts`, change the fast-forward block (lines 41-48):

```typescript
if (hasSwiftTables) {
  // Fast-forward past table-creation migrations only.
  // Migration 25+ must still run (syncState schema reconciliation, etc.)
  const fastForwardTo = 24
  this.db
    .prepare('UPDATE schema_version SET version = ?')
    .run(fastForwardTo)
  currentVersion = fastForwardTo
}
```

**Step 2: Add test for Swift-DB fast-forward + reconciliation**

Add to `electron/src/__tests__/database/migrations.test.ts`:

```typescript
it('runs migration 25 on Swift-created DB after fast-forward', () => {
  // Simulate a Swift-created database
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

  // Should have fast-forwarded to 24, then run migration 25
  expect(migrator.getCurrentVersion()).toBe(25)

  // Verify syncState was converted to Electron schema
  const cols = db.pragma('table_info(syncState)') as { name: string }[]
  const colNames = cols.map(c => c.name)
  expect(colNames).toContain('dirty')
  expect(colNames).not.toContain('isDirty')

  // Verify Electron-style triggers were created
  const triggers = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%_dirty_%'"
  ).all() as { name: string }[]
  expect(triggers.length).toBeGreaterThanOrEqual(3)
})
```

**Step 3: Run tests**

Run: `cd electron && npm test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add electron/src/main/database/migrator.ts electron/src/__tests__/database/migrations.test.ts
git commit -m "fix: cap fast-forward at v24 so reconciliation migration runs on Swift DBs"
```

---

### Task 3: Update Swift SyncState model to match Electron schema

**Files:**
- Modify: `swift/Sources/CodeFire/Models/SyncState.swift`

Change the GRDB model to match the Electron column names and structure.

**Step 1: Update the SyncState struct**

Replace the struct to use `dirty` instead of `isDirty`, remove `syncVersion` and `id`:

```swift
import Foundation
import GRDB

struct SyncState: Codable, FetchableRecord, PersistableRecord {
    var entityType: String   // "task", "note", "taskNote"
    var localId: String
    var remoteId: String?
    var projectId: String?
    var lastSyncedAt: String?
    var dirty: Int
    var isDeleted: Int

    static let databaseTableName = "syncState"

    enum EntityType: String {
        case task = "task"
        case note = "note"
        case taskNote = "taskNote"
    }

    // MARK: - Convenience

    static func register(
        entityType: EntityType,
        localId: Int64,
        projectId: String,
        in db: Database
    ) throws {
        try db.execute(
            sql: """
                INSERT OR IGNORE INTO syncState (entityType, localId, projectId, dirty, isDeleted)
                VALUES (?, CAST(? AS TEXT), ?, 1, 0)
            """,
            arguments: [entityType.rawValue, localId, projectId]
        )
    }

    static func dirtyRecords(
        projectId: String,
        entityType: EntityType? = nil,
        in db: Database
    ) throws -> [SyncState] {
        var sql = "SELECT * FROM syncState WHERE dirty = 1 AND projectId = ?"
        var args: [DatabaseValueConvertible] = [projectId]
        if let type = entityType {
            sql += " AND entityType = ?"
            args.append(type.rawValue)
        }
        return try SyncState.fetchAll(db, sql: sql, arguments: StatementArguments(args))
    }

    static func markSynced(
        entityType: EntityType,
        localId: Int64,
        remoteId: String,
        in db: Database
    ) throws {
        try db.execute(
            sql: """
                UPDATE syncState
                SET dirty = 0, remoteId = ?, lastSyncedAt = CURRENT_TIMESTAMP
                WHERE entityType = ? AND localId = CAST(? AS TEXT)
            """,
            arguments: [remoteId, entityType.rawValue, localId]
        )
    }

    static func purgeDeleted(
        entityType: EntityType,
        localId: Int64,
        in db: Database
    ) throws {
        try db.execute(
            sql: "DELETE FROM syncState WHERE entityType = ? AND localId = CAST(? AS TEXT) AND isDeleted = 1",
            arguments: [entityType.rawValue, localId]
        )
    }

    static func localId(
        forRemoteId remoteId: String,
        entityType: EntityType,
        in db: Database
    ) throws -> Int64? {
        try Int64.fetchOne(
            db,
            sql: "SELECT CAST(localId AS INTEGER) FROM syncState WHERE remoteId = ? AND entityType = ?",
            arguments: [remoteId, entityType.rawValue]
        )
    }

    static func remoteId(
        forLocalId localId: Int64,
        entityType: EntityType,
        in db: Database
    ) throws -> String? {
        try String.fetchOne(
            db,
            sql: "SELECT remoteId FROM syncState WHERE localId = CAST(? AS TEXT) AND entityType = ?",
            arguments: [localId, entityType.rawValue]
        )
    }
}
```

Key changes:
- Removed `id: Int64?` (no auto-increment PK — composite PK instead)
- `isDirty: Bool` → `dirty: Int`
- Removed `syncVersion: Int64`
- `localId: Int64` → `localId: String` (TEXT in Electron)
- `projectId: String` → `projectId: String?` (nullable in Electron)
- `lastSyncedAt: Date?` → `lastSyncedAt: String?` (TEXT in Electron)
- `case taskNote = "task_note"` → `case taskNote = "taskNote"` (camelCase)
- Changed from `MutablePersistableRecord` to `PersistableRecord` (no auto-increment)
- All SQL uses `CAST(? AS TEXT)` when passing Int64 localId

**Step 2: Commit**

```bash
git add swift/Sources/CodeFire/Models/SyncState.swift
git commit -m "refactor: update Swift SyncState model to match Electron schema"
```

---

### Task 4: Update Swift DatabaseService migration to match Electron schema

**Files:**
- Modify: `swift/Sources/CodeFire/Services/DatabaseService.swift`

**Step 1: Replace migration v18_addSyncState**

Replace the syncState table creation and triggers in migration `v18_addSyncState` (keep the `updatedAt` ALTER TABLE parts, change only the syncState portion):

The table creation becomes:
```swift
try db.execute(sql: """
    CREATE TABLE IF NOT EXISTS syncState (
        entityType TEXT NOT NULL,
        localId TEXT NOT NULL,
        remoteId TEXT,
        projectId TEXT,
        lastSyncedAt TEXT,
        dirty INTEGER NOT NULL DEFAULT 0,
        isDeleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (entityType, localId)
    )
""")
```

Replace all 6 triggers with the 3 Electron-style triggers:

```swift
try db.execute(sql: """
    CREATE TRIGGER IF NOT EXISTS sync_task_dirty_update
    AFTER UPDATE ON taskItems BEGIN
        INSERT OR REPLACE INTO syncState (entityType, localId, projectId, remoteId, lastSyncedAt, dirty)
        VALUES ('task', CAST(NEW.id AS TEXT), NEW.projectId,
            (SELECT remoteId FROM syncState WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT)),
            (SELECT lastSyncedAt FROM syncState WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT)),
            1);
    END
""")

try db.execute(sql: """
    CREATE TRIGGER IF NOT EXISTS sync_note_dirty_update
    AFTER UPDATE ON notes BEGIN
        INSERT OR REPLACE INTO syncState (entityType, localId, projectId, remoteId, lastSyncedAt, dirty)
        VALUES ('note', CAST(NEW.id AS TEXT), NEW.projectId,
            (SELECT remoteId FROM syncState WHERE entityType='note' AND localId=CAST(NEW.id AS TEXT)),
            (SELECT lastSyncedAt FROM syncState WHERE entityType='note' AND localId=CAST(NEW.id AS TEXT)),
            1);
    END
""")

try db.execute(sql: """
    CREATE TRIGGER IF NOT EXISTS sync_task_note_dirty_insert
    AFTER INSERT ON taskNotes BEGIN
        INSERT OR REPLACE INTO syncState (entityType, localId, projectId, remoteId, lastSyncedAt, dirty)
        VALUES ('taskNote', CAST(NEW.id AS TEXT),
            (SELECT projectId FROM taskItems WHERE id = NEW.taskId),
            NULL, NULL, 1);
    END
""")
```

Remove the index creation lines (`syncState_unique`, `syncState_dirty`) — the composite PK handles uniqueness, and the dirty index is unnecessary overhead for now.

**Important:** Since GRDB migrations are name-based (not version-based), changing an already-applied migration won't re-run it. This is OK — the Electron reconciliation migration (Task 1) handles existing DBs. This change only affects fresh Swift installs going forward.

**Step 2: Commit**

```bash
git add swift/Sources/CodeFire/Services/DatabaseService.swift
git commit -m "refactor: update Swift syncState migration to match Electron schema"
```

---

### Task 5: Update Swift SyncEngine to use `dirty` instead of `isDirty`

**Files:**
- Modify: `swift/Sources/CodeFire/Services/SyncEngine.swift`

**Step 1: Replace all `isDirty` references in SQL strings**

There are 4 SQL strings in SyncEngine.swift that reference `isDirty`:

Line 397 — in `pullRemoteTasks`:
```swift
if let syncState, syncState.isDirty {
```
→ Change to:
```swift
if let syncState, syncState.dirty == 1 {
```

Line 404:
```swift
try db.execute(sql: "UPDATE syncState SET isDirty = 0, lastSyncedAt = CURRENT_TIMESTAMP WHERE entityType = 'task' AND localId = ?", arguments: [localId])
```
→ Change to:
```swift
try db.execute(sql: "UPDATE syncState SET dirty = 0, lastSyncedAt = CURRENT_TIMESTAMP WHERE entityType = 'task' AND localId = CAST(? AS TEXT)", arguments: [localId])
```

Line 442 — in `pullRemoteNotes`:
```swift
if let syncState, syncState.isDirty {
```
→ Change to:
```swift
if let syncState, syncState.dirty == 1 {
```

Line 449:
```swift
try db.execute(sql: "UPDATE syncState SET isDirty = 0, lastSyncedAt = CURRENT_TIMESTAMP WHERE entityType = 'note' AND localId = ?", arguments: [localId])
```
→ Change to:
```swift
try db.execute(sql: "UPDATE syncState SET dirty = 0, lastSyncedAt = CURRENT_TIMESTAMP WHERE entityType = 'note' AND localId = CAST(? AS TEXT)", arguments: [localId])
```

Also update the `syncState` fetch queries (lines 392-395, 437-440) to use `CAST(? AS TEXT)` for localId lookup:
```swift
let syncState = try SyncState.fetchOne(db, sql:
    "SELECT * FROM syncState WHERE entityType = 'task' AND localId = CAST(? AS TEXT)",
    arguments: [localId]
)
```

And the `lastSyncedAt` update lines (408, 453) similarly.

Also update all `task_note` → `taskNote` references if any exist in SyncEngine.swift (check the `pushDirtyTaskNotes` and similar methods).

**Step 2: Verify Swift builds**

Run: `cd swift && swift build`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add swift/Sources/CodeFire/Services/SyncEngine.swift
git commit -m "refactor: update Swift SyncEngine SQL to use dirty column and TEXT localId"
```

---

### Task 6: Add a Swift reconciliation migration for existing databases

**Files:**
- Modify: `swift/Sources/CodeFire/Services/DatabaseService.swift` (add new migration)

Since existing Swift users already have the old schema, add a new GRDB migration that converts it.

**Step 1: Add migration after `v18b_createRecordings`**

```swift
migrator.registerMigration("v19_reconcileSyncState") { db in
    // Check if syncState has the old Swift schema (isDirty column)
    let columns = try Row.fetchAll(db, sql: "PRAGMA table_info(syncState)")
    let colNames = columns.map { $0["name"] as String }

    if colNames.contains("isDirty") {
        // Drop all old triggers
        let triggers = try Row.fetchAll(db, sql: """
            SELECT name FROM sqlite_master WHERE type='trigger'
            AND (name LIKE 'syncState_%' OR name LIKE 'sync_%')
        """)
        for trigger in triggers {
            let name: String = trigger["name"]
            try db.execute(sql: "DROP TRIGGER IF EXISTS \"\(name)\"")
        }

        // Recreate table with Electron schema
        try db.execute(sql: """
            CREATE TABLE syncState_new (
                entityType TEXT NOT NULL,
                localId TEXT NOT NULL,
                remoteId TEXT,
                projectId TEXT,
                lastSyncedAt TEXT,
                dirty INTEGER NOT NULL DEFAULT 0,
                isDeleted INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (entityType, localId)
            );
            INSERT INTO syncState_new (entityType, localId, remoteId, projectId, lastSyncedAt, dirty, isDeleted)
                SELECT entityType, CAST(localId AS TEXT), remoteId, projectId, lastSyncedAt, isDirty, isDeleted
                FROM syncState;
            DROP TABLE syncState;
            ALTER TABLE syncState_new RENAME TO syncState;
        """)

        // Recreate Electron-style triggers
        try db.execute(sql: """
            CREATE TRIGGER IF NOT EXISTS sync_task_dirty_update
            AFTER UPDATE ON taskItems BEGIN
                INSERT OR REPLACE INTO syncState (entityType, localId, projectId, remoteId, lastSyncedAt, dirty)
                VALUES ('task', CAST(NEW.id AS TEXT), NEW.projectId,
                    (SELECT remoteId FROM syncState WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT)),
                    (SELECT lastSyncedAt FROM syncState WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT)),
                    1);
            END
        """)

        try db.execute(sql: """
            CREATE TRIGGER IF NOT EXISTS sync_note_dirty_update
            AFTER UPDATE ON notes BEGIN
                INSERT OR REPLACE INTO syncState (entityType, localId, projectId, remoteId, lastSyncedAt, dirty)
                VALUES ('note', CAST(NEW.id AS TEXT), NEW.projectId,
                    (SELECT remoteId FROM syncState WHERE entityType='note' AND localId=CAST(NEW.id AS TEXT)),
                    (SELECT lastSyncedAt FROM syncState WHERE entityType='note' AND localId=CAST(NEW.id AS TEXT)),
                    1);
            END
        """)

        try db.execute(sql: """
            CREATE TRIGGER IF NOT EXISTS sync_task_note_dirty_insert
            AFTER INSERT ON taskNotes BEGIN
                INSERT OR REPLACE INTO syncState (entityType, localId, projectId, remoteId, lastSyncedAt, dirty)
                VALUES ('taskNote', CAST(NEW.id AS TEXT),
                    (SELECT projectId FROM taskItems WHERE id = NEW.taskId),
                    NULL, NULL, 1);
            END
        """)
    }
}
```

**Step 2: Verify Swift builds**

Run: `cd swift && swift build`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add swift/Sources/CodeFire/Services/DatabaseService.swift
git commit -m "fix: add Swift migration to reconcile syncState to Electron schema"
```

---

### Task 7: Verify end-to-end

**Step 1: Build both platforms**

```bash
cd electron && npm run build
cd swift && swift build
```

**Step 2: Run Electron tests**

```bash
cd electron && npm test
```

Expected: ALL PASS

**Step 3: Manual smoke test**

- Start the Electron app (or MCP server)
- Create/update a task — verify no SQLite errors
- If on macOS with Swift app: verify both apps can read/write tasks without errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: syncState schema unification complete"
```

---

## Files Changed Summary

| File | Change |
|------|--------|
| `electron/src/main/database/migrations/index.ts` | Add migration 25 (reconcile Swift→Electron schema) |
| `electron/src/main/database/migrator.ts` | Cap fast-forward at v24 |
| `electron/src/__tests__/database/migrations.test.ts` | Add reconciliation + trigger tests, update version expectations |
| `swift/Sources/CodeFire/Models/SyncState.swift` | `isDirty` → `dirty`, remove `syncVersion`/`id`, `localId` → `String`, `task_note` → `taskNote` |
| `swift/Sources/CodeFire/Services/DatabaseService.swift` | Update v18 migration table/triggers, add v19 reconciliation migration |
| `swift/Sources/CodeFire/Services/SyncEngine.swift` | `isDirty` → `dirty`, `CAST(localId AS TEXT)` in queries |

**No Electron SyncEngine.ts or premium-models.ts changes needed** — Electron is already the source of truth.

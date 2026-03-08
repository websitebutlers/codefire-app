import Foundation
import GRDB

class DatabaseService {
    static let shared = DatabaseService()
    private(set) var dbQueue: DatabaseQueue!

    private init() {}

    func setup() throws {
        let appSupportURL = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!.appendingPathComponent("CodeFire", isDirectory: true)

        try FileManager.default.createDirectory(
            at: appSupportURL,
            withIntermediateDirectories: true
        )

        let dbPath = appSupportURL.appendingPathComponent("codefire.db").path
        var config = Configuration()
        config.busyMode = .timeout(5.0) // Wait up to 5s for locks (cross-process access with CodeFireMCP)
        dbQueue = try DatabaseQueue(path: dbPath, configuration: config)

        // Enable WAL mode for concurrent cross-process access
        try dbQueue.writeWithoutTransaction { db in
            try db.execute(sql: "PRAGMA journal_mode=WAL")
        }

        try migrator.migrate(dbQueue)

        // Ensure __global__ project exists for email-created and global tasks
        try dbQueue.write { db in
            try db.execute(sql: """
                INSERT OR IGNORE INTO projects (id, name, path, createdAt, sortOrder)
                VALUES ('__global__', 'Global', '', ?, -1)
            """, arguments: [Date()])
        }
    }

    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1_createTables") { db in
            try db.create(table: "projects") { t in
                t.primaryKey("id", .text)
                t.column("name", .text).notNull()
                t.column("path", .text).notNull().unique()
                t.column("claudeProject", .text)
                t.column("lastOpened", .datetime)
                t.column("createdAt", .datetime).notNull()
            }

            try db.create(table: "sessions") { t in
                t.primaryKey("id", .text)
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("slug", .text)
                t.column("startedAt", .datetime)
                t.column("endedAt", .datetime)
                t.column("model", .text)
                t.column("gitBranch", .text)
                t.column("summary", .text)
                t.column("messageCount", .integer).notNull().defaults(to: 0)
                t.column("toolUseCount", .integer).notNull().defaults(to: 0)
                t.column("filesChanged", .text)
            }

            try db.create(table: "codebaseSnapshots") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("capturedAt", .datetime).notNull()
                t.column("fileTree", .text)
                t.column("schemaHash", .text)
                t.column("keySymbols", .text)
            }

            try db.create(table: "notes") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("title", .text).notNull()
                t.column("content", .text).notNull().defaults(to: "")
                t.column("pinned", .boolean).notNull().defaults(to: false)
                t.column("sessionId", .text)
                    .references("sessions", onDelete: .setNull)
                t.column("createdAt", .datetime).notNull()
                t.column("updatedAt", .datetime).notNull()
            }

            try db.create(table: "patterns") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("category", .text).notNull()
                t.column("title", .text).notNull()
                t.column("description", .text).notNull()
                t.column("sourceSession", .text)
                    .references("sessions", onDelete: .setNull)
                t.column("autoDetected", .boolean).notNull().defaults(to: false)
                t.column("createdAt", .datetime).notNull()
            }

            try db.create(table: "taskItems") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("title", .text).notNull()
                t.column("description", .text)
                t.column("status", .text).notNull().defaults(to: "todo")
                t.column("priority", .integer).notNull().defaults(to: 0)
                t.column("sourceSession", .text)
                    .references("sessions", onDelete: .setNull)
                t.column("source", .text).notNull().defaults(to: "manual")
                t.column("createdAt", .datetime).notNull()
                t.column("completedAt", .datetime)
            }
        }

        migrator.registerMigration("v2_addTokenColumns") { db in
            try db.alter(table: "sessions") { t in
                t.add(column: "inputTokens", .integer).notNull().defaults(to: 0)
                t.add(column: "outputTokens", .integer).notNull().defaults(to: 0)
                t.add(column: "cacheCreationTokens", .integer).notNull().defaults(to: 0)
                t.add(column: "cacheReadTokens", .integer).notNull().defaults(to: 0)
            }
        }

        migrator.registerMigration("v3_addTaskLabels") { db in
            try db.alter(table: "taskItems") { t in
                t.add(column: "labels", .text) // JSON array of strings
            }
        }

        migrator.registerMigration("v4_addTaskAttachments") { db in
            try db.alter(table: "taskItems") { t in
                t.add(column: "attachments", .text) // JSON array of file paths
            }
        }

        migrator.registerMigration("v5_createTaskNotes") { db in
            try db.create(table: "taskNotes") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("taskId", .integer).notNull()
                    .references("taskItems", onDelete: .cascade)
                t.column("content", .text).notNull()
                t.column("source", .text).notNull().defaults(to: "manual") // "manual", "claude", "system"
                t.column("sessionId", .text) // which Claude session added this
                t.column("createdAt", .datetime).notNull()
            }
        }

        migrator.registerMigration("v1_createFTS") { db in
            // Full-text search on sessions
            try db.create(virtualTable: "sessionsFts", using: FTS5()) { t in
                t.synchronize(withTable: "sessions")
                t.column("summary")
            }

            // Full-text search on notes
            try db.create(virtualTable: "notesFts", using: FTS5()) { t in
                t.synchronize(withTable: "notes")
                t.column("title")
                t.column("content")
            }
        }

        migrator.registerMigration("v6_addClients") { db in
            try db.create(table: "clients") { t in
                t.primaryKey("id", .text)
                t.column("name", .text).notNull()
                t.column("color", .text).notNull().defaults(to: "#3B82F6")
                t.column("sortOrder", .integer).notNull().defaults(to: 0)
                t.column("createdAt", .datetime).notNull()
            }
        }

        migrator.registerMigration("v7_addProjectClientAndTags") { db in
            try db.alter(table: "projects") { t in
                t.add(column: "clientId", .text).references("clients", onDelete: .setNull)
                t.add(column: "tags", .text)
                t.add(column: "sortOrder", .integer).defaults(to: 0)
            }
        }

        migrator.registerMigration("v8_addGlobalFlags") { db in
            try db.alter(table: "taskItems") { t in
                t.add(column: "isGlobal", .boolean).notNull().defaults(to: false)
            }
            try db.alter(table: "notes") { t in
                t.add(column: "isGlobal", .boolean).notNull().defaults(to: false)
            }
        }

        migrator.registerMigration("v9_addGmailIntegration") { db in
            try db.create(table: "gmailAccounts") { t in
                t.primaryKey("id", .text)
                t.column("email", .text).notNull().unique()
                t.column("lastHistoryId", .text)
                t.column("isActive", .boolean).notNull().defaults(to: true)
                t.column("createdAt", .datetime).notNull()
                t.column("lastSyncAt", .datetime)
            }

            try db.create(table: "whitelistRules") { t in
                t.primaryKey("id", .text)
                t.column("pattern", .text).notNull()
                t.column("clientId", .text).references("clients", onDelete: .setNull)
                t.column("priority", .integer).notNull().defaults(to: 0)
                t.column("isActive", .boolean).notNull().defaults(to: true)
                t.column("createdAt", .datetime).notNull()
                t.column("note", .text)
            }

            try db.create(table: "processedEmails") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("gmailMessageId", .text).notNull().unique()
                t.column("gmailThreadId", .text).notNull()
                t.column("gmailAccountId", .text).notNull()
                    .references("gmailAccounts", onDelete: .cascade)
                t.column("fromAddress", .text).notNull()
                t.column("fromName", .text)
                t.column("subject", .text).notNull()
                t.column("snippet", .text)
                t.column("body", .text)
                t.column("receivedAt", .datetime).notNull()
                t.column("taskId", .integer)
                    .references("taskItems", onDelete: .setNull)
                t.column("triageType", .text)
                t.column("isRead", .boolean).notNull().defaults(to: false)
                t.column("repliedAt", .datetime)
                t.column("importedAt", .datetime).notNull()
            }

            try db.alter(table: "taskItems") { t in
                t.add(column: "gmailThreadId", .text)
                t.add(column: "gmailMessageId", .text)
            }
        }

        migrator.registerMigration("v10_seedGlobalProject") { db in
            // Insert a sentinel project so global tasks (email-created) satisfy the FK constraint
            let exists = try Bool.fetchOne(db, sql:
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = '__global__')"
            ) ?? false
            if !exists {
                try db.execute(
                    sql: """
                        INSERT INTO projects (id, name, path, createdAt, sortOrder)
                        VALUES ('__global__', 'Global', '', ?, -1)
                        """,
                    arguments: [Date()]
                )
            }
        }

        migrator.registerMigration("v11_createBrowserScreenshots") { db in
            try db.create(table: "browserScreenshots") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("filePath", .text).notNull()
                t.column("pageURL", .text)
                t.column("pageTitle", .text)
                t.column("createdAt", .datetime).notNull()
            }
        }

        migrator.registerMigration("v12_createChatTables") { db in
            try db.create(table: "chatConversations") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text) // nullable — null means global
                t.column("title", .text).notNull()
                t.column("createdAt", .datetime).notNull()
                t.column("updatedAt", .datetime).notNull()
            }

            try db.create(table: "chatMessages") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("conversationId", .integer).notNull()
                    .references("chatConversations", onDelete: .cascade)
                t.column("role", .text).notNull()
                t.column("content", .text).notNull()
                t.column("createdAt", .datetime).notNull()
            }
        }

        migrator.registerMigration("v13_addProfileText") { db in
            try db.alter(table: "codebaseSnapshots") { t in
                t.add(column: "profileText", .text)
            }
        }

        migrator.registerMigration("v14_createBrowserCommands") { db in
            try db.create(table: "browserCommands", ifNotExists: true) { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("tool", .text).notNull()
                t.column("args", .text)
                t.column("status", .text).notNull().defaults(to: "pending")
                t.column("result", .text)
                t.column("createdAt", .datetime).notNull()
                t.column("completedAt", .datetime)
            }
        }

        migrator.registerMigration("v15_createContextEngine") { db in
            try db.create(table: "indexedFiles", ifNotExists: true) { t in
                t.primaryKey("id", .text)
                t.column("projectId", .text).notNull()
                t.column("relativePath", .text).notNull()
                t.column("contentHash", .text).notNull()
                t.column("language", .text)
                t.column("lastIndexedAt", .datetime).notNull()
            }
            try db.create(index: "indexedFiles_projectId", on: "indexedFiles", columns: ["projectId"], ifNotExists: true)
            try db.create(index: "indexedFiles_path", on: "indexedFiles", columns: ["projectId", "relativePath"], unique: true, ifNotExists: true)

            try db.create(table: "codeChunks", ifNotExists: true) { t in
                t.primaryKey("id", .text)
                t.column("fileId", .text).notNull()
                t.column("projectId", .text).notNull()
                t.column("chunkType", .text).notNull()
                t.column("symbolName", .text)
                t.column("content", .text).notNull()
                t.column("startLine", .integer)
                t.column("endLine", .integer)
                t.column("embedding", .blob)
            }
            try db.create(index: "codeChunks_projectId", on: "codeChunks", columns: ["projectId"], ifNotExists: true)
            try db.create(index: "codeChunks_fileId", on: "codeChunks", columns: ["fileId"], ifNotExists: true)

            try db.create(table: "indexState", ifNotExists: true) { t in
                t.primaryKey("projectId", .text)
                t.column("status", .text).notNull().defaults(to: "idle")
                t.column("lastFullIndexAt", .datetime)
                t.column("totalChunks", .integer).notNull().defaults(to: 0)
                t.column("lastError", .text)
            }

            try db.create(table: "indexRequests", ifNotExists: true) { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                t.column("projectPath", .text).notNull()
                t.column("status", .text).notNull().defaults(to: "pending")
                t.column("createdAt", .datetime).notNull()
            }

            // FTS virtual tables don't support ifNotExists in GRDB, so check manually
            let ftsExists = try Row.fetchOne(db, sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name='codeChunksFts'")
            if ftsExists == nil {
                try db.create(virtualTable: "codeChunksFts", using: FTS5()) { t in
                    t.synchronize(withTable: "codeChunks")
                    t.column("content")
                    t.column("symbolName")
                }
            }
        }

        migrator.registerMigration("v16_createBriefing") { db in
            try db.create(table: "briefingDigests") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("generatedAt", .datetime).notNull().defaults(sql: "CURRENT_TIMESTAMP")
                t.column("itemCount", .integer).notNull().defaults(to: 0)
                t.column("status", .text).notNull().defaults(to: "generating")
            }

            try db.create(table: "briefingItems") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("digestId", .integer).notNull()
                    .references("briefingDigests", onDelete: .cascade)
                t.column("title", .text).notNull()
                t.column("summary", .text).notNull()
                t.column("category", .text).notNull()
                t.column("sourceUrl", .text).notNull()
                t.column("sourceName", .text).notNull()
                t.column("publishedAt", .datetime)
                t.column("relevanceScore", .integer).notNull().defaults(to: 5)
                t.column("isSaved", .boolean).notNull().defaults(to: false)
                t.column("isRead", .boolean).notNull().defaults(to: false)
            }
        }

        migrator.registerMigration("v17_createGeneratedImages") { db in
            try db.create(table: "generatedImages") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("prompt", .text).notNull()
                t.column("responseText", .text)
                t.column("filePath", .text).notNull()
                t.column("model", .text).notNull()
                    .defaults(to: "google/gemini-3.1-flash-image-preview")
                t.column("aspectRatio", .text).defaults(to: "1:1")
                t.column("imageSize", .text).defaults(to: "1K")
                t.column("parentImageId", .integer)
                    .references("generatedImages", onDelete: .setNull)
                t.column("createdAt", .datetime).notNull()
            }
        }

        migrator.registerMigration("v18_addSyncState") { db in
            // Add updatedAt to taskItems (needed for last-write-wins conflict resolution)
            try db.alter(table: "taskItems") { t in
                t.add(column: "updatedAt", .datetime)
            }
            // Backfill updatedAt from createdAt
            try db.execute(sql: "UPDATE taskItems SET updatedAt = createdAt WHERE updatedAt IS NULL")

            // Add updatedAt to taskNotes
            try db.alter(table: "taskNotes") { t in
                t.add(column: "updatedAt", .datetime)
            }
            try db.execute(sql: "UPDATE taskNotes SET updatedAt = createdAt WHERE updatedAt IS NULL")

            // Sync state: maps local integer IDs to remote Supabase UUIDs
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

            // Triggers: auto-mark dirty on changes (INSERT OR REPLACE pattern)
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

        migrator.registerMigration("v18b_createRecordings") { db in
            try db.create(table: "recordings", ifNotExists: true) { t in
                t.primaryKey("id", .text)
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("title", .text).notNull()
                t.column("audioPath", .text).notNull()
                t.column("duration", .double).notNull().defaults(to: 0)
                t.column("transcript", .text)
                t.column("status", .text).notNull().defaults(to: "recording")
                t.column("errorMessage", .text)
                t.column("createdAt", .datetime).notNull()
            }

            let taskColumns = try db.columns(in: "taskItems").map(\.name)
            if !taskColumns.contains("recordingId") {
                try db.alter(table: "taskItems") { t in
                    t.add(column: "recordingId", .text)
                }
            }
        }

        migrator.registerMigration("v19_addProjectRepoUrl") { db in
            try db.alter(table: "projects") { t in
                t.add(column: "repoUrl", .text)  // Git remote origin URL
            }
        }

        migrator.registerMigration("v20_addTaskNoteMentions") { db in
            try db.alter(table: "taskNotes") { t in
                t.add(column: "mentions", .text)  // JSON array of user UUIDs
            }
        }

        migrator.registerMigration("v21_reconcileSyncState") { db in
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

        // Migration: Add INSERT triggers for tasks and notes so new items enter syncState.
        // The existing triggers only fire on UPDATE, meaning newly created tasks/notes
        // are invisible to the SyncEngine push pipeline.
        migrator.registerMigration("v22_addSyncInsertTriggers") { db in
            try db.execute(sql: """
                CREATE TRIGGER IF NOT EXISTS sync_task_dirty_insert
                AFTER INSERT ON taskItems BEGIN
                    INSERT OR IGNORE INTO syncState (entityType, localId, projectId, dirty)
                    VALUES ('task', CAST(NEW.id AS TEXT), NEW.projectId, 1);
                END
            """)

            try db.execute(sql: """
                CREATE TRIGGER IF NOT EXISTS sync_note_dirty_insert
                AFTER INSERT ON notes BEGIN
                    INSERT OR IGNORE INTO syncState (entityType, localId, projectId, dirty)
                    VALUES ('note', CAST(NEW.id AS TEXT), NEW.projectId, 1);
                END
            """)
        }

        return migrator
    }
}

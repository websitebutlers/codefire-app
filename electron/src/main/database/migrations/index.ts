import type { Migration } from '../migrator'

export const migrations: Migration[] = [
  // Migration 1: Create all base tables
  {
    version: 1,
    name: 'v1_createTables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          claudeProject TEXT,
          lastOpened DATETIME,
          createdAt DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          slug TEXT,
          startedAt DATETIME,
          endedAt DATETIME,
          model TEXT,
          gitBranch TEXT,
          summary TEXT,
          messageCount INTEGER NOT NULL DEFAULT 0,
          toolUseCount INTEGER NOT NULL DEFAULT 0,
          filesChanged TEXT
        );

        CREATE TABLE IF NOT EXISTS codebaseSnapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          capturedAt DATETIME NOT NULL,
          fileTree TEXT,
          schemaHash TEXT,
          keySymbols TEXT
        );

        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          pinned BOOLEAN NOT NULL DEFAULT 0,
          sessionId TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS patterns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          sourceSession TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          autoDetected BOOLEAN NOT NULL DEFAULT 0,
          createdAt DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS taskItems (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'todo',
          priority INTEGER NOT NULL DEFAULT 0,
          sourceSession TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          source TEXT NOT NULL DEFAULT 'manual',
          createdAt DATETIME NOT NULL,
          completedAt DATETIME
        );
      `)
    },
  },

  // Migration 2: Add token tracking columns to sessions
  {
    version: 2,
    name: 'v2_addTokenColumns',
    up: (db) => {
      db.exec(`
        ALTER TABLE sessions ADD COLUMN inputTokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN outputTokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN cacheCreationTokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN cacheReadTokens INTEGER NOT NULL DEFAULT 0;
      `)
    },
  },

  // Migration 3: Add labels column to taskItems
  {
    version: 3,
    name: 'v3_addTaskLabels',
    up: (db) => {
      db.exec(`ALTER TABLE taskItems ADD COLUMN labels TEXT;`)
    },
  },

  // Migration 4: Add attachments column to taskItems
  {
    version: 4,
    name: 'v4_addTaskAttachments',
    up: (db) => {
      db.exec(`ALTER TABLE taskItems ADD COLUMN attachments TEXT;`)
    },
  },

  // Migration 5: Create taskNotes table
  {
    version: 5,
    name: 'v5_createTaskNotes',
    up: (db) => {
      db.exec(`
        CREATE TABLE taskNotes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          taskId INTEGER NOT NULL REFERENCES taskItems(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'manual',
          sessionId TEXT,
          createdAt DATETIME NOT NULL
        );
      `)
    },
  },

  // Migration 6: Create FTS virtual tables and sync triggers
  {
    version: 6,
    name: 'v1_createFTS',
    up: (db) => {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS sessionsFts USING fts5(summary, content='sessions', content_rowid='rowid');
        CREATE VIRTUAL TABLE IF NOT EXISTS notesFts USING fts5(title, content, content='notes', content_rowid='id');

        CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
          INSERT INTO sessionsFts(rowid, summary) VALUES (NEW.rowid, NEW.summary);
        END;
        CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
          INSERT INTO sessionsFts(sessionsFts, rowid, summary) VALUES ('delete', OLD.rowid, OLD.summary);
        END;
        CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
          INSERT INTO sessionsFts(sessionsFts, rowid, summary) VALUES ('delete', OLD.rowid, OLD.summary);
          INSERT INTO sessionsFts(rowid, summary) VALUES (NEW.rowid, NEW.summary);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notesFts(rowid, title, content) VALUES (NEW.id, NEW.title, NEW.content);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
          INSERT INTO notesFts(notesFts, rowid, title, content) VALUES ('delete', OLD.id, OLD.title, OLD.content);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
          INSERT INTO notesFts(notesFts, rowid, title, content) VALUES ('delete', OLD.id, OLD.title, OLD.content);
          INSERT INTO notesFts(rowid, title, content) VALUES (NEW.id, NEW.title, NEW.content);
        END;
      `)
    },
  },

  // Migration 7: Create clients table
  {
    version: 7,
    name: 'v6_addClients',
    up: (db) => {
      db.exec(`
        CREATE TABLE clients (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '#3B82F6',
          sortOrder INTEGER NOT NULL DEFAULT 0,
          createdAt DATETIME NOT NULL
        );
      `)
    },
  },

  // Migration 8: Add client reference, tags, and sort order to projects
  {
    version: 8,
    name: 'v7_addProjectClientAndTags',
    up: (db) => {
      db.exec(`
        ALTER TABLE projects ADD COLUMN clientId TEXT REFERENCES clients(id) ON DELETE SET NULL;
        ALTER TABLE projects ADD COLUMN tags TEXT;
        ALTER TABLE projects ADD COLUMN sortOrder INTEGER DEFAULT 0;
      `)
    },
  },

  // Migration 9: Add global flags to tasks and notes
  {
    version: 9,
    name: 'v8_addGlobalFlags',
    up: (db) => {
      db.exec(`
        ALTER TABLE taskItems ADD COLUMN isGlobal BOOLEAN NOT NULL DEFAULT 0;
        ALTER TABLE notes ADD COLUMN isGlobal BOOLEAN NOT NULL DEFAULT 0;
      `)
    },
  },

  // Migration 10: Gmail integration tables
  {
    version: 10,
    name: 'v9_addGmailIntegration',
    up: (db) => {
      db.exec(`
        CREATE TABLE gmailAccounts (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          lastHistoryId TEXT,
          isActive BOOLEAN NOT NULL DEFAULT 1,
          createdAt DATETIME NOT NULL,
          lastSyncAt DATETIME
        );

        CREATE TABLE whitelistRules (
          id TEXT PRIMARY KEY,
          pattern TEXT NOT NULL,
          clientId TEXT REFERENCES clients(id) ON DELETE SET NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          isActive BOOLEAN NOT NULL DEFAULT 1,
          createdAt DATETIME NOT NULL,
          note TEXT
        );

        CREATE TABLE processedEmails (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          gmailMessageId TEXT NOT NULL UNIQUE,
          gmailThreadId TEXT NOT NULL,
          gmailAccountId TEXT NOT NULL REFERENCES gmailAccounts(id) ON DELETE CASCADE,
          fromAddress TEXT NOT NULL,
          fromName TEXT,
          subject TEXT NOT NULL,
          snippet TEXT,
          body TEXT,
          receivedAt DATETIME NOT NULL,
          taskId INTEGER REFERENCES taskItems(id) ON DELETE SET NULL,
          triageType TEXT,
          isRead BOOLEAN NOT NULL DEFAULT 0,
          repliedAt DATETIME,
          importedAt DATETIME NOT NULL
        );

        ALTER TABLE taskItems ADD COLUMN gmailThreadId TEXT;
        ALTER TABLE taskItems ADD COLUMN gmailMessageId TEXT;
      `)
    },
  },

  // Migration 11: Seed the global project
  {
    version: 11,
    name: 'v10_seedGlobalProject',
    up: (db) => {
      db.exec(`
        INSERT OR IGNORE INTO projects (id, name, path, createdAt, sortOrder)
        VALUES ('__global__', 'Global', '', datetime('now'), -1);
      `)
    },
  },

  // Migration 12: Browser screenshots table
  {
    version: 12,
    name: 'v11_createBrowserScreenshots',
    up: (db) => {
      db.exec(`
        CREATE TABLE browserScreenshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          filePath TEXT NOT NULL,
          pageURL TEXT,
          pageTitle TEXT,
          createdAt DATETIME NOT NULL
        );
      `)
    },
  },

  // Migration 13: Chat conversations and messages tables
  {
    version: 13,
    name: 'v12_createChatTables',
    up: (db) => {
      db.exec(`
        CREATE TABLE chatConversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          projectId TEXT,
          title TEXT NOT NULL,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL
        );

        CREATE TABLE chatMessages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversationId INTEGER NOT NULL REFERENCES chatConversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          createdAt DATETIME NOT NULL
        );
      `)
    },
  },

  // Migration 14: Add profileText to codebase snapshots
  {
    version: 14,
    name: 'v13_addProfileText',
    up: (db) => {
      db.exec(`ALTER TABLE codebaseSnapshots ADD COLUMN profileText TEXT;`)
    },
  },

  // Migration 15: Browser commands table
  {
    version: 15,
    name: 'v14_createBrowserCommands',
    up: (db) => {
      db.exec(`
        CREATE TABLE browserCommands (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tool TEXT NOT NULL,
          args TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          result TEXT,
          createdAt DATETIME NOT NULL,
          completedAt DATETIME
        );
      `)
    },
  },

  // Migration 16: Context engine tables (indexedFiles, codeChunks, FTS, indexState, indexRequests)
  {
    version: 16,
    name: 'v15_createContextEngine',
    up: (db) => {
      db.exec(`
        CREATE TABLE indexedFiles (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          relativePath TEXT NOT NULL,
          contentHash TEXT NOT NULL,
          language TEXT,
          lastIndexedAt DATETIME NOT NULL
        );

        CREATE INDEX indexedFiles_projectId ON indexedFiles(projectId);
        CREATE UNIQUE INDEX indexedFiles_path ON indexedFiles(projectId, relativePath);

        CREATE TABLE codeChunks (
          id TEXT PRIMARY KEY,
          fileId TEXT NOT NULL,
          projectId TEXT NOT NULL,
          chunkType TEXT NOT NULL,
          symbolName TEXT,
          content TEXT NOT NULL,
          startLine INTEGER,
          endLine INTEGER,
          embedding BLOB
        );

        CREATE INDEX codeChunks_projectId ON codeChunks(projectId);
        CREATE INDEX codeChunks_fileId ON codeChunks(fileId);

        CREATE VIRTUAL TABLE IF NOT EXISTS codeChunksFts USING fts5(content, symbolName, content='codeChunks', content_rowid='rowid');

        CREATE TRIGGER IF NOT EXISTS codeChunks_ai AFTER INSERT ON codeChunks BEGIN
          INSERT INTO codeChunksFts(rowid, content, symbolName) VALUES (NEW.rowid, NEW.content, NEW.symbolName);
        END;
        CREATE TRIGGER IF NOT EXISTS codeChunks_ad AFTER DELETE ON codeChunks BEGIN
          INSERT INTO codeChunksFts(codeChunksFts, rowid, content, symbolName) VALUES ('delete', OLD.rowid, OLD.content, OLD.symbolName);
        END;
        CREATE TRIGGER IF NOT EXISTS codeChunks_au AFTER UPDATE ON codeChunks BEGIN
          INSERT INTO codeChunksFts(codeChunksFts, rowid, content, symbolName) VALUES ('delete', OLD.rowid, OLD.content, OLD.symbolName);
          INSERT INTO codeChunksFts(rowid, content, symbolName) VALUES (NEW.rowid, NEW.content, NEW.symbolName);
        END;

        CREATE TABLE indexState (
          projectId TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'idle',
          lastFullIndexAt DATETIME,
          totalChunks INTEGER NOT NULL DEFAULT 0,
          lastError TEXT
        );

        CREATE TABLE indexRequests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          projectId TEXT NOT NULL,
          projectPath TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          createdAt DATETIME NOT NULL
        );
      `)
    },
  },

  // Migration 17: Briefing digest and items tables
  {
    version: 17,
    name: 'v16_createBriefing',
    up: (db) => {
      db.exec(`
        CREATE TABLE briefingDigests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          generatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          itemCount INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'generating'
        );

        CREATE TABLE briefingItems (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          digestId INTEGER NOT NULL REFERENCES briefingDigests(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          category TEXT NOT NULL,
          sourceUrl TEXT NOT NULL,
          sourceName TEXT NOT NULL,
          publishedAt DATETIME,
          relevanceScore INTEGER NOT NULL DEFAULT 5,
          isSaved BOOLEAN NOT NULL DEFAULT 0,
          isRead BOOLEAN NOT NULL DEFAULT 0
        );
      `)
    },
  },

  // Migration 18: Generated images table
  {
    version: 18,
    name: 'v17_createGeneratedImages',
    up: (db) => {
      db.exec(`
        CREATE TABLE generatedImages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          prompt TEXT NOT NULL,
          responseText TEXT,
          filePath TEXT NOT NULL,
          model TEXT NOT NULL DEFAULT 'google/gemini-3.1-flash-image-preview',
          aspectRatio TEXT DEFAULT '1:1',
          imageSize TEXT DEFAULT '1K',
          parentImageId INTEGER REFERENCES generatedImages(id) ON DELETE SET NULL,
          createdAt DATETIME NOT NULL
        );
      `)
    },
  },

  // Migration 19: Recordings table and task recording link
  {
    version: 19,
    name: 'v18_createRecordings',
    up: (db) => {
      db.exec(`
        CREATE TABLE recordings (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          audioPath TEXT NOT NULL,
          duration REAL NOT NULL DEFAULT 0,
          transcript TEXT,
          status TEXT NOT NULL DEFAULT 'recording',
          errorMessage TEXT,
          createdAt DATETIME NOT NULL
        );

        ALTER TABLE taskItems ADD COLUMN recordingId TEXT;
      `)
    },
  },

  // Migration 20: FTS5 for taskItems (title + description)
  {
    version: 20,
    name: 'v19_createTaskItemsFts',
    up: (db) => {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS taskItemsFts USING fts5(title, description, content='taskItems', content_rowid='rowid');

        -- Backfill existing rows
        INSERT INTO taskItemsFts(rowid, title, description)
          SELECT rowid, title, COALESCE(description, '') FROM taskItems;

        CREATE TRIGGER IF NOT EXISTS taskItems_fts_ai AFTER INSERT ON taskItems BEGIN
          INSERT INTO taskItemsFts(rowid, title, description) VALUES (NEW.rowid, NEW.title, COALESCE(NEW.description, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS taskItems_fts_ad AFTER DELETE ON taskItems BEGIN
          INSERT INTO taskItemsFts(taskItemsFts, rowid, title, description) VALUES ('delete', OLD.rowid, OLD.title, COALESCE(OLD.description, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS taskItems_fts_au AFTER UPDATE ON taskItems BEGIN
          INSERT INTO taskItemsFts(taskItemsFts, rowid, title, description) VALUES ('delete', OLD.rowid, OLD.title, COALESCE(OLD.description, ''));
          INSERT INTO taskItemsFts(rowid, title, description) VALUES (NEW.rowid, NEW.title, COALESCE(NEW.description, ''));
        END;
      `)
    },
  },

  // Migration 21: Sync state tracking for premium sync
  {
    version: 21,
    name: 'v20_createSyncState',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS syncState (
          entityType TEXT NOT NULL,
          localId TEXT NOT NULL,
          remoteId TEXT,
          projectId TEXT,
          lastSyncedAt DATETIME,
          dirty INTEGER NOT NULL DEFAULT 0,
          isDeleted INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (entityType, localId)
        );

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
    },
  },

  // Migration 22: Add repoUrl to projects
  {
    version: 22,
    name: 'v21_addProjectRepoUrl',
    up: (db) => {
      const cols = db.pragma('table_info(projects)') as { name: string }[]
      if (!cols.some(c => c.name === 'repoUrl')) {
        db.exec(`ALTER TABLE projects ADD COLUMN repoUrl TEXT;`)
      }
    },
  },

  // Migration 23: Add mentions to taskNotes
  {
    version: 23,
    name: 'v22_addTaskNoteMentions',
    up: (db) => {
      const cols = db.pragma('table_info(taskNotes)') as { name: string }[]
      if (!cols.some(c => c.name === 'mentions')) {
        db.exec(`ALTER TABLE taskNotes ADD COLUMN mentions TEXT;`)
      }
    },
  },

  // Migration 24: Add updatedAt to taskItems
  {
    version: 24,
    name: 'v23_addTaskUpdatedAt',
    up: (db) => {
      const cols = db.pragma('table_info(taskItems)') as { name: string }[]
      if (!cols.some(c => c.name === 'updatedAt')) {
        db.exec(`ALTER TABLE taskItems ADD COLUMN updatedAt DATETIME;`)
      }
    },
  },

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

  // Migration 26: Add INSERT triggers for tasks and notes so new items enter syncState.
  // The existing triggers only fire on UPDATE, meaning newly created tasks/notes never
  // get marked dirty and are invisible to the SyncEngine push pipeline.
  {
    version: 26,
    name: 'v25_addSyncInsertTriggers',
    up: (db) => {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS sync_task_dirty_insert
        AFTER INSERT ON taskItems BEGIN
          INSERT OR IGNORE INTO syncState (entityType, localId, projectId, dirty)
          VALUES ('task', CAST(NEW.id AS TEXT), NEW.projectId, 1);
        END;

        CREATE TRIGGER IF NOT EXISTS sync_note_dirty_insert
        AFTER INSERT ON notes BEGIN
          INSERT OR IGNORE INTO syncState (entityType, localId, projectId, dirty)
          VALUES ('note', CAST(NEW.id AS TEXT), NEW.projectId, 1);
        END;
      `)
    },
  },
]

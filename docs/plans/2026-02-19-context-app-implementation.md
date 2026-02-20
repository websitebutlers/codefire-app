# Context.app Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a native macOS app that manages Claude Code session context with a split-view terminal + GUI, backed by SQLite and a local MCP server.

**Architecture:** SwiftUI app with HSplitView — SwiftTerm terminal on the left, tabbed GUI on the right. GRDB.swift for SQLite persistence. FSEvents for file watching. Unix socket MCP server for token-efficient context delivery to Claude Code sessions.

**Tech Stack:** Swift 5.9+, SwiftUI, macOS 14+, GRDB.swift, SwiftTerm, SQLite (FTS5), FSEvents

---

## Phase 1: Project Foundation

### Task 1: Create Xcode Project and Add Dependencies

**Files:**
- Create: `Context/Context.xcodeproj` (via Xcode CLI or manual)
- Create: `Context/Context/ContextApp.swift`
- Create: `Context/Package.swift` (or configure SPM in Xcode)

**Step 1: Create the Xcode project**

Use Xcode's command-line tools to scaffold a macOS SwiftUI app:

```bash
mkdir -p Context
cd Context
```

Create the project via Xcode (File > New > Project > macOS > App):
- Product Name: `Context`
- Team: Your Apple Developer account
- Organization Identifier: `com.nicknorris`
- Interface: SwiftUI
- Language: Swift
- Minimum Deployment: macOS 14.0

**Step 2: Add Swift Package dependencies**

In Xcode: File > Add Package Dependencies

Add these two packages:
- `https://github.com/groue/GRDB.swift.git` — branch: `master` or latest release (v7.x)
- `https://github.com/migueldeicaza/SwiftTerm.git` — from version `1.0.0`

**Step 3: Verify the app builds**

```bash
cd Context
xcodebuild -scheme Context -destination 'platform=macOS' build
```

Expected: BUILD SUCCEEDED

**Step 4: Replace ContextApp.swift with minimal shell**

```swift
import SwiftUI

@main
struct ContextApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowStyle(.automatic)
        .defaultSize(width: 1400, height: 900)
    }
}

struct ContentView: View {
    var body: some View {
        HSplitView {
            Text("Terminal")
                .frame(minWidth: 400)
            Text("GUI Panel")
                .frame(minWidth: 400)
        }
    }
}
```

**Step 5: Build and run to verify split view**

```bash
xcodebuild -scheme Context -destination 'platform=macOS' build
open Context.xcodeproj  # Run from Xcode with Cmd+R
```

Expected: Window opens with "Terminal" on left, "GUI Panel" on right, draggable divider.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Xcode project with SwiftTerm and GRDB dependencies"
```

---

### Task 2: Database Schema and Record Types

**Files:**
- Create: `Context/Context/Models/Project.swift`
- Create: `Context/Context/Models/Session.swift`
- Create: `Context/Context/Models/CodebaseSnapshot.swift`
- Create: `Context/Context/Models/Note.swift`
- Create: `Context/Context/Models/Pattern.swift`
- Create: `Context/Context/Models/TaskItem.swift`
- Create: `Context/Context/Services/DatabaseService.swift`

**Step 1: Create the Project model**

```swift
// Context/Context/Models/Project.swift
import Foundation
import GRDB

struct Project: Codable, Identifiable, FetchableRecord, MutablePersistableRecord {
    var id: String // UUID string
    var name: String
    var path: String
    var claudeProject: String? // ~/.claude/projects/<key> path
    var lastOpened: Date?
    var createdAt: Date

    static let databaseTableName = "projects"

    enum Columns {
        static let id = Column(CodingKeys.id)
        static let name = Column(CodingKeys.name)
        static let path = Column(CodingKeys.path)
        static let claudeProject = Column(CodingKeys.claudeProject)
        static let lastOpened = Column(CodingKeys.lastOpened)
        static let createdAt = Column(CodingKeys.createdAt)
    }
}
```

**Step 2: Create the Session model**

```swift
// Context/Context/Models/Session.swift
import Foundation
import GRDB

struct Session: Codable, Identifiable, FetchableRecord, MutablePersistableRecord {
    var id: String // Claude's session UUID
    var projectId: String
    var slug: String?
    var startedAt: Date?
    var endedAt: Date?
    var model: String?
    var gitBranch: String?
    var summary: String?
    var messageCount: Int
    var toolUseCount: Int
    var filesChanged: String? // JSON array

    static let databaseTableName = "sessions"

    enum Columns {
        static let id = Column(CodingKeys.id)
        static let projectId = Column(CodingKeys.projectId)
        static let slug = Column(CodingKeys.slug)
        static let startedAt = Column(CodingKeys.startedAt)
        static let endedAt = Column(CodingKeys.endedAt)
        static let model = Column(CodingKeys.model)
        static let gitBranch = Column(CodingKeys.gitBranch)
        static let summary = Column(CodingKeys.summary)
        static let messageCount = Column(CodingKeys.messageCount)
        static let toolUseCount = Column(CodingKeys.toolUseCount)
        static let filesChanged = Column(CodingKeys.filesChanged)
    }

    // Convenience: decode files changed as array
    var filesChangedArray: [String] {
        guard let json = filesChanged,
              let data = json.data(using: .utf8),
              let array = try? JSONDecoder().decode([String].self, from: data)
        else { return [] }
        return array
    }
}
```

**Step 3: Create the CodebaseSnapshot model**

```swift
// Context/Context/Models/CodebaseSnapshot.swift
import Foundation
import GRDB

struct CodebaseSnapshot: Codable, Identifiable, FetchableRecord, MutablePersistableRecord {
    var id: Int64?
    var projectId: String
    var capturedAt: Date
    var fileTree: String? // JSON
    var schemaHash: String?
    var keySymbols: String? // JSON

    static let databaseTableName = "codebaseSnapshots"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
```

**Step 4: Create the Note model**

```swift
// Context/Context/Models/Note.swift
import Foundation
import GRDB

struct Note: Codable, Identifiable, FetchableRecord, MutablePersistableRecord {
    var id: Int64?
    var projectId: String
    var title: String
    var content: String
    var pinned: Bool
    var sessionId: String?
    var createdAt: Date
    var updatedAt: Date

    static let databaseTableName = "notes"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
```

**Step 5: Create the Pattern model**

```swift
// Context/Context/Models/Pattern.swift
import Foundation
import GRDB

struct Pattern: Codable, Identifiable, FetchableRecord, MutablePersistableRecord {
    var id: Int64?
    var projectId: String
    var category: String // "architecture", "naming", "schema", "workflow"
    var title: String
    var description: String
    var sourceSession: String?
    var autoDetected: Bool
    var createdAt: Date

    static let databaseTableName = "patterns"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
```

**Step 6: Create the TaskItem model**

```swift
// Context/Context/Models/TaskItem.swift
import Foundation
import GRDB

// Named TaskItem to avoid conflict with Swift's Task
struct TaskItem: Codable, Identifiable, FetchableRecord, MutablePersistableRecord {
    var id: Int64?
    var projectId: String
    var title: String
    var description: String?
    var status: String // "todo", "in_progress", "done"
    var priority: Int
    var sourceSession: String?
    var source: String // "claude" or "manual"
    var createdAt: Date
    var completedAt: Date?

    static let databaseTableName = "taskItems"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
```

**Step 7: Create DatabaseService with migrations**

```swift
// Context/Context/Services/DatabaseService.swift
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
        ).first!.appendingPathComponent("Context", isDirectory: true)

        try FileManager.default.createDirectory(
            at: appSupportURL,
            withIntermediateDirectories: true
        )

        let dbPath = appSupportURL.appendingPathComponent("context.db").path
        dbQueue = try DatabaseQueue(path: dbPath)

        try migrator.migrate(dbQueue)
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

        return migrator
    }
}
```

**Step 8: Wire DatabaseService into app startup**

Update `ContextApp.swift`:

```swift
import SwiftUI

@main
struct ContextApp: App {
    init() {
        do {
            try DatabaseService.shared.setup()
        } catch {
            fatalError("Database setup failed: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowStyle(.automatic)
        .defaultSize(width: 1400, height: 900)
    }
}
```

**Step 9: Build and verify database creates successfully**

```bash
xcodebuild -scheme Context -destination 'platform=macOS' build
```

Run the app, then verify:
```bash
ls ~/Library/Application\ Support/Context/
# Expected: context.db exists
sqlite3 ~/Library/Application\ Support/Context/context.db ".tables"
# Expected: codebaseSnapshots notesFts patterns projects sessions sessionsFts taskItems notes
```

**Step 10: Commit**

```bash
git add -A
git commit -m "feat: add database schema, GRDB models, and migration system"
```

---

## Phase 2: Claude Code Data Ingestion

### Task 3: JSONL Parser for Claude Code Sessions

**Files:**
- Create: `Context/Context/Services/SessionParser.swift`

**Step 1: Create the JSONL parser**

This service reads Claude Code's session `.jsonl` files and extracts structured data.

```swift
// Context/Context/Services/SessionParser.swift
import Foundation

struct ParsedSession {
    let sessionId: String
    let slug: String?
    let model: String?
    let gitBranch: String?
    let startedAt: Date?
    let endedAt: Date?
    let messageCount: Int
    let toolUseCount: Int
    let filesChanged: [String]
    let userMessages: [String]
    let toolNames: [String]
}

class SessionParser {

    /// Parse a Claude Code session JSONL file into structured data
    static func parse(fileURL: URL) throws -> ParsedSession? {
        let data = try Data(contentsOf: fileURL)
        guard let content = String(data: data, encoding: .utf8) else { return nil }

        let lines = content.components(separatedBy: .newlines).filter { !$0.isEmpty }
        guard !lines.isEmpty else { return nil }

        var sessionId: String?
        var slug: String?
        var model: String?
        var gitBranch: String?
        var firstTimestamp: Date?
        var lastTimestamp: Date?
        var messageCount = 0
        var toolUseCount = 0
        var filesChanged = Set<String>()
        var userMessages: [String] = []
        var toolNames: [String] = []

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        for line in lines {
            guard let lineData = line.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any]
            else { continue }

            // Extract session metadata
            if let sid = json["sessionId"] as? String {
                sessionId = sid
            }
            if let s = json["slug"] as? String {
                slug = s
            }
            if let branch = json["gitBranch"] as? String {
                gitBranch = branch
            }

            // Extract timestamp
            if let ts = json["timestamp"] as? String {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let date = formatter.date(from: ts) {
                    if firstTimestamp == nil { firstTimestamp = date }
                    lastTimestamp = date
                }
            }

            let type = json["type"] as? String

            // Count messages
            if type == "user" {
                messageCount += 1
                if let message = json["message"] as? [String: Any],
                   let content = message["content"] as? [[String: Any]] {
                    for block in content {
                        if let text = block["text"] as? String {
                            userMessages.append(text)
                        }
                    }
                }
                // Also handle content as string
                if let message = json["message"] as? [String: Any],
                   let content = message["content"] as? String {
                    userMessages.append(content)
                }
            }

            if type == "assistant" {
                messageCount += 1
                // Extract model from assistant message
                if let message = json["message"] as? [String: Any],
                   let m = message["model"] as? String {
                    model = m
                }
            }

            // Count tool uses and extract file paths
            if type == "tool_use" || type == "assistant" {
                if let message = json["message"] as? [String: Any],
                   let content = message["content"] as? [[String: Any]] {
                    for block in content {
                        if block["type"] as? String == "tool_use" {
                            toolUseCount += 1
                            let toolName = block["name"] as? String ?? ""
                            toolNames.append(toolName)

                            // Extract file paths from tool inputs
                            if let input = block["input"] as? [String: Any] {
                                if let filePath = input["file_path"] as? String {
                                    filesChanged.insert(filePath)
                                }
                                if let command = input["command"] as? String,
                                   toolName == "Bash" {
                                    // Don't track bash commands as files
                                }
                            }
                        }
                    }
                }
            }
        }

        guard let sid = sessionId else { return nil }

        return ParsedSession(
            sessionId: sid,
            slug: slug,
            model: model,
            gitBranch: gitBranch,
            startedAt: firstTimestamp,
            endedAt: lastTimestamp,
            messageCount: messageCount,
            toolUseCount: toolUseCount,
            filesChanged: Array(filesChanged),
            userMessages: userMessages,
            toolNames: toolNames
        )
    }

    /// Generate a brief summary from parsed session data
    static func generateSummary(from parsed: ParsedSession) -> String {
        var parts: [String] = []

        // Use first user message as topic (truncated)
        if let firstMessage = parsed.userMessages.first {
            let topic = String(firstMessage.prefix(200))
            parts.append(topic)
        }

        if !parsed.filesChanged.isEmpty {
            parts.append("Files: \(parsed.filesChanged.joined(separator: ", "))")
        }

        return parts.joined(separator: " | ")
    }
}
```

**Step 2: Build and verify it compiles**

```bash
xcodebuild -scheme Context -destination 'platform=macOS' build
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add JSONL session parser for Claude Code data"
```

---

### Task 4: Project Discovery Service

**Files:**
- Create: `Context/Context/Services/ProjectDiscovery.swift`

**Step 1: Create the project discovery service**

Scans `~/.claude/projects/` and `~/.claude/history.jsonl` to find all projects.

```swift
// Context/Context/Services/ProjectDiscovery.swift
import Foundation
import GRDB

class ProjectDiscovery {
    private let claudeDir: URL
    private let db: DatabaseService

    init(db: DatabaseService = .shared) {
        self.db = db
        self.claudeDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude")
    }

    /// Scan ~/.claude/projects/ to discover all projects
    func discoverProjects() throws -> [Project] {
        let projectsDir = claudeDir.appendingPathComponent("projects")
        let fm = FileManager.default

        guard fm.fileExists(atPath: projectsDir.path) else { return [] }

        let contents = try fm.contentsOfDirectory(
            at: projectsDir,
            includingPropertiesForKeys: nil
        )

        var projects: [Project] = []

        for dir in contents where dir.hasDirectoryPath {
            let dirName = dir.lastPathComponent

            // Claude Code encodes paths as dash-separated
            // e.g. "-Users-nicknorris-Documents-augment-projects-Fixed-Ops-Pro"
            let decodedPath = "/" + dirName
                .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
                .replacingOccurrences(of: "-", with: "/")

            // Try to find a better path by checking if directory exists
            let resolvedPath = resolveProjectPath(from: dirName)

            let name = resolvedPath
                .components(separatedBy: "/")
                .last ?? dirName

            let project = Project(
                id: UUID().uuidString,
                name: name,
                path: resolvedPath,
                claudeProject: dir.path,
                lastOpened: nil,
                createdAt: Date()
            )
            projects.append(project)
        }

        return projects
    }

    /// Resolve the actual file path from Claude's encoded directory name
    private func resolveProjectPath(from encoded: String) -> String {
        // Claude encodes "/Users/nick/Documents/project" as
        // "-Users-nick-Documents-project"
        // We need to reconstruct by testing path segments
        let parts = encoded.split(separator: "-").map(String.init)
        var path = ""
        let fm = FileManager.default

        for part in parts {
            let candidate = path + "/" + part
            if fm.fileExists(atPath: candidate) {
                path = candidate
            } else {
                // Try appending with hyphen (for names that had hyphens)
                let hyphenated = path + (path.hasSuffix("/") ? "" : "-") + part
                // Check if current path + "-" + part forms a valid deeper path
                if !path.isEmpty && !fm.fileExists(atPath: path + "/" + part) {
                    path = path + "-" + part
                } else {
                    path = candidate
                }
            }
        }

        return path
    }

    /// Import discovered projects into the database
    func importProjects() throws {
        let discovered = try discoverProjects()

        try db.dbQueue.write { db in
            for var project in discovered {
                // Skip if project path already exists
                let existing = try Project.filter(
                    Project.Columns.path == project.path
                ).fetchOne(db)

                if existing == nil {
                    try project.insert(db)
                }
            }
        }
    }

    /// Discover and import sessions for a given project
    func importSessions(for project: Project) throws {
        guard let claudeProjectPath = project.claudeProject else { return }
        let projectDir = URL(fileURLWithPath: claudeProjectPath)
        let fm = FileManager.default

        guard fm.fileExists(atPath: projectDir.path) else { return }

        let contents = try fm.contentsOfDirectory(
            at: projectDir,
            includingPropertiesForKeys: [.contentModificationDateKey]
        )

        let jsonlFiles = contents.filter { $0.pathExtension == "jsonl" }

        try db.dbQueue.write { db in
            for file in jsonlFiles {
                let sessionId = file.deletingPathExtension().lastPathComponent

                // Skip if already imported
                if try Session.fetchOne(db, key: sessionId) != nil {
                    continue
                }

                // Parse the session file
                guard let parsed = try SessionParser.parse(fileURL: file) else {
                    continue
                }

                let filesChangedJSON = try? JSONEncoder().encode(parsed.filesChanged)
                let filesChangedString = filesChangedJSON.flatMap {
                    String(data: $0, encoding: .utf8)
                }

                var session = Session(
                    id: parsed.sessionId,
                    projectId: project.id,
                    slug: parsed.slug,
                    startedAt: parsed.startedAt,
                    endedAt: parsed.endedAt,
                    model: parsed.model,
                    gitBranch: parsed.gitBranch,
                    summary: SessionParser.generateSummary(from: parsed),
                    messageCount: parsed.messageCount,
                    toolUseCount: parsed.toolUseCount,
                    filesChanged: filesChangedString
                )

                try session.insert(db)
            }
        }
    }
}
```

**Step 2: Build and verify**

```bash
xcodebuild -scheme Context -destination 'platform=macOS' build
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add project and session discovery from Claude Code data"
```

---

### Task 5: File Watcher Service

**Files:**
- Create: `Context/Context/Services/FileWatcher.swift`

**Step 1: Create FSEvents-based file watcher**

```swift
// Context/Context/Services/FileWatcher.swift
import Foundation

class FileWatcher {
    typealias Callback = ([String]) -> Void

    private var stream: FSEventStreamRef?
    private let paths: [String]
    private let callback: Callback
    private let debounceInterval: TimeInterval

    private var debounceTimer: Timer?
    private var pendingPaths: Set<String> = []

    init(paths: [String], debounceInterval: TimeInterval = 2.0, callback: @escaping Callback) {
        self.paths = paths
        self.debounceInterval = debounceInterval
        self.callback = callback
    }

    func start() {
        let pathsToWatch = paths as CFArray

        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )

        let flags = UInt32(
            kFSEventStreamCreateFlagUseCFTypes |
            kFSEventStreamCreateFlagFileEvents |
            kFSEventStreamCreateFlagNoDefer
        )

        guard let stream = FSEventStreamCreate(
            nil,
            { (_, info, numEvents, eventPaths, _, _) in
                guard let info = info else { return }
                let watcher = Unmanaged<FileWatcher>.fromOpaque(info).takeUnretainedValue()
                let paths = Unmanaged<CFArray>.fromOpaque(eventPaths).takeUnretainedValue() as! [String]
                watcher.handleEvents(paths: paths)
            },
            &context,
            pathsToWatch,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            1.0, // latency in seconds
            flags
        ) else { return }

        self.stream = stream
        FSEventStreamScheduleWithRunLoop(stream, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
        FSEventStreamStart(stream)
    }

    func stop() {
        guard let stream = stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    private func handleEvents(paths: [String]) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.pendingPaths.formUnion(paths)
            self.debounceTimer?.invalidate()
            self.debounceTimer = Timer.scheduledTimer(
                withTimeInterval: self.debounceInterval,
                repeats: false
            ) { [weak self] _ in
                guard let self = self else { return }
                let paths = Array(self.pendingPaths)
                self.pendingPaths.removeAll()
                self.callback(paths)
            }
        }
    }

    deinit {
        stop()
    }
}
```

**Step 2: Build and verify**

```bash
xcodebuild -scheme Context -destination 'platform=macOS' build
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add FSEvents file watcher with debounce support"
```

---

## Phase 3: Terminal Integration

### Task 6: SwiftTerm Terminal Wrapper

**Files:**
- Create: `Context/Context/Terminal/TerminalWrapper.swift`
- Create: `Context/Context/Terminal/TerminalHostView.swift`

**Step 1: Create the AppKit terminal wrapper**

SwiftTerm's `LocalProcessTerminalView` is an NSView. We need to wrap it for SwiftUI using `NSViewRepresentable`.

```swift
// Context/Context/Terminal/TerminalWrapper.swift
import SwiftUI
import SwiftTerm
import AppKit

/// Wraps SwiftTerm's LocalProcessTerminalView for use in SwiftUI
struct TerminalWrapper: NSViewRepresentable {
    let initialDirectory: String
    @Binding var sendCommand: String?

    class Coordinator: NSObject, LocalProcessTerminalViewDelegate {
        var parent: TerminalWrapper
        var terminalView: LocalProcessTerminalView?

        init(_ parent: TerminalWrapper) {
            self.parent = parent
        }

        func processTerminated(_ source: TerminalView, exitCode: Int32?) {
            // Process ended — could restart shell or notify
            DispatchQueue.main.async {
                self.startShell()
            }
        }

        func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {
            // Terminal resized
        }

        func setTerminalTitle(source: LocalProcessTerminalView, title: String) {
            // Could update window title
        }

        func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {
            // Terminal directory changed
        }

        func startShell(in directory: String? = nil) {
            guard let terminal = terminalView else { return }
            let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
            let dir = directory ?? parent.initialDirectory
            terminal.startProcess(
                executable: shell,
                args: [shell, "--login"],
                environment: nil,
                execName: nil
            )
        }

        func sendText(_ text: String) {
            terminalView?.send(txt: text)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> LocalProcessTerminalView {
        let terminal = LocalProcessTerminalView(frame: NSRect(x: 0, y: 0, width: 800, height: 600))

        // Configure appearance
        let fontSize: CGFloat = 13
        terminal.font = NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        terminal.nativeForegroundColor = .textColor
        terminal.nativeBackgroundColor = .textBackgroundColor

        terminal.processDelegate = context.coordinator
        context.coordinator.terminalView = terminal

        // Start shell in project directory
        context.coordinator.startShell(in: initialDirectory)

        return terminal
    }

    func updateNSView(_ nsView: LocalProcessTerminalView, context: Context) {
        // Handle command sending from GUI
        if let command = sendCommand {
            DispatchQueue.main.async {
                context.coordinator.sendText(command + "\n")
                self.sendCommand = nil
            }
        }
    }
}
```

**Step 2: Build and verify**

```bash
xcodebuild -scheme Context -destination 'platform=macOS' build
```

Note: The exact `LocalProcessTerminalView` API may need adjustment based on SwiftTerm's current version. Check the actual delegate protocol methods against the library source if there are compile errors.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add SwiftTerm terminal wrapper with NSViewRepresentable bridge"
```

---

### Task 7: Terminal Tab Management

**Files:**
- Create: `Context/Context/Terminal/TerminalTabView.swift`
- Create: `Context/Context/Terminal/TerminalTab.swift`

**Step 1: Create the terminal tab model**

```swift
// Context/Context/Terminal/TerminalTab.swift
import Foundation

class TerminalTab: Identifiable, ObservableObject {
    let id = UUID()
    @Published var title: String
    let initialDirectory: String

    init(title: String = "Terminal", initialDirectory: String) {
        self.title = title
        self.initialDirectory = initialDirectory
    }
}
```

**Step 2: Create the tabbed terminal view**

```swift
// Context/Context/Terminal/TerminalTabView.swift
import SwiftUI

struct TerminalTabView: View {
    @Binding var projectPath: String
    @State private var tabs: [TerminalTab] = []
    @State private var selectedTabId: UUID?
    @State private var commandToSend: String?

    var body: some View {
        VStack(spacing: 0) {
            // Tab bar
            HStack(spacing: 0) {
                ForEach(tabs) { tab in
                    TerminalTabButton(
                        tab: tab,
                        isSelected: selectedTabId == tab.id,
                        onSelect: { selectedTabId = tab.id },
                        onClose: { closeTab(tab) }
                    )
                }

                Button(action: addTab) {
                    Image(systemName: "plus")
                        .font(.system(size: 12))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.plain)

                Spacer()
            }
            .padding(.horizontal, 4)
            .padding(.top, 4)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            // Terminal content
            if let selectedId = selectedTabId,
               let tab = tabs.first(where: { $0.id == selectedId }) {
                TerminalWrapper(
                    initialDirectory: tab.initialDirectory,
                    sendCommand: $commandToSend
                )
            } else {
                Text("No terminal open")
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear {
            if tabs.isEmpty {
                addTab()
            }
        }
        .onChange(of: projectPath) { _, newPath in
            // When project switches, cd in the active terminal
            commandToSend = "cd \"\(newPath)\""
        }
    }

    private func addTab() {
        let tab = TerminalTab(
            title: "Terminal \(tabs.count + 1)",
            initialDirectory: projectPath
        )
        tabs.append(tab)
        selectedTabId = tab.id
    }

    private func closeTab(_ tab: TerminalTab) {
        tabs.removeAll { $0.id == tab.id }
        if selectedTabId == tab.id {
            selectedTabId = tabs.last?.id
        }
    }
}

struct TerminalTabButton: View {
    @ObservedObject var tab: TerminalTab
    let isSelected: Bool
    let onSelect: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Text(tab.title)
                .font(.system(size: 11))
                .lineLimit(1)

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 8))
            }
            .buttonStyle(.plain)
            .opacity(isSelected ? 1 : 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(isSelected ? Color(nsColor: .textBackgroundColor) : Color.clear)
        .cornerRadius(4)
        .onTapGesture(perform: onSelect)
    }
}
```

**Step 3: Build and verify**

```bash
xcodebuild -scheme Context -destination 'platform=macOS' build
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add terminal tab management with project directory sync"
```

---

## Phase 4: GUI Shell & Navigation

### Task 8: Main Split View and Navigation

**Files:**
- Modify: `Context/Context/ContextApp.swift`
- Create: `Context/Context/Views/MainSplitView.swift`
- Create: `Context/Context/Views/GUIPanelView.swift`
- Create: `Context/Context/ViewModels/AppState.swift`

**Step 1: Create the shared app state**

```swift
// Context/Context/ViewModels/AppState.swift
import Foundation
import GRDB
import Combine

@MainActor
class AppState: ObservableObject {
    @Published var currentProject: Project?
    @Published var projects: [Project] = []
    @Published var selectedTab: GUITab = .dashboard

    enum GUITab: String, CaseIterable {
        case dashboard = "Dashboard"
        case sessions = "Sessions"
        case tasks = "Tasks"
        case notes = "Notes"
        case memory = "Memory"

        var icon: String {
            switch self {
            case .dashboard: return "house"
            case .sessions: return "clock"
            case .tasks: return "checklist"
            case .notes: return "note.text"
            case .memory: return "brain"
            }
        }
    }

    func loadProjects() {
        do {
            let discovery = ProjectDiscovery()
            try discovery.importProjects()

            projects = try DatabaseService.shared.dbQueue.read { db in
                try Project.order(Project.Columns.lastOpened.desc).fetchAll(db)
            }
        } catch {
            print("Failed to load projects: \(error)")
        }
    }

    func selectProject(_ project: Project) {
        currentProject = project

        // Update lastOpened
        do {
            try DatabaseService.shared.dbQueue.write { db in
                var updated = project
                updated.lastOpened = Date()
                try updated.update(db)
            }
        } catch {
            print("Failed to update project: \(error)")
        }

        // Import sessions for this project
        do {
            let discovery = ProjectDiscovery()
            try discovery.importSessions(for: project)
        } catch {
            print("Failed to import sessions: \(error)")
        }
    }
}
```

**Step 2: Create the main split view**

```swift
// Context/Context/Views/MainSplitView.swift
import SwiftUI

struct MainSplitView: View {
    @EnvironmentObject var appState: AppState
    @State private var projectPath: String = ""

    var body: some View {
        HSplitView {
            // Left: Terminal
            TerminalTabView(projectPath: $projectPath)
                .frame(minWidth: 400, idealWidth: 700)

            // Right: GUI
            GUIPanelView()
                .frame(minWidth: 400, idealWidth: 700)
        }
        .onChange(of: appState.currentProject) { _, project in
            if let project = project {
                projectPath = project.path
            }
        }
    }
}
```

**Step 3: Create the GUI panel with tab navigation**

```swift
// Context/Context/Views/GUIPanelView.swift
import SwiftUI

struct GUIPanelView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            // Project header + tab bar
            VStack(spacing: 0) {
                // Project selector
                HStack {
                    if let project = appState.currentProject {
                        Image(systemName: "folder.fill")
                            .foregroundColor(.accentColor)
                        Text(project.name)
                            .font(.headline)
                        Text(project.path)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    } else {
                        Text("No project selected")
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    // Project picker
                    Menu {
                        ForEach(appState.projects) { project in
                            Button(project.name) {
                                appState.selectProject(project)
                            }
                        }
                    } label: {
                        Image(systemName: "chevron.down.circle")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)

                // Tab bar
                HStack(spacing: 0) {
                    ForEach(AppState.GUITab.allCases, id: \.self) { tab in
                        TabButton(
                            tab: tab,
                            isSelected: appState.selectedTab == tab
                        ) {
                            appState.selectedTab = tab
                        }
                    }
                    Spacer()
                }
                .padding(.horizontal, 8)

                Divider()
            }
            .background(Color(nsColor: .windowBackgroundColor))

            // Tab content
            Group {
                switch appState.selectedTab {
                case .dashboard:
                    DashboardPlaceholder()
                case .sessions:
                    SessionsPlaceholder()
                case .tasks:
                    TasksPlaceholder()
                case .notes:
                    NotesPlaceholder()
                case .memory:
                    MemoryPlaceholder()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct TabButton: View {
    let tab: AppState.GUITab
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: tab.icon)
                    .font(.system(size: 12))
                Text(tab.rawValue)
                    .font(.system(size: 12))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isSelected ? Color.accentColor.opacity(0.15) : Color.clear)
            .foregroundColor(isSelected ? .accentColor : .secondary)
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
    }
}

// Placeholder views for each tab — replaced in subsequent tasks
struct DashboardPlaceholder: View {
    var body: some View { Text("Dashboard").foregroundColor(.secondary) }
}
struct SessionsPlaceholder: View {
    var body: some View { Text("Sessions").foregroundColor(.secondary) }
}
struct TasksPlaceholder: View {
    var body: some View { Text("Tasks").foregroundColor(.secondary) }
}
struct NotesPlaceholder: View {
    var body: some View { Text("Notes").foregroundColor(.secondary) }
}
struct MemoryPlaceholder: View {
    var body: some View { Text("Memory").foregroundColor(.secondary) }
}
```

**Step 4: Update ContextApp.swift to wire everything together**

```swift
// Context/Context/ContextApp.swift
import SwiftUI

@main
struct ContextApp: App {
    @StateObject private var appState = AppState()

    init() {
        do {
            try DatabaseService.shared.setup()
        } catch {
            fatalError("Database setup failed: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            MainSplitView()
                .environmentObject(appState)
                .onAppear {
                    appState.loadProjects()
                }
        }
        .windowStyle(.automatic)
        .defaultSize(width: 1400, height: 900)
    }
}
```

**Step 5: Build, run, and verify the shell works**

```bash
xcodebuild -scheme Context -destination 'platform=macOS' build
```

Expected: App launches with terminal on left, tabbed GUI on right. Project picker shows discovered projects. Tabs switch between placeholder views.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add main split view, tab navigation, project switching, and app state"
```

---

## Phase 5: GUI Views

### Task 9: Dashboard View

**Files:**
- Create: `Context/Context/Views/Dashboard/DashboardView.swift`
- Modify: `Context/Context/Views/GUIPanelView.swift` (replace placeholder)

**Step 1: Create the dashboard view**

```swift
// Context/Context/Views/Dashboard/DashboardView.swift
import SwiftUI
import GRDB

struct DashboardView: View {
    @EnvironmentObject var appState: AppState
    @State private var recentSessions: [Session] = []
    @State private var pendingTaskCount: Int = 0
    @State private var inProgressTaskCount: Int = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Quick actions
                HStack(spacing: 12) {
                    ActionButton(
                        title: "New Claude Session",
                        icon: "terminal",
                        action: { /* Send `claude` to terminal */ }
                    )
                    ActionButton(
                        title: "Continue Last Session",
                        icon: "arrow.uturn.forward",
                        action: {
                            if let last = recentSessions.first {
                                // Send `claude --resume <id>` to terminal
                            }
                        }
                    )
                    ActionButton(
                        title: "Open in Finder",
                        icon: "folder",
                        action: {
                            if let path = appState.currentProject?.path {
                                NSWorkspace.shared.open(URL(fileURLWithPath: path))
                            }
                        }
                    )
                }

                Divider()

                // Stats
                HStack(spacing: 24) {
                    StatCard(label: "Sessions", value: "\(recentSessions.count)", icon: "clock")
                    StatCard(label: "Pending Tasks", value: "\(pendingTaskCount)", icon: "circle")
                    StatCard(label: "In Progress", value: "\(inProgressTaskCount)", icon: "arrow.right.circle")
                }

                Divider()

                // Recent sessions
                Text("Recent Sessions")
                    .font(.headline)

                if recentSessions.isEmpty {
                    Text("No sessions found for this project.")
                        .foregroundColor(.secondary)
                        .padding()
                } else {
                    ForEach(recentSessions) { session in
                        SessionCard(session: session)
                    }
                }
            }
            .padding(20)
        }
        .onAppear(perform: loadData)
        .onChange(of: appState.currentProject) { _, _ in loadData() }
    }

    private func loadData() {
        guard let project = appState.currentProject else { return }

        do {
            recentSessions = try DatabaseService.shared.dbQueue.read { db in
                try Session
                    .filter(Session.Columns.projectId == project.id)
                    .order(Session.Columns.startedAt.desc)
                    .limit(10)
                    .fetchAll(db)
            }

            let counts = try DatabaseService.shared.dbQueue.read { db -> (Int, Int) in
                let pending = try TaskItem
                    .filter(Column("projectId") == project.id && Column("status") == "todo")
                    .fetchCount(db)
                let inProgress = try TaskItem
                    .filter(Column("projectId") == project.id && Column("status") == "in_progress")
                    .fetchCount(db)
                return (pending, inProgress)
            }
            pendingTaskCount = counts.0
            inProgressTaskCount = counts.1
        } catch {
            print("Failed to load dashboard data: \(error)")
        }
    }
}

struct ActionButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                Text(title)
                    .font(.system(size: 12))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color.accentColor.opacity(0.1))
            .foregroundColor(.accentColor)
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
}

struct StatCard: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundColor(.accentColor)
            Text(value)
                .font(.title2.bold())
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(width: 100)
        .padding()
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }
}

struct SessionCard: View {
    let session: Session

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(session.slug ?? session.id.prefix(8).description)
                    .font(.headline)
                Spacer()
                if let date = session.startedAt {
                    Text(date, style: .relative)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            HStack(spacing: 12) {
                if let branch = session.gitBranch {
                    Label(branch, systemImage: "arrow.triangle.branch")
                        .font(.caption)
                }
                Label("\(session.messageCount) messages", systemImage: "message")
                    .font(.caption)
                Label("\(session.toolUseCount) tools", systemImage: "wrench")
                    .font(.caption)
                if let model = session.model {
                    Label(model.replacingOccurrences(of: "claude-", with: ""),
                          systemImage: "cpu")
                        .font(.caption)
                }
            }
            .foregroundColor(.secondary)

            if let summary = session.summary, !summary.isEmpty {
                Text(summary)
                    .font(.caption)
                    .lineLimit(2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(12)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }
}
```

**Step 2: Replace the placeholder in GUIPanelView.swift**

Change `DashboardPlaceholder()` to `DashboardView()` in the switch statement.

**Step 3: Build, run, verify**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add dashboard view with recent sessions, stats, and quick actions"
```

---

### Task 10: Sessions List and Detail View

**Files:**
- Create: `Context/Context/Views/Sessions/SessionListView.swift`
- Create: `Context/Context/Views/Sessions/SessionDetailView.swift`

**Step 1: Create the sessions list view**

```swift
// Context/Context/Views/Sessions/SessionListView.swift
import SwiftUI
import GRDB

struct SessionListView: View {
    @EnvironmentObject var appState: AppState
    @State private var sessions: [Session] = []
    @State private var selectedSession: Session?
    @State private var searchText: String = ""

    var body: some View {
        HSplitView {
            // Session list
            VStack(spacing: 0) {
                // Search bar
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(.secondary)
                    TextField("Search sessions...", text: $searchText)
                        .textFieldStyle(.plain)
                        .onSubmit { search() }
                }
                .padding(8)
                .background(Color(nsColor: .controlBackgroundColor))

                Divider()

                // List
                List(sessions, selection: $selectedSession) { session in
                    SessionRow(session: session)
                        .tag(session)
                        .onTapGesture {
                            selectedSession = session
                        }
                }
                .listStyle(.plain)
            }
            .frame(minWidth: 250, idealWidth: 300)

            // Detail
            if let session = selectedSession {
                SessionDetailView(session: session)
            } else {
                Text("Select a session")
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear(perform: loadSessions)
        .onChange(of: appState.currentProject) { _, _ in loadSessions() }
    }

    private func loadSessions() {
        guard let project = appState.currentProject else { return }
        do {
            sessions = try DatabaseService.shared.dbQueue.read { db in
                try Session
                    .filter(Session.Columns.projectId == project.id)
                    .order(Session.Columns.startedAt.desc)
                    .fetchAll(db)
            }
        } catch {
            print("Failed to load sessions: \(error)")
        }
    }

    private func search() {
        guard let project = appState.currentProject, !searchText.isEmpty else {
            loadSessions()
            return
        }
        do {
            sessions = try DatabaseService.shared.dbQueue.read { db in
                let pattern = FTS5Pattern(matchingAnyTokenIn: searchText)
                return try Session
                    .joining(required: Session.hasOne(
                        // FTS search through sessionsFts
                        Table("sessionsFts"),
                        on: { sessionsFts in sessionsFts[Column("rowid")] == Session.Columns.id }
                    ))
                    .fetchAll(db)
                // Fallback: simple LIKE search if FTS doesn't work initially
            }
        } catch {
            // Fallback to LIKE search
            do {
                sessions = try DatabaseService.shared.dbQueue.read { db in
                    try Session
                        .filter(Session.Columns.projectId == project.id)
                        .filter(Session.Columns.summary.like("%\(searchText)%"))
                        .order(Session.Columns.startedAt.desc)
                        .fetchAll(db)
                }
            } catch {
                print("Search failed: \(error)")
            }
        }
    }
}

struct SessionRow: View {
    let session: Session

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(session.slug ?? String(session.id.prefix(8)))
                    .font(.system(size: 12, weight: .medium))
                Spacer()
                if let date = session.startedAt {
                    Text(date, style: .date)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
            }
            HStack(spacing: 8) {
                Text("\(session.messageCount) msgs")
                Text("\(session.toolUseCount) tools")
                if let branch = session.gitBranch {
                    Text(branch)
                }
            }
            .font(.system(size: 10))
            .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}
```

**Step 2: Create the session detail view**

```swift
// Context/Context/Views/Sessions/SessionDetailView.swift
import SwiftUI

struct SessionDetailView: View {
    let session: Session

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                VStack(alignment: .leading, spacing: 8) {
                    Text(session.slug ?? session.id)
                        .font(.title2.bold())

                    HStack(spacing: 16) {
                        if let date = session.startedAt {
                            Label(date.formatted(), systemImage: "clock")
                        }
                        if let branch = session.gitBranch {
                            Label(branch, systemImage: "arrow.triangle.branch")
                        }
                        if let model = session.model {
                            Label(model, systemImage: "cpu")
                        }
                    }
                    .font(.caption)
                    .foregroundColor(.secondary)

                    HStack(spacing: 16) {
                        Text("\(session.messageCount) messages")
                        Text("\(session.toolUseCount) tool uses")
                        Text("\(session.filesChangedArray.count) files changed")
                    }
                    .font(.subheadline)
                }

                Divider()

                // Summary
                if let summary = session.summary, !summary.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Summary")
                            .font(.headline)
                        Text(summary)
                            .font(.body)
                    }
                }

                // Files changed
                if !session.filesChangedArray.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Files Changed")
                            .font(.headline)
                        ForEach(session.filesChangedArray, id: \.self) { file in
                            HStack {
                                Image(systemName: "doc")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                Text(file)
                                    .font(.system(size: 12, design: .monospaced))
                            }
                        }
                    }
                }

                Divider()

                // Resume button
                Button("Resume This Session") {
                    // Send `claude --resume <session.id>` to terminal
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(20)
        }
    }
}
```

**Step 3: Replace placeholder in GUIPanelView, build, verify**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add sessions list with search and detail view"
```

---

### Task 11: Kanban Task Board

**Files:**
- Create: `Context/Context/Views/Tasks/KanbanBoard.swift`
- Create: `Context/Context/Views/Tasks/TaskCard.swift`

**Step 1: Create the task card**

```swift
// Context/Context/Views/Tasks/TaskCard.swift
import SwiftUI

struct TaskCardView: View {
    let task: TaskItem
    let onStatusChange: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(task.title)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(2)
                Spacer()
            }

            if let desc = task.description, !desc.isEmpty {
                Text(desc)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .lineLimit(3)
            }

            HStack {
                // Source badge
                Text(task.source)
                    .font(.system(size: 9, weight: .medium))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(task.source == "claude" ? Color.blue.opacity(0.2) : Color.gray.opacity(0.2))
                    .foregroundColor(task.source == "claude" ? .blue : .secondary)
                    .cornerRadius(4)

                Spacer()

                Text(task.createdAt, style: .date)
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
            }
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
        .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
    }
}
```

**Step 2: Create the kanban board**

```swift
// Context/Context/Views/Tasks/KanbanBoard.swift
import SwiftUI
import GRDB

struct KanbanBoard: View {
    @EnvironmentObject var appState: AppState
    @State private var todoTasks: [TaskItem] = []
    @State private var inProgressTasks: [TaskItem] = []
    @State private var doneTasks: [TaskItem] = []
    @State private var showingNewTask = false
    @State private var newTaskTitle = ""

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack {
                Text("Task Board")
                    .font(.headline)
                Spacer()
                Button(action: { showingNewTask = true }) {
                    Label("New Task", systemImage: "plus")
                        .font(.system(size: 12))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            Divider()

            // Columns
            HStack(alignment: .top, spacing: 12) {
                KanbanColumn(
                    title: "Todo",
                    tasks: todoTasks,
                    color: .gray,
                    onMove: { task in moveTask(task, to: "in_progress") }
                )
                KanbanColumn(
                    title: "In Progress",
                    tasks: inProgressTasks,
                    color: .blue,
                    onMove: { task in moveTask(task, to: "done") }
                )
                KanbanColumn(
                    title: "Done",
                    tasks: doneTasks,
                    color: .green,
                    onMove: nil
                )
            }
            .padding(12)
        }
        .onAppear(perform: loadTasks)
        .onChange(of: appState.currentProject) { _, _ in loadTasks() }
        .sheet(isPresented: $showingNewTask) {
            NewTaskSheet(
                title: $newTaskTitle,
                onSave: { createTask() },
                onCancel: { showingNewTask = false }
            )
        }
    }

    private func loadTasks() {
        guard let project = appState.currentProject else { return }
        do {
            try DatabaseService.shared.dbQueue.read { db in
                todoTasks = try TaskItem
                    .filter(Column("projectId") == project.id && Column("status") == "todo")
                    .order(Column("priority").desc, Column("createdAt").desc)
                    .fetchAll(db)
                inProgressTasks = try TaskItem
                    .filter(Column("projectId") == project.id && Column("status") == "in_progress")
                    .order(Column("createdAt").desc)
                    .fetchAll(db)
                doneTasks = try TaskItem
                    .filter(Column("projectId") == project.id && Column("status") == "done")
                    .order(Column("completedAt").desc)
                    .limit(20)
                    .fetchAll(db)
            }
        } catch {
            print("Failed to load tasks: \(error)")
        }
    }

    private func moveTask(_ task: TaskItem, to status: String) {
        do {
            try DatabaseService.shared.dbQueue.write { db in
                var updated = task
                updated.status = status
                if status == "done" {
                    updated.completedAt = Date()
                }
                try updated.update(db)
            }
            loadTasks()
        } catch {
            print("Failed to move task: \(error)")
        }
    }

    private func createTask() {
        guard let project = appState.currentProject, !newTaskTitle.isEmpty else { return }
        do {
            try DatabaseService.shared.dbQueue.write { db in
                var task = TaskItem(
                    projectId: project.id,
                    title: newTaskTitle,
                    status: "todo",
                    priority: 0,
                    source: "manual",
                    createdAt: Date()
                )
                try task.insert(db)
            }
            newTaskTitle = ""
            showingNewTask = false
            loadTasks()
        } catch {
            print("Failed to create task: \(error)")
        }
    }
}

struct KanbanColumn: View {
    let title: String
    let tasks: [TaskItem]
    let color: Color
    let onMove: ((TaskItem) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                Text("\(tasks.count)")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }

            ScrollView {
                LazyVStack(spacing: 6) {
                    ForEach(tasks) { task in
                        TaskCardView(task: task) { newStatus in
                            // Handle inline status change if needed
                        }
                        .contextMenu {
                            if let onMove = onMove {
                                Button("Move Forward") {
                                    onMove(task)
                                }
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(8)
        .background(Color(nsColor: .windowBackgroundColor).opacity(0.5))
        .cornerRadius(8)
    }
}

struct NewTaskSheet: View {
    @Binding var title: String
    let onSave: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("New Task")
                .font(.headline)
            TextField("Task title", text: $title)
                .textFieldStyle(.roundedBorder)
            HStack {
                Button("Cancel", action: onCancel)
                Button("Create", action: onSave)
                    .buttonStyle(.borderedProminent)
                    .disabled(title.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 300)
    }
}
```

**Step 3: Replace placeholder in GUIPanelView, build, verify**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add kanban task board with drag-forward and manual task creation"
```

---

### Task 12: Notes View

**Files:**
- Create: `Context/Context/Views/Notes/NoteListView.swift`
- Create: `Context/Context/Views/Notes/NoteEditorView.swift`

**Step 1: Create the notes list and editor**

```swift
// Context/Context/Views/Notes/NoteListView.swift
import SwiftUI
import GRDB

struct NoteListView: View {
    @EnvironmentObject var appState: AppState
    @State private var notes: [Note] = []
    @State private var selectedNote: Note?

    var body: some View {
        HSplitView {
            // Note list sidebar
            VStack(spacing: 0) {
                HStack {
                    Text("Notes")
                        .font(.headline)
                    Spacer()
                    Button(action: createNote) {
                        Image(systemName: "plus")
                    }
                }
                .padding(8)

                Divider()

                List(sortedNotes, selection: $selectedNote) { note in
                    NoteRow(note: note)
                        .tag(note)
                        .onTapGesture { selectedNote = note }
                }
                .listStyle(.plain)
            }
            .frame(minWidth: 200, idealWidth: 250)

            // Editor
            if let note = selectedNote {
                NoteEditorView(
                    note: note,
                    onSave: { updated in saveNote(updated) },
                    onDelete: { deleteNote(note) },
                    onTogglePin: { togglePin(note) }
                )
            } else {
                Text("Select or create a note")
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear(perform: loadNotes)
        .onChange(of: appState.currentProject) { _, _ in loadNotes() }
    }

    private var sortedNotes: [Note] {
        notes.sorted { a, b in
            if a.pinned != b.pinned { return a.pinned }
            return a.updatedAt > b.updatedAt
        }
    }

    private func loadNotes() {
        guard let project = appState.currentProject else { return }
        do {
            notes = try DatabaseService.shared.dbQueue.read { db in
                try Note
                    .filter(Column("projectId") == project.id)
                    .order(Column("pinned").desc, Column("updatedAt").desc)
                    .fetchAll(db)
            }
        } catch {
            print("Failed to load notes: \(error)")
        }
    }

    private func createNote() {
        guard let project = appState.currentProject else { return }
        do {
            var note = Note(
                projectId: project.id,
                title: "Untitled Note",
                content: "",
                pinned: false,
                createdAt: Date(),
                updatedAt: Date()
            )
            try DatabaseService.shared.dbQueue.write { db in
                try note.insert(db)
            }
            loadNotes()
            selectedNote = notes.first
        } catch {
            print("Failed to create note: \(error)")
        }
    }

    private func saveNote(_ note: Note) {
        do {
            try DatabaseService.shared.dbQueue.write { db in
                var updated = note
                updated.updatedAt = Date()
                try updated.update(db)
            }
            loadNotes()
        } catch {
            print("Failed to save note: \(error)")
        }
    }

    private func deleteNote(_ note: Note) {
        do {
            _ = try DatabaseService.shared.dbQueue.write { db in
                try note.delete(db)
            }
            selectedNote = nil
            loadNotes()
        } catch {
            print("Failed to delete note: \(error)")
        }
    }

    private func togglePin(_ note: Note) {
        var updated = note
        updated.pinned.toggle()
        saveNote(updated)
    }
}

struct NoteRow: View {
    let note: Note

    var body: some View {
        HStack {
            if note.pinned {
                Image(systemName: "pin.fill")
                    .font(.system(size: 10))
                    .foregroundColor(.orange)
            }
            VStack(alignment: .leading) {
                Text(note.title)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                Text(note.updatedAt, style: .relative)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
```

```swift
// Context/Context/Views/Notes/NoteEditorView.swift
import SwiftUI

struct NoteEditorView: View {
    @State private var title: String
    @State private var content: String
    let note: Note
    let onSave: (Note) -> Void
    let onDelete: () -> Void
    let onTogglePin: () -> Void

    init(note: Note, onSave: @escaping (Note) -> Void,
         onDelete: @escaping () -> Void, onTogglePin: @escaping () -> Void) {
        self.note = note
        self._title = State(initialValue: note.title)
        self._content = State(initialValue: note.content)
        self.onSave = onSave
        self.onDelete = onDelete
        self.onTogglePin = onTogglePin
    }

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack {
                TextField("Title", text: $title)
                    .textFieldStyle(.plain)
                    .font(.title3.bold())

                Spacer()

                Button(action: onTogglePin) {
                    Image(systemName: note.pinned ? "pin.fill" : "pin")
                }
                .buttonStyle(.plain)

                Button(action: save) {
                    Text("Save")
                        .font(.system(size: 12))
                }
                .buttonStyle(.borderedProminent)

                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .foregroundColor(.red)
                }
                .buttonStyle(.plain)
            }
            .padding(12)

            Divider()

            // Editor
            TextEditor(text: $content)
                .font(.system(size: 13, design: .monospaced))
                .padding(8)
        }
        .onChange(of: note.id) { _, _ in
            title = note.title
            content = note.content
        }
    }

    private func save() {
        var updated = note
        updated.title = title
        updated.content = content
        onSave(updated)
    }
}
```

**Step 2: Replace placeholder in GUIPanelView, build, verify**

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add notes view with markdown editor, pinning, and CRUD"
```

---

### Task 13: Memory/Pattern Inspector View

**Files:**
- Create: `Context/Context/Views/Memory/PatternListView.swift`

**Step 1: Create the pattern inspector**

```swift
// Context/Context/Views/Memory/PatternListView.swift
import SwiftUI
import GRDB

struct PatternListView: View {
    @EnvironmentObject var appState: AppState
    @State private var patterns: [Pattern] = []
    @State private var selectedCategory: String? = nil
    @State private var showingNewPattern = false

    let categories = ["architecture", "naming", "schema", "workflow"]

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Patterns & Conventions")
                    .font(.headline)
                Spacer()
                Button(action: { showingNewPattern = true }) {
                    Label("Add Pattern", systemImage: "plus")
                        .font(.system(size: 12))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            // Category filter
            HStack(spacing: 8) {
                CategoryPill(name: "All", isSelected: selectedCategory == nil) {
                    selectedCategory = nil
                }
                ForEach(categories, id: \.self) { cat in
                    CategoryPill(
                        name: cat.capitalized,
                        isSelected: selectedCategory == cat
                    ) {
                        selectedCategory = cat
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            Divider()

            // Pattern list
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(filteredPatterns) { pattern in
                        PatternCard(
                            pattern: pattern,
                            onDelete: { deletePattern(pattern) }
                        )
                    }
                }
                .padding(16)
            }
        }
        .onAppear(perform: loadPatterns)
        .onChange(of: appState.currentProject) { _, _ in loadPatterns() }
        .sheet(isPresented: $showingNewPattern) {
            NewPatternSheet(
                categories: categories,
                onSave: { title, description, category in
                    createPattern(title: title, description: description, category: category)
                },
                onCancel: { showingNewPattern = false }
            )
        }
    }

    private var filteredPatterns: [Pattern] {
        if let cat = selectedCategory {
            return patterns.filter { $0.category == cat }
        }
        return patterns
    }

    private func loadPatterns() {
        guard let project = appState.currentProject else { return }
        do {
            patterns = try DatabaseService.shared.dbQueue.read { db in
                try Pattern
                    .filter(Column("projectId") == project.id)
                    .order(Column("category"), Column("createdAt").desc)
                    .fetchAll(db)
            }
        } catch {
            print("Failed to load patterns: \(error)")
        }
    }

    private func createPattern(title: String, description: String, category: String) {
        guard let project = appState.currentProject else { return }
        do {
            try DatabaseService.shared.dbQueue.write { db in
                var pattern = Pattern(
                    projectId: project.id,
                    category: category,
                    title: title,
                    description: description,
                    autoDetected: false,
                    createdAt: Date()
                )
                try pattern.insert(db)
            }
            showingNewPattern = false
            loadPatterns()
        } catch {
            print("Failed to create pattern: \(error)")
        }
    }

    private func deletePattern(_ pattern: Pattern) {
        do {
            _ = try DatabaseService.shared.dbQueue.write { db in
                try pattern.delete(db)
            }
            loadPatterns()
        } catch {
            print("Failed to delete pattern: \(error)")
        }
    }
}

struct CategoryPill: View {
    let name: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(name)
                .font(.system(size: 11))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(isSelected ? Color.accentColor.opacity(0.2) : Color(nsColor: .controlBackgroundColor))
                .foregroundColor(isSelected ? .accentColor : .secondary)
                .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }
}

struct PatternCard: View {
    let pattern: Pattern
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(pattern.category.capitalized)
                    .font(.system(size: 9, weight: .semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(categoryColor.opacity(0.2))
                    .foregroundColor(categoryColor)
                    .cornerRadius(4)

                if pattern.autoDetected {
                    Text("auto")
                        .font(.system(size: 9))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.purple.opacity(0.15))
                        .foregroundColor(.purple)
                        .cornerRadius(3)
                }

                Spacer()

                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }

            Text(pattern.title)
                .font(.system(size: 13, weight: .medium))

            Text(pattern.description)
                .font(.system(size: 12))
                .foregroundColor(.secondary)
        }
        .padding(12)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }

    private var categoryColor: Color {
        switch pattern.category {
        case "architecture": return .blue
        case "naming": return .green
        case "schema": return .orange
        case "workflow": return .purple
        default: return .gray
        }
    }
}

struct NewPatternSheet: View {
    let categories: [String]
    let onSave: (String, String, String) -> Void
    let onCancel: () -> Void

    @State private var title = ""
    @State private var description = ""
    @State private var category: String

    init(categories: [String], onSave: @escaping (String, String, String) -> Void,
         onCancel: @escaping () -> Void) {
        self.categories = categories
        self.onSave = onSave
        self.onCancel = onCancel
        self._category = State(initialValue: categories.first ?? "architecture")
    }

    var body: some View {
        VStack(spacing: 16) {
            Text("New Pattern")
                .font(.headline)

            Picker("Category", selection: $category) {
                ForEach(categories, id: \.self) { cat in
                    Text(cat.capitalized).tag(cat)
                }
            }

            TextField("Title", text: $title)
                .textFieldStyle(.roundedBorder)

            TextEditor(text: $description)
                .frame(height: 100)
                .border(Color.gray.opacity(0.3))

            HStack {
                Button("Cancel", action: onCancel)
                Button("Save") { onSave(title, description, category) }
                    .buttonStyle(.borderedProminent)
                    .disabled(title.isEmpty || description.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 400)
    }
}
```

**Step 2: Replace placeholder in GUIPanelView, build, verify**

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add memory/pattern inspector with category filtering and CRUD"
```

---

## Phase 6: Context Engine

### Task 14: MCP Server

**Files:**
- Create: `Context/Context/Services/MCPServer.swift`

**Step 1: Create the MCP server**

The MCP server listens on a Unix socket and responds to JSON-RPC requests from Claude Code. This is the most complex service — it implements the MCP protocol over stdio-style JSON-RPC.

```swift
// Context/Context/Services/MCPServer.swift
import Foundation
import GRDB

/// Lightweight MCP server that serves context data over a Unix socket.
/// Claude Code connects to this to fetch project context on-demand.
class MCPServer {
    private let socketPath: String
    private let db: DatabaseService
    private var serverSocket: Int32 = -1
    private var isRunning = false
    private let queue = DispatchQueue(label: "com.context.mcp", qos: .utility)

    init(db: DatabaseService = .shared) {
        self.db = db

        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!.appendingPathComponent("Context", isDirectory: true)
        self.socketPath = appSupport.appendingPathComponent("mcp.sock").path
    }

    func start() {
        queue.async { [weak self] in
            self?.runServer()
        }
    }

    func stop() {
        isRunning = false
        if serverSocket >= 0 {
            close(serverSocket)
            serverSocket = -1
        }
        unlink(socketPath)
    }

    private func runServer() {
        // Remove existing socket
        unlink(socketPath)

        // Create Unix domain socket
        serverSocket = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverSocket >= 0 else {
            print("MCP: Failed to create socket")
            return
        }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        socketPath.withCString { ptr in
            withUnsafeMutablePointer(to: &addr.sun_path.0) { dest in
                _ = strcpy(dest, ptr)
            }
        }

        let bindResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                bind(serverSocket, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }

        guard bindResult == 0 else {
            print("MCP: Failed to bind socket")
            return
        }

        listen(serverSocket, 5)
        isRunning = true
        print("MCP: Server listening at \(socketPath)")

        while isRunning {
            let clientSocket = accept(serverSocket, nil, nil)
            guard clientSocket >= 0 else { continue }

            queue.async { [weak self] in
                self?.handleClient(clientSocket)
            }
        }
    }

    private func handleClient(_ clientSocket: Int32) {
        defer { close(clientSocket) }

        var buffer = [UInt8](repeating: 0, count: 65536)
        while isRunning {
            let bytesRead = read(clientSocket, &buffer, buffer.count)
            guard bytesRead > 0 else { break }

            let data = Data(buffer[0..<bytesRead])
            guard let request = String(data: data, encoding: .utf8) else { continue }

            // Parse JSON-RPC request
            if let response = handleRequest(request) {
                let responseData = response.data(using: .utf8)!
                _ = responseData.withUnsafeBytes { ptr in
                    write(clientSocket, ptr.baseAddress!, responseData.count)
                }
            }
        }
    }

    private func handleRequest(_ raw: String) -> String? {
        guard let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let method = json["method"] as? String,
              let id = json["id"]
        else { return nil }

        let params = json["params"] as? [String: Any] ?? [:]

        let result: Any
        do {
            switch method {
            case "tools/list":
                result = toolsList()
            case "tools/call":
                let toolName = params["name"] as? String ?? ""
                let args = params["arguments"] as? [String: Any] ?? [:]
                result = try callTool(name: toolName, arguments: args)
            default:
                result = ["error": "Unknown method: \(method)"]
            }
        } catch {
            result = ["error": error.localizedDescription]
        }

        let response: [String: Any] = [
            "jsonrpc": "2.0",
            "id": id,
            "result": result
        ]

        guard let responseData = try? JSONSerialization.data(
            withJSONObject: response, options: []
        ) else { return nil }

        return String(data: responseData, encoding: .utf8)
    }

    private func toolsList() -> [[String: Any]] {
        return [
            [
                "name": "get_recent_sessions",
                "description": "Get recent Claude Code sessions for the current project",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "project_path": ["type": "string", "description": "Project root path"],
                        "limit": ["type": "integer", "description": "Max sessions to return (default 5)"]
                    ],
                    "required": ["project_path"]
                ]
            ],
            [
                "name": "get_active_tasks",
                "description": "Get pending and in-progress tasks for the project",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "project_path": ["type": "string", "description": "Project root path"]
                    ],
                    "required": ["project_path"]
                ]
            ],
            [
                "name": "get_patterns",
                "description": "Get coding patterns and conventions for the project",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "project_path": ["type": "string", "description": "Project root path"],
                        "category": ["type": "string", "description": "Filter by category (architecture, naming, schema, workflow)"]
                    ],
                    "required": ["project_path"]
                ]
            ],
            [
                "name": "get_codebase_snapshot",
                "description": "Get the latest codebase structure snapshot",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "project_path": ["type": "string", "description": "Project root path"]
                    ],
                    "required": ["project_path"]
                ]
            ],
            [
                "name": "search_sessions",
                "description": "Search across session history by keyword",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "project_path": ["type": "string", "description": "Project root path"],
                        "query": ["type": "string", "description": "Search query"]
                    ],
                    "required": ["project_path", "query"]
                ]
            ],
            [
                "name": "get_session_detail",
                "description": "Get full details of a specific session",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "session_id": ["type": "string", "description": "Session UUID"]
                    ],
                    "required": ["session_id"]
                ]
            ]
        ]
    }

    private func callTool(name: String, arguments: [String: Any]) throws -> [String: Any] {
        switch name {
        case "get_recent_sessions":
            return try getRecentSessions(args: arguments)
        case "get_active_tasks":
            return try getActiveTasks(args: arguments)
        case "get_patterns":
            return try getPatterns(args: arguments)
        case "get_codebase_snapshot":
            return try getCodebaseSnapshot(args: arguments)
        case "search_sessions":
            return try searchSessions(args: arguments)
        case "get_session_detail":
            return try getSessionDetail(args: arguments)
        default:
            return ["error": "Unknown tool: \(name)"]
        }
    }

    // MARK: - Tool implementations

    private func getRecentSessions(args: [String: Any]) throws -> [String: Any] {
        guard let projectPath = args["project_path"] as? String else {
            return ["error": "project_path required"]
        }
        let limit = args["limit"] as? Int ?? 5

        let sessions = try db.dbQueue.read { db -> [Session] in
            guard let project = try Project.filter(
                Project.Columns.path == projectPath
            ).fetchOne(db) else { return [] }

            return try Session
                .filter(Session.Columns.projectId == project.id)
                .order(Session.Columns.startedAt.desc)
                .limit(limit)
                .fetchAll(db)
        }

        let formatted = sessions.map { s -> [String: Any] in
            var dict: [String: Any] = [
                "id": s.id,
                "messages": s.messageCount,
                "tools": s.toolUseCount
            ]
            if let slug = s.slug { dict["slug"] = slug }
            if let date = s.startedAt { dict["date"] = ISO8601DateFormatter().string(from: date) }
            if let branch = s.gitBranch { dict["branch"] = branch }
            if let summary = s.summary { dict["summary"] = summary }
            if let files = s.filesChanged { dict["files_changed"] = files }
            return dict
        }

        return ["content": [["type": "text", "text": formatJSON(formatted)]]]
    }

    private func getActiveTasks(args: [String: Any]) throws -> [String: Any] {
        guard let projectPath = args["project_path"] as? String else {
            return ["error": "project_path required"]
        }

        let tasks = try db.dbQueue.read { db -> [TaskItem] in
            guard let project = try Project.filter(
                Project.Columns.path == projectPath
            ).fetchOne(db) else { return [] }

            return try TaskItem
                .filter(Column("projectId") == project.id)
                .filter(Column("status") != "done")
                .order(Column("priority").desc)
                .fetchAll(db)
        }

        let formatted = tasks.map { t -> [String: Any] in
            var dict: [String: Any] = [
                "title": t.title,
                "status": t.status,
                "source": t.source
            ]
            if let desc = t.description { dict["description"] = desc }
            return dict
        }

        return ["content": [["type": "text", "text": formatJSON(formatted)]]]
    }

    private func getPatterns(args: [String: Any]) throws -> [String: Any] {
        guard let projectPath = args["project_path"] as? String else {
            return ["error": "project_path required"]
        }
        let category = args["category"] as? String

        let patterns = try db.dbQueue.read { db -> [Pattern] in
            guard let project = try Project.filter(
                Project.Columns.path == projectPath
            ).fetchOne(db) else { return [] }

            var query = Pattern.filter(Column("projectId") == project.id)
            if let cat = category {
                query = query.filter(Column("category") == cat)
            }
            return try query.fetchAll(db)
        }

        let formatted = patterns.map { p -> [String: Any] in
            [
                "category": p.category,
                "title": p.title,
                "description": p.description
            ]
        }

        return ["content": [["type": "text", "text": formatJSON(formatted)]]]
    }

    private func getCodebaseSnapshot(args: [String: Any]) throws -> [String: Any] {
        guard let projectPath = args["project_path"] as? String else {
            return ["error": "project_path required"]
        }

        let snapshot = try db.dbQueue.read { db -> CodebaseSnapshot? in
            guard let project = try Project.filter(
                Project.Columns.path == projectPath
            ).fetchOne(db) else { return nil }

            return try CodebaseSnapshot
                .filter(Column("projectId") == project.id)
                .order(Column("capturedAt").desc)
                .fetchOne(db)
        }

        guard let snap = snapshot else {
            return ["content": [["type": "text", "text": "No codebase snapshot available."]]]
        }

        var result: [String: Any] = [
            "captured_at": ISO8601DateFormatter().string(from: snap.capturedAt)
        ]
        if let tree = snap.fileTree { result["file_tree"] = tree }
        if let hash = snap.schemaHash { result["schema_hash"] = hash }
        if let symbols = snap.keySymbols { result["key_symbols"] = symbols }

        return ["content": [["type": "text", "text": formatJSON(result)]]]
    }

    private func searchSessions(args: [String: Any]) throws -> [String: Any] {
        guard let projectPath = args["project_path"] as? String,
              let query = args["query"] as? String
        else {
            return ["error": "project_path and query required"]
        }

        let sessions = try db.dbQueue.read { db -> [Session] in
            guard let project = try Project.filter(
                Project.Columns.path == projectPath
            ).fetchOne(db) else { return [] }

            return try Session
                .filter(Session.Columns.projectId == project.id)
                .filter(Session.Columns.summary.like("%\(query)%"))
                .order(Session.Columns.startedAt.desc)
                .limit(10)
                .fetchAll(db)
        }

        let formatted = sessions.map { s -> [String: Any] in
            var dict: [String: Any] = ["id": s.id, "messages": s.messageCount]
            if let slug = s.slug { dict["slug"] = slug }
            if let summary = s.summary { dict["summary"] = summary }
            if let date = s.startedAt { dict["date"] = ISO8601DateFormatter().string(from: date) }
            return dict
        }

        return ["content": [["type": "text", "text": formatJSON(formatted)]]]
    }

    private func getSessionDetail(args: [String: Any]) throws -> [String: Any] {
        guard let sessionId = args["session_id"] as? String else {
            return ["error": "session_id required"]
        }

        guard let session = try db.dbQueue.read({ db in
            try Session.fetchOne(db, key: sessionId)
        }) else {
            return ["content": [["type": "text", "text": "Session not found."]]]
        }

        var dict: [String: Any] = [
            "id": session.id,
            "messages": session.messageCount,
            "tools": session.toolUseCount
        ]
        if let slug = session.slug { dict["slug"] = slug }
        if let date = session.startedAt { dict["date"] = ISO8601DateFormatter().string(from: date) }
        if let end = session.endedAt { dict["ended"] = ISO8601DateFormatter().string(from: end) }
        if let branch = session.gitBranch { dict["branch"] = branch }
        if let model = session.model { dict["model"] = model }
        if let summary = session.summary { dict["summary"] = summary }
        if let files = session.filesChanged { dict["files_changed"] = files }

        return ["content": [["type": "text", "text": formatJSON(dict)]]]
    }

    private func formatJSON(_ obj: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: .prettyPrinted),
              let str = String(data: data, encoding: .utf8)
        else { return "\(obj)" }
        return str
    }
}
```

**Step 2: Wire MCP server start into ContextApp.swift**

Add to the `init()` or `onAppear`:

```swift
let mcpServer = MCPServer()
mcpServer.start()
```

**Step 3: Build, verify server starts (check console output)**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add local MCP server with Unix socket for context delivery"
```

---

### Task 15: Context Injector (CLAUDE.md + Hook Management)

**Files:**
- Create: `Context/Context/Services/ContextInjector.swift`

**Step 1: Create the context injector**

```swift
// Context/Context/Services/ContextInjector.swift
import Foundation
import GRDB

class ContextInjector {
    private let db: DatabaseService

    init(db: DatabaseService = .shared) {
        self.db = db
    }

    /// Update the CLAUDE.md file for a project with a minimal context pointer
    func updateClaudeMD(for project: Project) throws {
        let claudeMDPath = URL(fileURLWithPath: project.path)
            .appendingPathComponent("CLAUDE.md")

        let marker = "<!-- Context.app managed section -->"
        let endMarker = "<!-- End Context.app section -->"

        let section = """
        \(marker)
        # Context
        This project uses Context.app for session memory.
        Use the `context` MCP tools to retrieve project history,
        active tasks, patterns, and codebase structure when needed.
        \(endMarker)
        """

        let fm = FileManager.default

        if fm.fileExists(atPath: claudeMDPath.path) {
            var content = try String(contentsOf: claudeMDPath, encoding: .utf8)

            if let startRange = content.range(of: marker),
               let endRange = content.range(of: endMarker) {
                // Replace existing section
                let fullRange = startRange.lowerBound...endRange.upperBound
                content.replaceSubrange(fullRange, with: section)
            } else {
                // Append section
                content += "\n\n" + section
            }

            try content.write(to: claudeMDPath, atomically: true, encoding: .utf8)
        } else {
            // Create new file
            try section.write(to: claudeMDPath, atomically: true, encoding: .utf8)
        }
    }

    /// Remove the managed section from CLAUDE.md
    func removeClaudeMDSection(for project: Project) throws {
        let claudeMDPath = URL(fileURLWithPath: project.path)
            .appendingPathComponent("CLAUDE.md")

        let marker = "<!-- Context.app managed section -->"
        let endMarker = "<!-- End Context.app section -->"

        guard FileManager.default.fileExists(atPath: claudeMDPath.path) else { return }

        var content = try String(contentsOf: claudeMDPath, encoding: .utf8)

        if let startRange = content.range(of: marker),
           let endRange = content.range(of: endMarker) {
            let fullRange = startRange.lowerBound...endRange.upperBound
            content.removeSubrange(fullRange)
            content = content.trimmingCharacters(in: .whitespacesAndNewlines)

            if content.isEmpty {
                try FileManager.default.removeItem(at: claudeMDPath)
            } else {
                try content.write(to: claudeMDPath, atomically: true, encoding: .utf8)
            }
        }
    }

    /// Configure Claude Code to use our MCP server
    func configureMCPConnection() throws {
        let socketPath = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
            .appendingPathComponent("Context/mcp.sock")
            .path

        // Write MCP config that Claude Code can reference
        let configPath = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
            .appendingPathComponent("Context/mcp-config.json")

        let config: [String: Any] = [
            "mcpServers": [
                "context": [
                    "command": "socat",
                    "args": ["UNIX-CONNECT:\(socketPath)", "STDIO"]
                ]
            ]
        ]

        let data = try JSONSerialization.data(withJSONObject: config, options: .prettyPrinted)
        try data.write(to: configPath)
    }
}
```

**Step 2: Build and verify**

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add context injector for CLAUDE.md management and MCP config"
```

---

## Phase 7: Settings & Polish

### Task 16: Settings Panel

**Files:**
- Create: `Context/Context/Views/SettingsView.swift`
- Create: `Context/Context/Services/AppSettings.swift`
- Modify: `Context/Context/ContextApp.swift` (add Settings scene)

**Step 1: Create the settings model**

```swift
// Context/Context/Services/AppSettings.swift
import Foundation

class AppSettings: ObservableObject {
    @Published var autoSnapshotSessions: Bool {
        didSet { UserDefaults.standard.set(autoSnapshotSessions, forKey: "autoSnapshotSessions") }
    }
    @Published var autoUpdateCodebaseTree: Bool {
        didSet { UserDefaults.standard.set(autoUpdateCodebaseTree, forKey: "autoUpdateCodebaseTree") }
    }
    @Published var mcpServerAutoStart: Bool {
        didSet { UserDefaults.standard.set(mcpServerAutoStart, forKey: "mcpServerAutoStart") }
    }
    @Published var claudeMDInjection: Bool {
        didSet { UserDefaults.standard.set(claudeMDInjection, forKey: "claudeMDInjection") }
    }
    @Published var snapshotDebounce: Double {
        didSet { UserDefaults.standard.set(snapshotDebounce, forKey: "snapshotDebounce") }
    }
    @Published var terminalFontSize: Double {
        didSet { UserDefaults.standard.set(terminalFontSize, forKey: "terminalFontSize") }
    }
    @Published var scrollbackLines: Int {
        didSet { UserDefaults.standard.set(scrollbackLines, forKey: "scrollbackLines") }
    }

    init() {
        let defaults = UserDefaults.standard
        self.autoSnapshotSessions = defaults.object(forKey: "autoSnapshotSessions") as? Bool ?? true
        self.autoUpdateCodebaseTree = defaults.object(forKey: "autoUpdateCodebaseTree") as? Bool ?? true
        self.mcpServerAutoStart = defaults.object(forKey: "mcpServerAutoStart") as? Bool ?? true
        self.claudeMDInjection = defaults.object(forKey: "claudeMDInjection") as? Bool ?? true
        self.snapshotDebounce = defaults.object(forKey: "snapshotDebounce") as? Double ?? 30.0
        self.terminalFontSize = defaults.object(forKey: "terminalFontSize") as? Double ?? 13.0
        self.scrollbackLines = defaults.object(forKey: "scrollbackLines") as? Int ?? 10000
    }
}
```

**Step 2: Create the settings view**

```swift
// Context/Context/Views/SettingsView.swift
import SwiftUI

struct SettingsView: View {
    @ObservedObject var settings: AppSettings

    var body: some View {
        TabView {
            GeneralSettings(settings: settings)
                .tabItem { Label("General", systemImage: "gear") }

            TerminalSettings(settings: settings)
                .tabItem { Label("Terminal", systemImage: "terminal") }

            ContextEngineSettings(settings: settings)
                .tabItem { Label("Context Engine", systemImage: "brain") }
        }
        .frame(width: 450, height: 300)
    }
}

struct GeneralSettings: View {
    @ObservedObject var settings: AppSettings

    var body: some View {
        Form {
            // Placeholder for general settings
            Text("General settings coming soon")
                .foregroundColor(.secondary)
        }
        .padding()
    }
}

struct TerminalSettings: View {
    @ObservedObject var settings: AppSettings

    var body: some View {
        Form {
            HStack {
                Text("Font Size")
                Slider(value: $settings.terminalFontSize, in: 10...24, step: 1)
                Text("\(Int(settings.terminalFontSize))pt")
            }

            Stepper("Scrollback: \(settings.scrollbackLines) lines",
                    value: $settings.scrollbackLines, in: 1000...100000, step: 1000)
        }
        .padding()
    }
}

struct ContextEngineSettings: View {
    @ObservedObject var settings: AppSettings

    var body: some View {
        Form {
            Toggle("Auto-snapshot sessions", isOn: $settings.autoSnapshotSessions)
            Toggle("Auto-update codebase tree", isOn: $settings.autoUpdateCodebaseTree)
            Toggle("MCP server auto-start", isOn: $settings.mcpServerAutoStart)
            Toggle("CLAUDE.md injection", isOn: $settings.claudeMDInjection)

            HStack {
                Text("Snapshot debounce")
                Slider(value: $settings.snapshotDebounce, in: 5...120, step: 5)
                Text("\(Int(settings.snapshotDebounce))s")
            }
        }
        .padding()
    }
}
```

**Step 3: Add Settings scene to ContextApp.swift**

Add after the WindowGroup:

```swift
Settings {
    SettingsView(settings: appSettings)
}
```

And add `@StateObject private var appSettings = AppSettings()` to the app struct.

**Step 4: Build, verify Settings opens from app menu (Cmd+,)**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add settings panel with terminal, general, and context engine tabs"
```

---

### Task 17: Session Watcher Integration

**Files:**
- Create: `Context/Context/Services/SessionWatcher.swift`

**Step 1: Create the session watcher that ties everything together**

This watches for session changes and triggers snapshot creation automatically.

```swift
// Context/Context/Services/SessionWatcher.swift
import Foundation
import GRDB

class SessionWatcher: ObservableObject {
    private var fileWatcher: FileWatcher?
    private let db: DatabaseService
    private var currentProject: Project?

    init(db: DatabaseService = .shared) {
        self.db = db
    }

    func watchProject(_ project: Project) {
        // Stop previous watcher
        fileWatcher?.stop()
        currentProject = project

        guard let claudeProject = project.claudeProject else { return }

        // Watch the Claude project directory for new/modified JSONL files
        fileWatcher = FileWatcher(
            paths: [claudeProject],
            debounceInterval: 30.0 // Match snapshot debounce setting
        ) { [weak self] changedPaths in
            self?.handleSessionChanges(changedPaths)
        }

        fileWatcher?.start()
    }

    func stopWatching() {
        fileWatcher?.stop()
        fileWatcher = nil
    }

    private func handleSessionChanges(_ paths: [String]) {
        guard let project = currentProject else { return }

        for path in paths {
            guard path.hasSuffix(".jsonl") else { continue }

            let url = URL(fileURLWithPath: path)
            let sessionId = url.deletingPathExtension().lastPathComponent

            // Skip non-UUID filenames
            guard UUID(uuidString: sessionId) != nil else { continue }

            do {
                guard let parsed = try SessionParser.parse(fileURL: url) else { continue }

                let filesChangedJSON = try? JSONEncoder().encode(parsed.filesChanged)
                let filesChangedString = filesChangedJSON.flatMap {
                    String(data: $0, encoding: .utf8)
                }

                try db.dbQueue.write { db in
                    // Upsert: update if exists, insert if new
                    var session = Session(
                        id: parsed.sessionId,
                        projectId: project.id,
                        slug: parsed.slug,
                        startedAt: parsed.startedAt,
                        endedAt: parsed.endedAt,
                        model: parsed.model,
                        gitBranch: parsed.gitBranch,
                        summary: SessionParser.generateSummary(from: parsed),
                        messageCount: parsed.messageCount,
                        toolUseCount: parsed.toolUseCount,
                        filesChanged: filesChangedString
                    )
                    try session.save(db) // insert or update
                }

                DispatchQueue.main.async {
                    print("Session snapshot updated: \(sessionId)")
                }
            } catch {
                print("Failed to process session: \(error)")
            }
        }
    }
}
```

**Step 2: Wire into AppState — start watching when a project is selected**

Add to `AppState.selectProject()`:

```swift
sessionWatcher.watchProject(project)
```

**Step 3: Build, verify, commit**

```bash
git add -A
git commit -m "feat: add session watcher for automatic snapshot creation on session end"
```

---

### Task 18: Final Wiring and Integration Testing

**Files:**
- Modify: `Context/Context/ContextApp.swift` (final wiring)
- Modify: `Context/Context/Views/GUIPanelView.swift` (replace all placeholders)

**Step 1: Replace all placeholder views in GUIPanelView.swift**

In the switch statement, replace:
- `DashboardPlaceholder()` → `DashboardView()`
- `SessionsPlaceholder()` → `SessionListView()`
- `TasksPlaceholder()` → `KanbanBoard()`
- `NotesPlaceholder()` → `NoteListView()`
- `MemoryPlaceholder()` → `PatternListView()`

**Step 2: Wire all services into ContextApp.swift**

Ensure `ContextApp` starts:
1. DatabaseService
2. MCPServer
3. SessionWatcher (via AppState)
4. ContextInjector (on project select)

**Step 3: Full build and manual smoke test**

```bash
xcodebuild -scheme Context -destination 'platform=macOS' build
```

Run the app and verify:
- [ ] App launches with split view
- [ ] Terminal tab opens with zsh
- [ ] Projects discovered from ~/.claude/
- [ ] Selecting a project cd's the terminal
- [ ] Sessions populate in Dashboard and Sessions tab
- [ ] Tasks kanban works (create, move)
- [ ] Notes create/edit/delete/pin
- [ ] Patterns create/filter/delete
- [ ] MCP server socket exists at ~/Library/Application Support/Context/mcp.sock

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire all views and services together for working prototype"
```

---

## Post-Implementation Notes

### Known areas needing refinement after v1:
1. **Project path resolver** — the encoded path decoder in `ProjectDiscovery` needs testing against edge cases (paths with hyphens in directory names)
2. **MCP protocol compliance** — the current MCP server is a simplified implementation. Full MCP spec compliance (initialization handshake, capability negotiation) should be added for reliable Claude Code integration
3. **SwiftTerm API** — the `LocalProcessTerminalView` delegate methods may need adjustment based on the exact SwiftTerm version. Check the library's example app for reference.
4. **FTS5 integration** — the session search using FTS5 synchronized tables needs testing; the GRDB API for FTS join queries may need adjustment
5. **Drag and drop** — the kanban board uses context-menu "Move Forward" instead of true drag-and-drop. SwiftUI's drag-and-drop on macOS can be added as a polish item.

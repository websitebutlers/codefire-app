import Foundation
import GRDB

// MARK: - Database Access

/// Opens the same database used by the Context app.
func openDatabase() throws -> DatabaseQueue {
    let appSupportURL = FileManager.default.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
    ).first!.appendingPathComponent("Context", isDirectory: true)

    let dbPath = appSupportURL.appendingPathComponent("context.db").path
    guard FileManager.default.fileExists(atPath: dbPath) else {
        throw MCPError(message: "Context database not found at \(dbPath). Launch Context.app first.")
    }
    var config = Configuration()
    config.busyMode = .timeout(5.0) // Wait up to 5s for locks (cross-process access)
    let db = try DatabaseQueue(path: dbPath, configuration: config)

    // Enable WAL mode for concurrent cross-process access
    try db.writeWithoutTransaction { db in
        try db.execute(sql: "PRAGMA journal_mode=WAL")
    }

    // Ensure browserCommands table exists (may not if GUI app hasn't launched since update)
    try db.write { conn in
        try conn.execute(sql: """
            CREATE TABLE IF NOT EXISTS browserCommands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool TEXT NOT NULL,
                args TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                result TEXT,
                createdAt DATETIME NOT NULL,
                completedAt DATETIME
            )
        """)
    }

    return db
}

// MARK: - Models (lightweight copies)

struct TaskItem: Codable, FetchableRecord, MutablePersistableRecord {
    var id: Int64?
    var projectId: String
    var title: String
    var description: String?
    var status: String
    var priority: Int
    var sourceSession: String?
    var source: String
    var createdAt: Date
    var completedAt: Date?
    var labels: String?
    var attachments: String?
    var isGlobal: Bool
    static let databaseTableName = "taskItems"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

struct TaskNote: Codable, FetchableRecord, MutablePersistableRecord {
    var id: Int64?
    var taskId: Int64
    var content: String
    var source: String
    var sessionId: String?
    var createdAt: Date
    static let databaseTableName = "taskNotes"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

struct Project: Codable, FetchableRecord, TableRecord {
    var id: String
    var name: String
    var path: String
    static let databaseTableName = "projects"
}

struct Note: Codable, FetchableRecord, MutablePersistableRecord {
    var id: Int64?
    var projectId: String
    var title: String
    var content: String
    var pinned: Bool
    var sessionId: String?
    var createdAt: Date
    var updatedAt: Date
    var isGlobal: Bool
    static let databaseTableName = "notes"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

struct Client: Codable, FetchableRecord, MutablePersistableRecord {
    var id: String
    var name: String
    var color: String
    var sortOrder: Int
    var createdAt: Date
    static let databaseTableName = "clients"
}

struct BrowserCommand: Codable, FetchableRecord, MutablePersistableRecord {
    var id: Int64?
    var tool: String
    var args: String?
    var status: String
    var result: String?
    var createdAt: Date
    var completedAt: Date?
    static let databaseTableName = "browserCommands"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

// MARK: - MCP Protocol Types

struct MCPError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct JSONRPCRequest: Decodable {
    let jsonrpc: String
    let id: JSONRPCID?
    let method: String
    let params: [String: AnyCodable]?
}

enum JSONRPCID: Codable, Equatable {
    case int(Int)
    case string(String)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let i = try? container.decode(Int.self) { self = .int(i); return }
        if let s = try? container.decode(String.self) { self = .string(s); return }
        throw DecodingError.typeMismatch(JSONRPCID.self, .init(codingPath: [], debugDescription: "Expected int or string"))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .int(let i): try container.encode(i)
        case .string(let s): try container.encode(s)
        }
    }
}

/// Minimal any-value wrapper for JSON decoding.
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { value = NSNull(); return }
        if let b = try? container.decode(Bool.self) { value = b; return }
        if let i = try? container.decode(Int.self) { value = i; return }
        if let d = try? container.decode(Double.self) { value = d; return }
        if let s = try? container.decode(String.self) { value = s; return }
        if let a = try? container.decode([AnyCodable].self) { value = a.map(\.value); return }
        if let o = try? container.decode([String: AnyCodable].self) { value = o.mapValues(\.value); return }
        throw DecodingError.typeMismatch(AnyCodable.self, .init(codingPath: [], debugDescription: "Unsupported type"))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull: try container.encodeNil()
        case let b as Bool: try container.encode(b)
        case let i as Int: try container.encode(i)
        case let d as Double: try container.encode(d)
        case let s as String: try container.encode(s)
        default: try container.encodeNil()
        }
    }
}

// MARK: - MCP Connection Status

/// Writes a status file so the Context GUI can show an MCP connection indicator.
class MCPConnectionStatus {
    let statusDir: URL
    let statusFile: URL
    let pid: Int32

    init() {
        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!.appendingPathComponent("Context/mcp-connections", isDirectory: true)
        statusDir = appSupport
        pid = ProcessInfo.processInfo.processIdentifier
        statusFile = appSupport.appendingPathComponent("\(pid).json")
    }

    func register(projectId: String?, projectName: String?, cwd: String) {
        try? FileManager.default.createDirectory(at: statusDir, withIntermediateDirectories: true)
        writeStatus(projectId: projectId, projectName: projectName, cwd: cwd)
    }

    func heartbeat(projectId: String?, projectName: String?, cwd: String) {
        writeStatus(projectId: projectId, projectName: projectName, cwd: cwd)
    }

    func deregister() {
        try? FileManager.default.removeItem(at: statusFile)
    }

    private func writeStatus(projectId: String?, projectName: String?, cwd: String) {
        let status: [String: Any] = [
            "pid": Int(pid),
            "cwd": cwd,
            "projectId": projectId as Any,
            "projectName": projectName as Any,
            "connectedAt": ISO8601DateFormatter().string(from: Date()),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: status.compactMapValues { $0 }) {
            try? data.write(to: statusFile, options: .atomic)
        }
    }
}

// MARK: - MCP Server

class MCPServer {
    let db: DatabaseQueue
    let detectedProjectId: String?
    let detectedProjectName: String?
    let workingDirectory: String
    let connectionStatus: MCPConnectionStatus

    init(db: DatabaseQueue) {
        self.db = db
        self.workingDirectory = FileManager.default.currentDirectoryPath
        self.connectionStatus = MCPConnectionStatus()

        // Auto-detect project from working directory
        var foundId: String? = nil
        var foundName: String? = nil
        let cwd = self.workingDirectory

        if let match = try? db.read({ db -> Project? in
            // Exact match first
            if let exact = try Project.filter(Column("path") == cwd).fetchOne(db) {
                return exact
            }
            // Try parent directories (for subdirectories like /project/src)
            let projects = try Project.fetchAll(db)
            var best: Project? = nil
            var bestLen = 0
            for p in projects {
                if cwd.hasPrefix(p.path) && p.path.count > bestLen {
                    best = p
                    bestLen = p.path.count
                }
            }
            return best
        }) {
            foundId = match.id
            foundName = match.name
        }

        self.detectedProjectId = foundId
        self.detectedProjectName = foundName

        // Log detected project to stderr for debugging
        if let name = foundName {
            FileHandle.standardError.write("ContextMCP: detected project '\(name)' from \(cwd)\n".data(using: .utf8)!)
        } else {
            FileHandle.standardError.write("ContextMCP: no project matched for \(cwd)\n".data(using: .utf8)!)
        }

        // Register connection
        connectionStatus.register(projectId: foundId, projectName: foundName, cwd: cwd)
    }

    /// Resolves project_id from args or falls back to auto-detected project.
    func resolveProjectId(_ args: [String: Any]) throws -> String {
        if let explicit = args["project_id"] as? String {
            return explicit
        }
        guard let detected = detectedProjectId else {
            throw MCPError(message: "project_id is required (could not auto-detect from working directory)")
        }
        return detected
    }

    func run() {
        // Clean up on exit
        defer { connectionStatus.deregister() }

        // Handle SIGTERM/SIGINT for clean shutdown
        signal(SIGTERM) { _ in
            // Status file cleanup happens in defer
            exit(0)
        }
        signal(SIGINT) { _ in
            exit(0)
        }

        while let line = readLine(strippingNewline: true) {
            guard !line.isEmpty else { continue }
            guard let data = line.data(using: .utf8) else { continue }

            // Update heartbeat on each request
            connectionStatus.heartbeat(
                projectId: detectedProjectId,
                projectName: detectedProjectName,
                cwd: workingDirectory
            )

            do {
                let request = try JSONDecoder.mcp.decode(JSONRPCRequest.self, from: data)
                let response = handleRequest(request)
                write(response)
            } catch {
                let errResp = errorResponse(id: nil, code: -32700, message: "Parse error: \(error.localizedDescription)")
                write(errResp)
            }
        }
    }

    func handleRequest(_ req: JSONRPCRequest) -> [String: Any] {
        switch req.method {
        case "initialize":
            return successResponse(id: req.id, result: [
                "protocolVersion": "2024-11-05",
                "capabilities": ["tools": [:]],
                "serverInfo": ["name": "context-tasks", "version": "1.0.0"]
            ])

        case "notifications/initialized":
            return [:] // no response for notifications

        case "tools/list":
            return successResponse(id: req.id, result: ["tools": toolDefinitions()])

        case "tools/call":
            return handleToolCall(req)

        default:
            return errorResponse(id: req.id, code: -32601, message: "Method not found: \(req.method)")
        }
    }

    // MARK: - Tool Definitions

    func toolDefinitions() -> [[String: Any]] {
        [
            [
                "name": "get_current_project",
                "description": "Get the auto-detected project for this session based on the working directory. Call this first to confirm which project you're working with.",
                "inputSchema": [
                    "type": "object",
                    "properties": [:] as [String: Any]
                ]
            ],
            [
                "name": "list_projects",
                "description": "List all projects tracked by Context",
                "inputSchema": [
                    "type": "object",
                    "properties": [:] as [String: Any]
                ]
            ],
            [
                "name": "list_tasks",
                "description": "List tasks for a project. Returns task ID, title, status, priority, and description. project_id is auto-detected from working directory if omitted.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "project_id": ["type": "string", "description": "Project ID (auto-detected if omitted)"],
                        "status": ["type": "string", "description": "Filter by status: todo, in_progress, done. Omit for all.", "enum": ["todo", "in_progress", "done"]],
                        "global": ["type": "boolean", "description": "Set true to list global planner tasks instead of project tasks"],
                    ]
                ]
            ],
            [
                "name": "get_task",
                "description": "Get full details of a task by ID, including notes and attachments.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "task_id": ["type": "integer", "description": "Task ID"]
                    ],
                    "required": ["task_id"]
                ]
            ],
            [
                "name": "create_task",
                "description": "Create a new task in a project. project_id is auto-detected from working directory if omitted.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "project_id": ["type": "string", "description": "Project ID (auto-detected if omitted)"],
                        "title": ["type": "string", "description": "Task title"],
                        "description": ["type": "string", "description": "Task description (optional)"],
                        "priority": ["type": "integer", "description": "Priority: 0=none, 1=low, 2=medium, 3=high, 4=urgent"],
                        "labels": ["type": "array", "items": ["type": "string"], "description": "Labels (e.g. bug, feature, refactor)"],
                        "global": ["type": "boolean", "description": "Set true to create a global planner task (visible on home board)"],
                    ],
                    "required": ["title"]
                ]
            ],
            [
                "name": "update_task",
                "description": "Update a task's fields (status, priority, title, description, labels).",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "task_id": ["type": "integer", "description": "Task ID"],
                        "status": ["type": "string", "description": "New status", "enum": ["todo", "in_progress", "done"]],
                        "priority": ["type": "integer", "description": "New priority (0-4)"],
                        "title": ["type": "string", "description": "New title"],
                        "description": ["type": "string", "description": "New description"],
                        "labels": ["type": "array", "items": ["type": "string"], "description": "New labels array"],
                    ],
                    "required": ["task_id"]
                ]
            ],
            [
                "name": "add_task_note",
                "description": "Add a note/comment to a task. Use this to log progress, decisions, or context.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "task_id": ["type": "integer", "description": "Task ID"],
                        "content": ["type": "string", "description": "Note content"],
                        "session_id": ["type": "string", "description": "Claude session ID (auto-detected if omitted)"],
                    ],
                    "required": ["task_id", "content"]
                ]
            ],
            [
                "name": "list_task_notes",
                "description": "List all notes for a task.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "task_id": ["type": "integer", "description": "Task ID"]
                    ],
                    "required": ["task_id"]
                ]
            ],
            [
                "name": "list_notes",
                "description": "List all project-level notes. These are rich notes (title + content) for capturing project context, decisions, patterns, and reference material. project_id is auto-detected from working directory if omitted.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "project_id": ["type": "string", "description": "Project ID (auto-detected if omitted)"],
                        "pinned_only": ["type": "boolean", "description": "If true, only return pinned notes"],
                        "global": ["type": "boolean", "description": "Set true to list global planner notes instead of project notes"],
                    ]
                ]
            ],
            [
                "name": "get_note",
                "description": "Get the full content of a project note by ID.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "note_id": ["type": "integer", "description": "Note ID"]
                    ],
                    "required": ["note_id"]
                ]
            ],
            [
                "name": "create_note",
                "description": "Create a new project-level note. Use for capturing architectural decisions, discovered patterns, session learnings, or any context that should persist. project_id is auto-detected from working directory if omitted.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "project_id": ["type": "string", "description": "Project ID (auto-detected if omitted)"],
                        "title": ["type": "string", "description": "Note title"],
                        "content": ["type": "string", "description": "Note content (supports markdown)"],
                        "pinned": ["type": "boolean", "description": "Pin this note to the top (default: false)"],
                        "session_id": ["type": "string", "description": "Claude session ID that created this note (optional)"],
                        "global": ["type": "boolean", "description": "Set true to create a global planner note"],
                    ],
                    "required": ["title"]
                ]
            ],
            [
                "name": "update_note",
                "description": "Update a project note's title, content, or pinned status.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "note_id": ["type": "integer", "description": "Note ID"],
                        "title": ["type": "string", "description": "New title"],
                        "content": ["type": "string", "description": "New content"],
                        "pinned": ["type": "boolean", "description": "Pin/unpin the note"],
                    ],
                    "required": ["note_id"]
                ]
            ],
            [
                "name": "delete_note",
                "description": "Delete a project note by ID.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "note_id": ["type": "integer", "description": "Note ID"]
                    ],
                    "required": ["note_id"]
                ]
            ],
            [
                "name": "search_notes",
                "description": "Full-text search across all project notes (titles and content). project_id is auto-detected from working directory if omitted.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "project_id": ["type": "string", "description": "Project ID (auto-detected if omitted)"],
                        "query": ["type": "string", "description": "Search query"],
                        "global": ["type": "boolean", "description": "Set true to search global notes instead of project notes"],
                    ],
                    "required": ["query"]
                ]
            ],
            [
                "name": "list_clients",
                "description": "List all clients (used for project grouping in the sidebar).",
                "inputSchema": [
                    "type": "object",
                    "properties": [:] as [String: Any]
                ]
            ],
            [
                "name": "create_client",
                "description": "Create a new client for grouping projects.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string", "description": "Client name"],
                        "color": ["type": "string", "description": "Hex color (e.g. #3B82F6). Optional, defaults to blue."]
                    ] as [String: Any],
                    "required": ["name"]
                ] as [String: Any]
            ],
            // MARK: - Browser Tools
            [
                "name": "browser_navigate",
                "description": "Navigate the browser to a URL. Opens a new tab if none are open. Waits for page load to complete. Requires Context.app to be running.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "url": ["type": "string", "description": "URL to navigate to"]
                    ] as [String: Any],
                    "required": ["url"]
                ] as [String: Any]
            ],
            [
                "name": "browser_snapshot",
                "description": "Get the accessibility tree of the current page as compact structured text. Returns ARIA roles, labels, and interactive element refs. This is the primary tool for understanding page content and structure. Requires Context.app to be running.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
                    ] as [String: Any]
                ] as [String: Any]
            ],
            [
                "name": "browser_extract",
                "description": "Extract text content from a page element using a CSS selector. Returns the text content of the first matching element. Requires Context.app to be running.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "selector": ["type": "string", "description": "CSS selector to find the element"],
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
                    ] as [String: Any],
                    "required": ["selector"]
                ] as [String: Any]
            ],
            [
                "name": "browser_list_tabs",
                "description": "List all open browser tabs with their URLs, titles, and loading state. Requires Context.app to be running.",
                "inputSchema": [
                    "type": "object",
                    "properties": [:] as [String: Any]
                ] as [String: Any]
            ],
            [
                "name": "browser_console_logs",
                "description": "Get JavaScript console log entries (log, warn, error, info) from a browser tab. Useful for debugging web applications. Requires Context.app to be running.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"],
                        "level": ["type": "string", "description": "Filter by level: log, warn, error, info", "enum": ["log", "warn", "error", "info"]]
                    ] as [String: Any]
                ] as [String: Any]
            ],
            [
                "name": "browser_screenshot",
                "description": "Take a PNG screenshot of the current page. Returns the file path so you can read the image. Requires Context.app to be running.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
                    ] as [String: Any]
                ] as [String: Any]
            ],
            [
                "name": "browser_tab_open",
                "description": "Open a new browser tab. Optionally navigate to a URL. Requires Context.app to be running.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "url": ["type": "string", "description": "URL to navigate to (optional)"]
                    ] as [String: Any]
                ] as [String: Any]
            ],
            [
                "name": "browser_tab_close",
                "description": "Close a browser tab by its ID. Requires Context.app to be running.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "tab_id": ["type": "string", "description": "ID of the tab to close"]
                    ] as [String: Any],
                    "required": ["tab_id"]
                ] as [String: Any]
            ],
            [
                "name": "browser_tab_switch",
                "description": "Switch the active browser tab to the specified tab. Requires Context.app to be running.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "tab_id": ["type": "string", "description": "ID of the tab to switch to"]
                    ] as [String: Any],
                    "required": ["tab_id"]
                ] as [String: Any]
            ],
            // Phase 2: Interaction tools
            [
                "name": "browser_click",
                "description": "Click an element by its ref from browser_snapshot. Automatically scrolls into view first. Requires Context.app to be running with the browser tab visible.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "ref": ["type": "string", "description": "Element ref from browser_snapshot (e.g. 'e5')"],
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
                    ],
                    "required": ["ref"]
                ]
            ],
            [
                "name": "browser_type",
                "description": "Type text into an input or textarea element by ref. Clears existing content by default. Works with React and other framework-controlled inputs. Requires Context.app to be running with the browser tab visible.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "ref": ["type": "string", "description": "Element ref from browser_snapshot"],
                        "text": ["type": "string", "description": "Text to type"],
                        "clear": ["type": "boolean", "description": "Clear existing content first (default: true)"],
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
                    ],
                    "required": ["ref", "text"]
                ]
            ],
            [
                "name": "browser_select",
                "description": "Select an option from a <select> dropdown by value or visible label text. On mismatch, returns all available options. Requires Context.app to be running with the browser tab visible.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "ref": ["type": "string", "description": "Element ref of the <select> element"],
                        "value": ["type": "string", "description": "Option value to select"],
                        "label": ["type": "string", "description": "Option visible text to select (alternative to value)"],
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
                    ],
                    "required": ["ref"]
                ]
            ],
            [
                "name": "browser_scroll",
                "description": "Scroll the page by direction/amount, or scroll a specific element into view. Returns scroll position info. Requires Context.app to be running with the browser tab visible.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "ref": ["type": "string", "description": "Scroll this element into view (overrides direction/amount)"],
                        "direction": ["type": "string", "description": "Scroll direction", "enum": ["up", "down", "top", "bottom"]],
                        "amount": ["type": "integer", "description": "Pixels to scroll (default: 500, ignored for top/bottom)"],
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
                    ]
                ]
            ],
            [
                "name": "browser_wait",
                "description": "Wait for an element to appear on the page. Use after clicking something that triggers async loading. Accepts ref or CSS selector. Returns found status, not an error on timeout. Requires Context.app to be running with the browser tab visible.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "ref": ["type": "string", "description": "Wait for element with this ref to exist"],
                        "selector": ["type": "string", "description": "CSS selector to wait for (use when element has no ref yet)"],
                        "timeout": ["type": "integer", "description": "Max seconds to wait (default: 5, max: 15)"],
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
                    ]
                ]
            ],
            // Phase 3: JS execution, keyboard, hover
            [
                "name": "browser_press",
                "description": "Press a key or key combination. Targets a specific element by ref, or the currently focused element if no ref is provided. Handles Enter (submits forms), Tab (moves focus), Escape, arrow keys, and any single character. Requires Context.app to be running with the browser tab visible.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "key": ["type": "string", "description": "Key to press: Enter, Tab, Escape, Backspace, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Space, Delete, Home, End, PageUp, PageDown, or any single character"],
                        "modifiers": ["type": "array", "items": ["type": "string", "enum": ["shift", "ctrl", "alt", "meta"]], "description": "Modifier keys to hold (e.g. ['meta'] for Cmd+key on Mac)"],
                        "ref": ["type": "string", "description": "Element ref to target (defaults to currently focused element)"],
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
                    ],
                    "required": ["key"]
                ]
            ],
            [
                "name": "browser_eval",
                "description": "Execute JavaScript on the page and return the result. The expression runs inside an async function body, so use 'return' to return values and 'await' for promises. Use for reading page state, calling APIs, or handling edge cases other tools can't cover. Requires Context.app to be running with the browser tab visible.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "expression": ["type": "string", "description": "JavaScript to evaluate. Use 'return' to return a value (e.g. 'return document.title')"],
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
                    ],
                    "required": ["expression"]
                ]
            ],
            [
                "name": "browser_hover",
                "description": "Hover over an element by ref. Dispatches mouseenter and mouseover events. Useful for dropdown menus, tooltips, and hover-state UI that requires mouse presence. Scrolls element into view first. Requires Context.app to be running with the browser tab visible.",
                "inputSchema": [
                    "type": "object",
                    "properties": [
                        "ref": ["type": "string", "description": "Element ref from browser_snapshot"],
                        "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
                    ],
                    "required": ["ref"]
                ]
            ],
        ]
    }

    // MARK: - Tool Handlers

    func handleToolCall(_ req: JSONRPCRequest) -> [String: Any] {
        let params = req.params ?? [:]
        guard let toolName = params["name"]?.value as? String else {
            return errorResponse(id: req.id, code: -32602, message: "Missing tool name")
        }
        let args = (params["arguments"]?.value as? [String: Any]) ?? [:]

        do {
            let result: String
            switch toolName {
            case "get_current_project": result = try getCurrentProject()
            case "list_projects":    result = try listProjects()
            case "list_tasks":       result = try listTasks(args)
            case "get_task":         result = try getTask(args)
            case "create_task":      result = try createTask(args)
            case "update_task":      result = try updateTask(args)
            case "add_task_note":    result = try addTaskNote(args)
            case "list_task_notes":  result = try listTaskNotes(args)
            case "list_notes":       result = try listNotes(args)
            case "get_note":         result = try getNote(args)
            case "create_note":      result = try createNote(args)
            case "update_note":      result = try updateNote(args)
            case "delete_note":      result = try deleteNote(args)
            case "search_notes":     result = try searchNotes(args)
            case "list_clients":     result = try listClients()
            case "create_client":    result = try createClient(args)
            case "browser_navigate":   result = try browserNavigate(args)
            case "browser_snapshot":    result = try browserSnapshot(args)
            case "browser_extract":     result = try browserExtract(args)
            case "browser_list_tabs":   result = try browserListTabs(args)
            case "browser_console_logs": result = try browserConsoleLogs(args)
            case "browser_screenshot":  result = try browserScreenshot(args)
            case "browser_tab_open":    result = try browserTabOpen(args)
            case "browser_tab_close":   result = try browserTabClose(args)
            case "browser_tab_switch":  result = try browserTabSwitch(args)
            case "browser_click":       result = try browserClick(args)
            case "browser_type":        result = try browserType(args)
            case "browser_select":      result = try browserSelect(args)
            case "browser_scroll":      result = try browserScroll(args)
            case "browser_wait":        result = try browserWait(args)
            case "browser_press":       result = try browserPress(args)
            case "browser_eval":        result = try browserEval(args)
            case "browser_hover":       result = try browserHover(args)
            default:
                return errorResponse(id: req.id, code: -32602, message: "Unknown tool: \(toolName)")
            }

            return successResponse(id: req.id, result: [
                "content": [["type": "text", "text": result]]
            ])
        } catch {
            return successResponse(id: req.id, result: [
                "content": [["type": "text", "text": "Error: \(error.localizedDescription)"]],
                "isError": true
            ])
        }
    }

    // MARK: - Tool Implementations

    func getCurrentProject() throws -> String {
        guard let id = detectedProjectId, let name = detectedProjectName else {
            return "No project detected for working directory: \(workingDirectory)\nUse list_projects to find the correct project_id and pass it explicitly."
        }
        return "Current project: \(name)\nProject ID: \(id)\nWorking directory: \(workingDirectory)\n\nYou can omit project_id from tool calls — it will default to this project."
    }

    func listProjects() throws -> String {
        let projects = try db.read { db in
            try Project.fetchAll(db)
        }
        var lines = ["Projects (\(projects.count)):"]
        for p in projects {
            lines.append("  [\(p.id)] \(p.name) — \(p.path)")
        }
        return lines.joined(separator: "\n")
    }

    func listTasks(_ args: [String: Any]) throws -> String {
        let isGlobal = args["global"] as? Bool ?? false

        let tasks: [TaskItem]
        if isGlobal {
            tasks = try db.read { db in
                var query = TaskItem.filter(Column("isGlobal") == true)
                if let status = args["status"] as? String {
                    query = query.filter(Column("status") == status)
                }
                return try query.order(Column("priority").desc, Column("createdAt").desc).fetchAll(db)
            }
        } else {
            let projectId = try resolveProjectId(args)
            let statusFilter = args["status"] as? String
            tasks = try db.read { db -> [TaskItem] in
                var query = TaskItem.filter(Column("projectId") == projectId)
                if let status = statusFilter {
                    query = query.filter(Column("status") == status)
                }
                return try query.order(Column("priority").desc, Column("createdAt").desc).fetchAll(db)
            }
        }

        if tasks.isEmpty {
            return "No tasks found."
        }

        var lines = ["Tasks (\(tasks.count)):"]
        for t in tasks {
            let priority = ["none", "low", "medium", "high", "urgent"][min(t.priority, 4)]
            let labels = t.labels.flatMap { l -> String? in
                guard let data = l.data(using: .utf8),
                      let arr = try? JSONDecoder().decode([String].self, from: data)
                else { return nil }
                return arr.joined(separator: ", ")
            }
            var line = "  #\(t.id ?? 0) [\(t.status)] (\(priority)) \(t.title)"
            if let labels { line += " [\(labels)]" }
            lines.append(line)
            if let desc = t.description {
                let preview = desc.prefix(100).replacingOccurrences(of: "\n", with: " ")
                lines.append("    \(preview)\(desc.count > 100 ? "..." : "")")
            }
        }
        return lines.joined(separator: "\n")
    }

    func getTask(_ args: [String: Any]) throws -> String {
        guard let taskId = args["task_id"] as? Int ?? (args["task_id"] as? Int64).map(Int.init) else {
            throw MCPError(message: "task_id is required")
        }

        guard let task = try db.read({ db in
            try TaskItem.fetchOne(db, key: Int64(taskId))
        }) else {
            throw MCPError(message: "Task #\(taskId) not found")
        }

        let notes = try db.read { db in
            try TaskNote.filter(Column("taskId") == Int64(taskId))
                .order(Column("createdAt").asc)
                .fetchAll(db)
        }

        var lines = [
            "Task #\(task.id ?? 0): \(task.title)",
            "Status: \(task.status)",
            "Priority: \(["none", "low", "medium", "high", "urgent"][min(task.priority, 4)])",
            "Source: \(task.source)",
            "Created: \(task.createdAt)",
        ]
        if let desc = task.description { lines.append("Description:\n\(desc)") }
        if let labels = task.labels { lines.append("Labels: \(labels)") }
        if let attachments = task.attachments { lines.append("Attachments: \(attachments)") }

        if !notes.isEmpty {
            lines.append("\nNotes (\(notes.count)):")
            let formatter = DateFormatter()
            formatter.dateFormat = "MMM d, HH:mm"
            for note in notes {
                lines.append("  [\(formatter.string(from: note.createdAt))] (\(note.source)) \(note.content)")
            }
        }

        return lines.joined(separator: "\n")
    }

    func createTask(_ args: [String: Any]) throws -> String {
        let isGlobal = args["global"] as? Bool ?? false
        let projectId: String
        if isGlobal {
            projectId = "__global__"
        } else {
            projectId = try resolveProjectId(args)
        }
        guard let title = args["title"] as? String, !title.isEmpty else {
            throw MCPError(message: "title is required")
        }

        let description = args["description"] as? String
        let priority = args["priority"] as? Int ?? 0

        var labelsJSON: String? = nil
        if let labels = args["labels"] as? [String], !labels.isEmpty {
            if let data = try? JSONEncoder().encode(labels),
               let str = String(data: data, encoding: .utf8) {
                labelsJSON = str
            }
        }

        var task = TaskItem(
            id: nil,
            projectId: projectId,
            title: title,
            description: description,
            status: "todo",
            priority: min(max(priority, 0), 4),
            sourceSession: nil,
            source: "claude",
            createdAt: Date(),
            completedAt: nil,
            labels: labelsJSON,
            attachments: nil,
            isGlobal: isGlobal
        )

        try db.write { db in
            try task.insert(db)
        }

        return "Created task #\(task.id ?? 0): \(title)"
    }

    func updateTask(_ args: [String: Any]) throws -> String {
        guard let taskId = args["task_id"] as? Int ?? (args["task_id"] as? Int64).map(Int.init) else {
            throw MCPError(message: "task_id is required")
        }

        guard var task = try db.read({ db in
            try TaskItem.fetchOne(db, key: Int64(taskId))
        }) else {
            throw MCPError(message: "Task #\(taskId) not found")
        }

        var changes: [String] = []

        if let status = args["status"] as? String {
            task.status = status
            if status == "done" { task.completedAt = Date() }
            else { task.completedAt = nil }
            changes.append("status → \(status)")
        }
        if let priority = args["priority"] as? Int {
            task.priority = min(max(priority, 0), 4)
            changes.append("priority → \(priority)")
        }
        if let title = args["title"] as? String {
            task.title = title
            changes.append("title updated")
        }
        if let desc = args["description"] as? String {
            task.description = desc
            changes.append("description updated")
        }
        if let labels = args["labels"] as? [String] {
            if labels.isEmpty {
                task.labels = nil
            } else if let data = try? JSONEncoder().encode(labels),
                      let str = String(data: data, encoding: .utf8) {
                task.labels = str
            }
            changes.append("labels → \(labels.joined(separator: ", "))")
        }

        if changes.isEmpty {
            return "No changes specified for task #\(taskId)"
        }

        try db.write { db in
            try task.update(db)
        }

        return "Updated task #\(taskId): \(changes.joined(separator: ", "))"
    }

    func addTaskNote(_ args: [String: Any]) throws -> String {
        guard let taskId = args["task_id"] as? Int ?? (args["task_id"] as? Int64).map(Int.init) else {
            throw MCPError(message: "task_id is required")
        }
        guard let content = args["content"] as? String, !content.isEmpty else {
            throw MCPError(message: "content is required")
        }

        // Verify task exists
        guard try db.read({ db in
            try TaskItem.fetchOne(db, key: Int64(taskId))
        }) != nil else {
            throw MCPError(message: "Task #\(taskId) not found")
        }

        let sessionId = args["session_id"] as? String

        var note = TaskNote(
            id: nil,
            taskId: Int64(taskId),
            content: content,
            source: "claude",
            sessionId: sessionId,
            createdAt: Date()
        )

        try db.write { db in
            try note.insert(db)
        }

        return "Added note to task #\(taskId)"
    }

    func listTaskNotes(_ args: [String: Any]) throws -> String {
        guard let taskId = args["task_id"] as? Int ?? (args["task_id"] as? Int64).map(Int.init) else {
            throw MCPError(message: "task_id is required")
        }

        let notes = try db.read { db in
            try TaskNote.filter(Column("taskId") == Int64(taskId))
                .order(Column("createdAt").asc)
                .fetchAll(db)
        }

        if notes.isEmpty {
            return "No notes for task #\(taskId)"
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, HH:mm"
        var lines = ["Notes for task #\(taskId) (\(notes.count)):"]
        for note in notes {
            lines.append("  [\(formatter.string(from: note.createdAt))] (\(note.source)) \(note.content)")
        }
        return lines.joined(separator: "\n")
    }

    // MARK: - Project Notes

    func listNotes(_ args: [String: Any]) throws -> String {
        let isGlobal = args["global"] as? Bool ?? false

        let notes: [Note]
        if isGlobal {
            let pinnedOnly = args["pinned_only"] as? Bool ?? false
            notes = try db.read { db -> [Note] in
                var query = Note.filter(Column("isGlobal") == true)
                if pinnedOnly {
                    query = query.filter(Column("pinned") == true)
                }
                return try query.order(Column("pinned").desc, Column("updatedAt").desc).fetchAll(db)
            }
        } else {
            let projectId = try resolveProjectId(args)
            let pinnedOnly = args["pinned_only"] as? Bool ?? false
            notes = try db.read { db -> [Note] in
                var query = Note.filter(Column("projectId") == projectId)
                if pinnedOnly {
                    query = query.filter(Column("pinned") == true)
                }
                return try query.order(Column("pinned").desc, Column("updatedAt").desc).fetchAll(db)
            }
        }

        if notes.isEmpty {
            return "No notes found."
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, HH:mm"
        var lines = ["Notes (\(notes.count)):"]
        for note in notes {
            let pin = note.pinned ? " [pinned]" : ""
            let preview = note.content.prefix(80).replacingOccurrences(of: "\n", with: " ")
            lines.append("  #\(note.id ?? 0)\(pin) \(note.title)")
            lines.append("    Updated: \(formatter.string(from: note.updatedAt))")
            if !preview.isEmpty {
                lines.append("    \(preview)\(note.content.count > 80 ? "..." : "")")
            }
        }
        return lines.joined(separator: "\n")
    }

    func getNote(_ args: [String: Any]) throws -> String {
        guard let noteId = args["note_id"] as? Int ?? (args["note_id"] as? Int64).map(Int.init) else {
            throw MCPError(message: "note_id is required")
        }

        guard let note = try db.read({ db in
            try Note.fetchOne(db, key: Int64(noteId))
        }) else {
            throw MCPError(message: "Note #\(noteId) not found")
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        var lines = [
            "Note #\(note.id ?? 0): \(note.title)",
            "Pinned: \(note.pinned ? "yes" : "no")",
            "Created: \(formatter.string(from: note.createdAt))",
            "Updated: \(formatter.string(from: note.updatedAt))",
        ]
        if let sid = note.sessionId { lines.append("Session: \(sid)") }
        lines.append("\n\(note.content)")
        return lines.joined(separator: "\n")
    }

    func createNote(_ args: [String: Any]) throws -> String {
        let isGlobal = args["global"] as? Bool ?? false
        let projectId: String
        if isGlobal {
            projectId = "__global__"
        } else {
            projectId = try resolveProjectId(args)
        }
        guard let title = args["title"] as? String, !title.isEmpty else {
            throw MCPError(message: "title is required")
        }

        let content = args["content"] as? String ?? ""
        let pinned = args["pinned"] as? Bool ?? false
        let sessionId = args["session_id"] as? String
        let now = Date()

        var note = Note(
            id: nil,
            projectId: projectId,
            title: title,
            content: content,
            pinned: pinned,
            sessionId: sessionId,
            createdAt: now,
            updatedAt: now,
            isGlobal: isGlobal
        )

        try db.write { db in
            try note.insert(db)
        }

        return "Created note #\(note.id ?? 0): \(title)"
    }

    func updateNote(_ args: [String: Any]) throws -> String {
        guard let noteId = args["note_id"] as? Int ?? (args["note_id"] as? Int64).map(Int.init) else {
            throw MCPError(message: "note_id is required")
        }

        guard var note = try db.read({ db in
            try Note.fetchOne(db, key: Int64(noteId))
        }) else {
            throw MCPError(message: "Note #\(noteId) not found")
        }

        var changes: [String] = []

        if let title = args["title"] as? String {
            note.title = title
            changes.append("title updated")
        }
        if let content = args["content"] as? String {
            note.content = content
            changes.append("content updated")
        }
        if let pinned = args["pinned"] as? Bool {
            note.pinned = pinned
            changes.append(pinned ? "pinned" : "unpinned")
        }

        if changes.isEmpty {
            return "No changes specified for note #\(noteId)"
        }

        note.updatedAt = Date()

        try db.write { db in
            try note.update(db)
        }

        return "Updated note #\(noteId): \(changes.joined(separator: ", "))"
    }

    func deleteNote(_ args: [String: Any]) throws -> String {
        guard let noteId = args["note_id"] as? Int ?? (args["note_id"] as? Int64).map(Int.init) else {
            throw MCPError(message: "note_id is required")
        }

        let deleted = try db.write { db in
            try Note.deleteOne(db, key: Int64(noteId))
        }

        if deleted {
            return "Deleted note #\(noteId)"
        } else {
            throw MCPError(message: "Note #\(noteId) not found")
        }
    }

    func searchNotes(_ args: [String: Any]) throws -> String {
        let isGlobal = args["global"] as? Bool ?? false

        guard let query = args["query"] as? String, !query.isEmpty else {
            throw MCPError(message: "query is required")
        }

        let notes: [Note]
        if isGlobal {
            notes = try db.read { db in
                let sql = """
                    SELECT notes.* FROM notes
                    JOIN notesFts ON notesFts.rowid = notes.id
                    WHERE notes.isGlobal = 1
                    AND notesFts MATCH ?
                    ORDER BY notes.updatedAt DESC
                    """
                return try Note.fetchAll(db, sql: sql, arguments: [query])
            }
        } else {
            let projectId = try resolveProjectId(args)
            // Use FTS5 search via raw SQL joining notesFts virtual table
            notes = try db.read { db in
                let sql = """
                    SELECT notes.* FROM notes
                    JOIN notesFts ON notesFts.rowid = notes.id
                    WHERE notes.projectId = ?
                    AND notesFts MATCH ?
                    ORDER BY notes.updatedAt DESC
                    """
                return try Note.fetchAll(db, sql: sql, arguments: [projectId, query])
            }
        }

        if notes.isEmpty {
            return "No notes matching '\(query)'"
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, HH:mm"
        var lines = ["Search results for '\(query)' (\(notes.count)):"]
        for note in notes {
            let pin = note.pinned ? " [pinned]" : ""
            let preview = note.content.prefix(100).replacingOccurrences(of: "\n", with: " ")
            lines.append("  #\(note.id ?? 0)\(pin) \(note.title)")
            if !preview.isEmpty {
                lines.append("    \(preview)\(note.content.count > 100 ? "..." : "")")
            }
        }
        return lines.joined(separator: "\n")
    }

    // MARK: - Client Handlers

    func listClients() throws -> String {
        let clients = try db.read { db in
            try Client.order(Column("sortOrder").asc, Column("name").asc).fetchAll(db)
        }
        if clients.isEmpty {
            return "No clients found. Use create_client to add one."
        }
        var lines = ["Clients (\(clients.count)):"]
        for c in clients {
            lines.append("  [\(c.id)] \(c.name) (color: \(c.color))")
        }
        return lines.joined(separator: "\n")
    }

    func createClient(_ args: [String: Any]) throws -> String {
        guard let name = args["name"] as? String, !name.isEmpty else {
            throw MCPError(message: "name is required")
        }
        let color = args["color"] as? String ?? "#3B82F6"

        let existingCount = try db.read { db in
            try Client.fetchCount(db)
        }

        var client = Client(
            id: UUID().uuidString,
            name: name,
            color: color,
            sortOrder: existingCount,
            createdAt: Date()
        )

        try db.write { db in
            try client.insert(db)
        }

        return "Created client '\(name)' with ID \(client.id)"
    }

    // MARK: - Browser Tool Handlers

    func browserNavigate(_ args: [String: Any]) throws -> String {
        guard let url = args["url"] as? String, !url.isEmpty else {
            throw MCPError(message: "url is required")
        }
        return try executeBrowserCommand(tool: "browser_navigate", args: ["url": url], timeout: 15.0)
    }

    func browserSnapshot(_ args: [String: Any]) throws -> String {
        var cmdArgs: [String: Any] = [:]
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        return try executeBrowserCommand(tool: "browser_snapshot", args: cmdArgs, timeout: 10.0)
    }

    func browserExtract(_ args: [String: Any]) throws -> String {
        guard let selector = args["selector"] as? String, !selector.isEmpty else {
            throw MCPError(message: "selector is required")
        }
        var cmdArgs: [String: Any] = ["selector": selector]
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        return try executeBrowserCommand(tool: "browser_extract", args: cmdArgs)
    }

    func browserListTabs(_ args: [String: Any]) throws -> String {
        return try executeBrowserCommand(tool: "browser_list_tabs")
    }

    func browserConsoleLogs(_ args: [String: Any]) throws -> String {
        var cmdArgs: [String: Any] = [:]
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        if let level = args["level"] as? String { cmdArgs["level"] = level }
        return try executeBrowserCommand(tool: "browser_console_logs", args: cmdArgs)
    }

    func browserScreenshot(_ args: [String: Any]) throws -> String {
        var cmdArgs: [String: Any] = [:]
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        return try executeBrowserCommand(tool: "browser_screenshot", args: cmdArgs, timeout: 10.0)
    }

    func browserTabOpen(_ args: [String: Any]) throws -> String {
        var cmdArgs: [String: Any] = [:]
        if let url = args["url"] as? String { cmdArgs["url"] = url }
        return try executeBrowserCommand(tool: "browser_tab_open", args: cmdArgs, timeout: 15.0)
    }

    func browserTabClose(_ args: [String: Any]) throws -> String {
        guard let tabId = args["tab_id"] as? String, !tabId.isEmpty else {
            throw MCPError(message: "tab_id is required")
        }
        return try executeBrowserCommand(tool: "browser_tab_close", args: ["tab_id": tabId])
    }

    func browserTabSwitch(_ args: [String: Any]) throws -> String {
        guard let tabId = args["tab_id"] as? String, !tabId.isEmpty else {
            throw MCPError(message: "tab_id is required")
        }
        return try executeBrowserCommand(tool: "browser_tab_switch", args: ["tab_id": tabId])
    }

    // MARK: - Phase 2: Interaction Tools

    func browserClick(_ args: [String: Any]) throws -> String {
        guard let ref = args["ref"] as? String, !ref.isEmpty else {
            throw MCPError(message: "ref is required")
        }
        var cmdArgs: [String: Any] = ["ref": ref]
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        return try executeBrowserCommand(tool: "browser_click", args: cmdArgs)
    }

    func browserType(_ args: [String: Any]) throws -> String {
        guard let ref = args["ref"] as? String, !ref.isEmpty else {
            throw MCPError(message: "ref is required")
        }
        guard let text = args["text"] as? String else {
            throw MCPError(message: "text is required")
        }
        var cmdArgs: [String: Any] = ["ref": ref, "text": text]
        if let clear = args["clear"] as? Bool { cmdArgs["clear"] = clear }
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        return try executeBrowserCommand(tool: "browser_type", args: cmdArgs)
    }

    func browserSelect(_ args: [String: Any]) throws -> String {
        guard let ref = args["ref"] as? String, !ref.isEmpty else {
            throw MCPError(message: "ref is required")
        }
        let value = args["value"] as? String
        let label = args["label"] as? String
        guard value != nil || label != nil else {
            throw MCPError(message: "value or label is required")
        }
        var cmdArgs: [String: Any] = ["ref": ref]
        if let v = value { cmdArgs["value"] = v }
        if let l = label { cmdArgs["label"] = l }
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        return try executeBrowserCommand(tool: "browser_select", args: cmdArgs)
    }

    func browserScroll(_ args: [String: Any]) throws -> String {
        var cmdArgs: [String: Any] = [:]
        if let ref = args["ref"] as? String { cmdArgs["ref"] = ref }
        if let direction = args["direction"] as? String { cmdArgs["direction"] = direction }
        if let amount = args["amount"] as? Int { cmdArgs["amount"] = amount }
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        return try executeBrowserCommand(tool: "browser_scroll", args: cmdArgs)
    }

    func browserWait(_ args: [String: Any]) throws -> String {
        let ref = args["ref"] as? String
        let selector = args["selector"] as? String
        guard ref != nil || selector != nil else {
            throw MCPError(message: "ref or selector is required")
        }
        var cmdArgs: [String: Any] = [:]
        if let r = ref { cmdArgs["ref"] = r }
        if let s = selector { cmdArgs["selector"] = s }
        let timeout = args["timeout"] as? Int ?? 5
        cmdArgs["timeout"] = timeout
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        let swiftTimeout = TimeInterval(min(timeout, 15)) + 3.0
        return try executeBrowserCommand(tool: "browser_wait", args: cmdArgs, timeout: swiftTimeout)
    }

    // MARK: - Phase 3: JS Execution, Keyboard, Hover

    func browserPress(_ args: [String: Any]) throws -> String {
        guard let key = args["key"] as? String, !key.isEmpty else {
            throw MCPError(message: "key is required")
        }
        var cmdArgs: [String: Any] = ["key": key]
        if let ref = args["ref"] as? String { cmdArgs["ref"] = ref }
        if let modifiers = args["modifiers"] as? [Any] {
            cmdArgs["modifiers"] = modifiers
        }
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        return try executeBrowserCommand(tool: "browser_press", args: cmdArgs)
    }

    func browserEval(_ args: [String: Any]) throws -> String {
        guard let expression = args["expression"] as? String, !expression.isEmpty else {
            throw MCPError(message: "expression is required")
        }
        var cmdArgs: [String: Any] = ["expression": expression]
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        return try executeBrowserCommand(tool: "browser_eval", args: cmdArgs, timeout: 10.0)
    }

    func browserHover(_ args: [String: Any]) throws -> String {
        guard let ref = args["ref"] as? String, !ref.isEmpty else {
            throw MCPError(message: "ref is required")
        }
        var cmdArgs: [String: Any] = ["ref": ref]
        if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
        return try executeBrowserCommand(tool: "browser_hover", args: cmdArgs)
    }

    // MARK: - Browser Command Execution

    func executeBrowserCommand(tool: String, args: [String: Any] = [:], timeout: TimeInterval = 5.0) throws -> String {
        let argsJSON: String?
        if args.isEmpty {
            argsJSON = nil
        } else if let data = try? JSONSerialization.data(withJSONObject: args),
                  let str = String(data: data, encoding: .utf8) {
            argsJSON = str
        } else {
            argsJSON = nil
        }

        var command = BrowserCommand(
            id: nil,
            tool: tool,
            args: argsJSON,
            status: "pending",
            result: nil,
            createdAt: Date(),
            completedAt: nil
        )

        try db.write { db in
            try command.insert(db)
        }

        guard let commandId = command.id else {
            throw MCPError(message: "Failed to insert browser command")
        }

        let startTime = Date()
        while Date().timeIntervalSince(startTime) < timeout {
            Thread.sleep(forTimeInterval: 0.05) // 50ms polling

            let updated = try db.read { db in
                try BrowserCommand.fetchOne(db, key: commandId)
            }

            guard let cmd = updated else {
                throw MCPError(message: "Browser command \(commandId) disappeared")
            }

            switch cmd.status {
            case "completed":
                // Clean up
                _ = try? db.write { db in
                    try BrowserCommand.deleteOne(db, key: commandId)
                }
                return cmd.result ?? "{}"

            case "error":
                _ = try? db.write { db in
                    try BrowserCommand.deleteOne(db, key: commandId)
                }
                throw MCPError(message: cmd.result ?? "Browser command failed")

            default:
                continue
            }
        }

        // Timeout — clean up and report
        _ = try? db.write { db in
            try BrowserCommand.deleteOne(db, key: commandId)
        }
        throw MCPError(message: "Browser command timed out after \(Int(timeout))s. Is Context.app running with the browser tab visible?")
    }

    // MARK: - JSON-RPC Helpers

    func successResponse(id: JSONRPCID?, result: [String: Any]) -> [String: Any] {
        var resp: [String: Any] = ["jsonrpc": "2.0", "result": result]
        if let id { resp["id"] = id == .int(0) ? 0 : (id == .string("") ? "" : idValue(id)) }
        return resp
    }

    func errorResponse(id: JSONRPCID?, code: Int, message: String) -> [String: Any] {
        var resp: [String: Any] = [
            "jsonrpc": "2.0",
            "error": ["code": code, "message": message]
        ]
        if let id { resp["id"] = idValue(id) }
        return resp
    }

    func idValue(_ id: JSONRPCID) -> Any {
        switch id {
        case .int(let i): return i
        case .string(let s): return s
        }
    }

    func write(_ response: [String: Any]) {
        guard !response.isEmpty else { return }
        if let data = try? JSONSerialization.data(withJSONObject: response),
           let str = String(data: data, encoding: .utf8) {
            print(str)
            fflush(stdout)
        }
    }
}

// MARK: - JSON Decoder for MCP

extension JSONDecoder {
    static let mcp: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}

// MARK: - Entry Point

do {
    let db = try openDatabase()
    let server = MCPServer(db: db)
    server.run()
} catch {
    let errMsg = """
    {"jsonrpc":"2.0","error":{"code":-32603,"message":"\(error.localizedDescription)"},"id":null}
    """
    FileHandle.standardError.write(errMsg.data(using: .utf8)!)
    exit(1)
}

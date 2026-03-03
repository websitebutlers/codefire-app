import Foundation
import GRDB

// MARK: - MCP Server

/// In-process MCP server that handles JSON-RPC requests by querying the SQLite database.
/// Implements the Model Context Protocol tool interface so Claude Code can retrieve
/// project history, tasks, patterns, and codebase structure.
///
/// Transport note: Claude Code connects via stdio JSON-RPC. Since this app runs as a GUI
/// process, the actual stdio bridge is a future enhancement. This class provides the
/// request-handling logic that any transport layer can call into.
class MCPServer {

    enum MCPError: Error, LocalizedError {
        case projectNotFound(String)
        case sessionNotFound(String)
        case unknownTool(String)
        case missingParameter(String)
        case databaseError(String)

        var errorDescription: String? {
            switch self {
            case .projectNotFound(let path): return "Project not found for path: \(path)"
            case .sessionNotFound(let id): return "Session not found: \(id)"
            case .unknownTool(let name): return "Unknown tool: \(name)"
            case .missingParameter(let name): return "Missing required parameter: \(name)"
            case .databaseError(let msg): return "Database error: \(msg)"
            }
        }
    }

    private let db: DatabaseService

    init(db: DatabaseService = .shared) {
        self.db = db
    }

    // MARK: - JSON-RPC Entry Point

    /// Handle a raw JSON-RPC request string, return a JSON-RPC response string.
    func handleRequest(_ raw: String) -> String? {
        guard let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let method = json["method"] as? String
        else {
            return jsonRPCError(id: nil, code: -32700, message: "Parse error")
        }

        let requestId = json["id"] // Can be Int, String, or nil for notifications
        let params = json["params"] as? [String: Any] ?? [:]

        do {
            let result: Any
            switch method {
            case "tools/list":
                result = ["tools": toolsList()]
            case "tools/call":
                guard let toolName = params["name"] as? String else {
                    return jsonRPCError(id: requestId, code: -32602, message: "Missing tool name")
                }
                let arguments = params["arguments"] as? [String: Any] ?? [:]
                result = try callTool(name: toolName, arguments: arguments)
            case "initialize":
                result = initializeResponse()
            default:
                return jsonRPCError(id: requestId, code: -32601, message: "Method not found: \(method)")
            }
            return jsonRPCSuccess(id: requestId, result: result)
        } catch {
            return jsonRPCError(id: requestId, code: -32000, message: error.localizedDescription)
        }
    }

    // MARK: - MCP Initialize

    private func initializeResponse() -> [String: Any] {
        return [
            "protocolVersion": "2024-11-05",
            "capabilities": [
                "tools": [
                    "listChanged": false
                ]
            ],
            "serverInfo": [
                "name": "codefire",
                "version": "1.0.0"
            ]
        ]
    }

    // MARK: - Tools List

    /// Returns the MCP tools manifest describing all available tools.
    func toolsList() -> [[String: Any]] {
        return [
            toolDef(
                name: "get_recent_sessions",
                description: "Get recent Claude Code sessions for a project, ordered by most recent first.",
                properties: [
                    "project_path": propString("Absolute path to the project directory"),
                    "limit": propInt("Maximum number of sessions to return (default 5)")
                ],
                required: ["project_path"]
            ),
            toolDef(
                name: "get_active_tasks",
                description: "Get active (non-done) tasks for a project.",
                properties: [
                    "project_path": propString("Absolute path to the project directory")
                ],
                required: ["project_path"]
            ),
            toolDef(
                name: "get_patterns",
                description: "Get recorded codebase patterns for a project, optionally filtered by category.",
                properties: [
                    "project_path": propString("Absolute path to the project directory"),
                    "category": propString("Filter by category: architecture, naming, schema, workflow")
                ],
                required: ["project_path"]
            ),
            toolDef(
                name: "get_codebase_snapshot",
                description: "Get the most recent codebase snapshot (file tree, schema hash, key symbols) for a project.",
                properties: [
                    "project_path": propString("Absolute path to the project directory")
                ],
                required: ["project_path"]
            ),
            toolDef(
                name: "search_sessions",
                description: "Search session summaries for a project using a text query.",
                properties: [
                    "project_path": propString("Absolute path to the project directory"),
                    "query": propString("Search query to match against session summaries")
                ],
                required: ["project_path", "query"]
            ),
            toolDef(
                name: "get_session_detail",
                description: "Get full details of a specific session by its ID.",
                properties: [
                    "session_id": propString("The session UUID")
                ],
                required: ["session_id"]
            )
        ]
    }

    // MARK: - Tool Dispatch

    /// Call a tool by name with the given arguments dictionary.
    func callTool(name: String, arguments: [String: Any]) throws -> [String: Any] {
        let resultData: Any
        switch name {
        case "get_recent_sessions":
            resultData = try getRecentSessions(arguments: arguments)
        case "get_active_tasks":
            resultData = try getActiveTasks(arguments: arguments)
        case "get_patterns":
            resultData = try getPatterns(arguments: arguments)
        case "get_codebase_snapshot":
            resultData = try getCodebaseSnapshot(arguments: arguments)
        case "search_sessions":
            resultData = try searchSessions(arguments: arguments)
        case "get_session_detail":
            resultData = try getSessionDetail(arguments: arguments)
        default:
            throw MCPError.unknownTool(name)
        }

        // Wrap in MCP content format
        let jsonData = try JSONSerialization.data(withJSONObject: resultData, options: [.prettyPrinted, .sortedKeys])
        let jsonString = String(data: jsonData, encoding: .utf8) ?? "null"
        return [
            "content": [
                ["type": "text", "text": jsonString]
            ]
        ]
    }

    // MARK: - Tool Implementations

    private func getRecentSessions(arguments: [String: Any]) throws -> [[String: Any]] {
        guard let projectPath = arguments["project_path"] as? String else {
            throw MCPError.missingParameter("project_path")
        }
        let limit = arguments["limit"] as? Int ?? 5
        let project = try findProject(byPath: projectPath)

        guard let dbQueue = db.dbQueue else {
            throw MCPError.databaseError("Database not initialized")
        }

        let sessions: [Session] = try dbQueue.read { db in
            try Session
                .filter(Session.Columns.projectId == project.id)
                .order(Session.Columns.startedAt.desc)
                .limit(limit)
                .fetchAll(db)
        }

        return sessions.map { sessionToDict($0) }
    }

    private func getActiveTasks(arguments: [String: Any]) throws -> [[String: Any]] {
        guard let projectPath = arguments["project_path"] as? String else {
            throw MCPError.missingParameter("project_path")
        }
        let project = try findProject(byPath: projectPath)

        guard let dbQueue = db.dbQueue else {
            throw MCPError.databaseError("Database not initialized")
        }

        let tasks: [TaskItem] = try dbQueue.read { db in
            try TaskItem
                .filter(Column("projectId") == project.id)
                .filter(Column("status") != "done")
                .order(Column("priority").desc, Column("createdAt").desc)
                .fetchAll(db)
        }

        return tasks.map { task in
            var dict: [String: Any] = [
                "title": task.title,
                "status": task.status,
                "source": task.source
            ]
            if let desc = task.description {
                dict["description"] = desc
            }
            return dict
        }
    }

    private func getPatterns(arguments: [String: Any]) throws -> [[String: Any]] {
        guard let projectPath = arguments["project_path"] as? String else {
            throw MCPError.missingParameter("project_path")
        }
        let category = arguments["category"] as? String
        let project = try findProject(byPath: projectPath)

        guard let dbQueue = db.dbQueue else {
            throw MCPError.databaseError("Database not initialized")
        }

        let patterns: [Pattern] = try dbQueue.read { db in
            var request = Pattern
                .filter(Column("projectId") == project.id)
            if let category = category {
                request = request.filter(Column("category") == category)
            }
            return try request
                .order(Column("category"), Column("createdAt").desc)
                .fetchAll(db)
        }

        return patterns.map { pattern in
            [
                "category": pattern.category,
                "title": pattern.title,
                "description": pattern.description
            ]
        }
    }

    private func getCodebaseSnapshot(arguments: [String: Any]) throws -> [String: Any] {
        guard let projectPath = arguments["project_path"] as? String else {
            throw MCPError.missingParameter("project_path")
        }
        let project = try findProject(byPath: projectPath)

        guard let dbQueue = db.dbQueue else {
            throw MCPError.databaseError("Database not initialized")
        }

        let snapshot: CodebaseSnapshot? = try dbQueue.read { db in
            try CodebaseSnapshot
                .filter(Column("projectId") == project.id)
                .order(Column("capturedAt").desc)
                .fetchOne(db)
        }

        guard let snapshot = snapshot else {
            return ["message": "No codebase snapshot available for this project"]
        }

        let formatter = ISO8601DateFormatter()
        var dict: [String: Any] = [
            "captured_at": formatter.string(from: snapshot.capturedAt)
        ]
        if let fileTree = snapshot.fileTree {
            dict["file_tree"] = fileTree
        }
        if let schemaHash = snapshot.schemaHash {
            dict["schema_hash"] = schemaHash
        }
        if let keySymbols = snapshot.keySymbols {
            dict["key_symbols"] = keySymbols
        }
        if let profileText = snapshot.profileText {
            dict["project_profile"] = profileText
        }
        return dict
    }

    private func searchSessions(arguments: [String: Any]) throws -> [[String: Any]] {
        guard let projectPath = arguments["project_path"] as? String else {
            throw MCPError.missingParameter("project_path")
        }
        guard let query = arguments["query"] as? String else {
            throw MCPError.missingParameter("query")
        }
        let project = try findProject(byPath: projectPath)

        guard let dbQueue = db.dbQueue else {
            throw MCPError.databaseError("Database not initialized")
        }

        let sessions: [Session] = try dbQueue.read { db in
            try Session
                .filter(Session.Columns.projectId == project.id)
                .filter(Session.Columns.summary.like("%\(query)%"))
                .order(Session.Columns.startedAt.desc)
                .fetchAll(db)
        }

        return sessions.map { sessionToDict($0) }
    }

    private func getSessionDetail(arguments: [String: Any]) throws -> [String: Any] {
        guard let sessionId = arguments["session_id"] as? String else {
            throw MCPError.missingParameter("session_id")
        }

        guard let dbQueue = db.dbQueue else {
            throw MCPError.databaseError("Database not initialized")
        }

        let session: Session? = try dbQueue.read { db in
            try Session.fetchOne(db, key: sessionId)
        }

        guard let session = session else {
            throw MCPError.sessionNotFound(sessionId)
        }

        return sessionToDict(session)
    }

    // MARK: - Helpers

    private func findProject(byPath path: String) throws -> Project {
        guard let dbQueue = db.dbQueue else {
            throw MCPError.databaseError("Database not initialized")
        }

        let project: Project? = try dbQueue.read { db in
            try Project
                .filter(Project.Columns.path == path)
                .fetchOne(db)
        }

        guard let project = project else {
            throw MCPError.projectNotFound(path)
        }
        return project
    }

    private func sessionToDict(_ session: Session) -> [String: Any] {
        let formatter = ISO8601DateFormatter()
        var dict: [String: Any] = [
            "id": session.id,
            "messages": session.messageCount,
            "tools": session.toolUseCount
        ]
        if let slug = session.slug {
            dict["slug"] = slug
        }
        if let date = session.startedAt {
            dict["date"] = formatter.string(from: date)
        }
        if let branch = session.gitBranch {
            dict["branch"] = branch
        }
        if let summary = session.summary {
            dict["summary"] = summary
        }
        let files = session.filesChangedArray
        if !files.isEmpty {
            dict["files_changed"] = files
        }
        return dict
    }

    // MARK: - JSON-RPC Response Formatting

    private func jsonRPCSuccess(id: Any?, result: Any) -> String {
        var response: [String: Any] = [
            "jsonrpc": "2.0",
            "result": result
        ]
        if let id = id {
            response["id"] = id
        }
        guard let data = try? JSONSerialization.data(withJSONObject: response, options: []),
              let str = String(data: data, encoding: .utf8)
        else {
            return "{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32603,\"message\":\"Internal error\"}}"
        }
        return str
    }

    private func jsonRPCError(id: Any?, code: Int, message: String) -> String {
        var response: [String: Any] = [
            "jsonrpc": "2.0",
            "error": [
                "code": code,
                "message": message
            ]
        ]
        if let id = id {
            response["id"] = id
        }
        guard let data = try? JSONSerialization.data(withJSONObject: response, options: []),
              let str = String(data: data, encoding: .utf8)
        else {
            return "{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32603,\"message\":\"Internal error\"}}"
        }
        return str
    }

    // MARK: - Tool Definition Helpers

    private func toolDef(
        name: String,
        description: String,
        properties: [String: [String: Any]],
        required: [String]
    ) -> [String: Any] {
        return [
            "name": name,
            "description": description,
            "inputSchema": [
                "type": "object",
                "properties": properties,
                "required": required
            ]
        ]
    }

    private func propString(_ description: String) -> [String: Any] {
        return ["type": "string", "description": description]
    }

    private func propInt(_ description: String) -> [String: Any] {
        return ["type": "integer", "description": description]
    }
}

import Foundation
import GRDB
import WebKit

/// Observes the browserCommands table for pending commands from ContextMCP,
/// executes them against the WKWebView browser, and writes results back.
@MainActor
class BrowserCommandExecutor: ObservableObject {

    private let db: DatabaseService
    private weak var browserViewModel: BrowserViewModel?
    private var pollTimer: Timer?
    private var cleanupTimer: Timer?
    private var isProcessing = false

    init(db: DatabaseService = .shared) {
        self.db = db
    }

    /// Start polling for pending browser commands.
    /// Must be called after the BrowserViewModel is available.
    func start(browserViewModel: BrowserViewModel) {
        self.browserViewModel = browserViewModel
        startPolling()
        startCleanupTimer()
    }

    func stop() {
        pollTimer?.invalidate()
        pollTimer = nil
        cleanupTimer?.invalidate()
        cleanupTimer = nil
    }

    // MARK: - Polling

    private func startPolling() {
        // Poll every 100ms for pending commands from ContextMCP (cross-process writes)
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.pollForCommands()
            }
        }
    }

    private func pollForCommands() async {
        guard !isProcessing else { return }
        guard let dbQueue = db.dbQueue else { return }

        isProcessing = true
        defer { isProcessing = false }

        let commands: [BrowserCommand]
        do {
            commands = try await dbQueue.read { db in
                try BrowserCommand
                    .filter(Column("status") == "pending")
                    .order(Column("createdAt").asc)
                    .fetchAll(db)
            }
        } catch {
            print("BrowserCommandExecutor: poll error: \(error)")
            return
        }

        for command in commands {
            await execute(command)
        }
    }

    // MARK: - Command Dispatch

    private func execute(_ command: BrowserCommand) async {
        guard let dbQueue = db.dbQueue else { return }

        // Mark as executing
        var cmd = command
        cmd.status = "executing"
        updateCommand(&cmd, in: dbQueue)

        do {
            let result = try await dispatch(cmd)
            cmd.status = "completed"
            cmd.result = result
            cmd.completedAt = Date()
        } catch {
            cmd.status = "error"
            cmd.result = error.localizedDescription
            cmd.completedAt = Date()
        }

        updateCommand(&cmd, in: dbQueue)
    }

    private func dispatch(_ command: BrowserCommand) async throws -> String {
        let args = parseArgs(command.args)

        switch command.tool {
        case "browser_navigate":
            return try await handleNavigate(args)
        case "browser_snapshot":
            return try await handleSnapshot(args)
        case "browser_extract":
            return try await handleExtract(args)
        case "browser_list_tabs":
            return try handleListTabs()
        case "browser_console_logs":
            return try handleConsoleLogs(args)
        case "browser_screenshot":
            return try await handleScreenshot(args)
        case "browser_tab_open":
            return try await handleTabOpen(args)
        case "browser_tab_close":
            return try handleTabClose(args)
        case "browser_tab_switch":
            return try handleTabSwitch(args)
        case "browser_click":
            return try await handleClick(args)
        case "browser_type":
            return try await handleType(args)
        case "browser_select":
            return try await handleSelect(args)
        case "browser_scroll":
            return try await handleScroll(args)
        case "browser_wait":
            return try await handleWait(args)
        default:
            throw BrowserCommandError.unknownTool(command.tool)
        }
    }

    // MARK: - Tool Handlers

    private func handleNavigate(_ args: [String: Any]) async throws -> String {
        guard let vm = browserViewModel else { throw BrowserCommandError.noBrowser }
        guard let url = args["url"] as? String else { throw BrowserCommandError.missingParam("url") }

        let tab: BrowserTab
        if let active = vm.activeTab {
            tab = active
        } else {
            tab = vm.openTab()
        }

        tab.navigate(to: url)

        // Wait for navigation to finish (poll isLoading)
        let start = Date()
        while tab.isLoading && Date().timeIntervalSince(start) < 14.0 {
            try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        }

        return toJSON([
            "url": tab.currentURL,
            "title": tab.title,
            "status": tab.isLoading ? "loading" : "loaded"
        ])
    }

    private func handleSnapshot(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        let tree = try await tab.snapshotAccessibilityTree()
        return tree
    }

    private func handleExtract(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        guard let selector = args["selector"] as? String else {
            throw BrowserCommandError.missingParam("selector")
        }
        let (text, found) = try await tab.extractText(selector: selector)
        return toJSON([
            "found": found,
            "text": text as Any
        ])
    }

    private func handleListTabs() throws -> String {
        guard let vm = browserViewModel else { throw BrowserCommandError.noBrowser }
        let info = vm.tabsInfo()
        guard let data = try? JSONSerialization.data(withJSONObject: info),
              let str = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return str
    }

    private func handleConsoleLogs(_ args: [String: Any]) throws -> String {
        let tab = try resolveTab(args)
        let levelFilter = args["level"] as? String
        var logs = tab.consoleLogs
        if let level = levelFilter {
            logs = logs.filter { $0.level == level }
        }

        let entries: [[String: Any]] = logs.map { log in
            [
                "level": log.level,
                "message": log.message,
                "timestamp": ISO8601DateFormatter().string(from: log.timestamp)
            ]
        }

        guard let data = try? JSONSerialization.data(withJSONObject: entries),
              let str = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return str
    }

    private func handleScreenshot(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        let (path, width, height) = try await tab.takeScreenshot()

        return toJSON([
            "path": path,
            "width": width,
            "height": height
        ])
    }

    private func handleTabOpen(_ args: [String: Any]) async throws -> String {
        guard let vm = browserViewModel else { throw BrowserCommandError.noBrowser }
        let url = args["url"] as? String
        let tab = vm.openTab(url: url)

        // If URL was provided, wait for load
        if url != nil {
            let start = Date()
            while tab.isLoading && Date().timeIntervalSince(start) < 14.0 {
                try await Task.sleep(nanoseconds: 100_000_000)
            }
        }

        return toJSON([
            "tab_id": tab.id.uuidString,
            "title": tab.title,
            "url": tab.currentURL
        ])
    }

    private func handleTabClose(_ args: [String: Any]) throws -> String {
        guard let vm = browserViewModel else { throw BrowserCommandError.noBrowser }
        guard let tabId = args["tab_id"] as? String else {
            throw BrowserCommandError.missingParam("tab_id")
        }

        let closed = vm.closeTabById(tabId)
        return toJSON([
            "closed": closed,
            "remaining_tabs": vm.tabs.count
        ])
    }

    private func handleTabSwitch(_ args: [String: Any]) throws -> String {
        guard let vm = browserViewModel else { throw BrowserCommandError.noBrowser }
        guard let tabId = args["tab_id"] as? String else {
            throw BrowserCommandError.missingParam("tab_id")
        }

        let switched = vm.switchTab(to: tabId)
        if switched, let tab = vm.activeTab {
            return toJSON([
                "active_tab": tab.id.uuidString,
                "title": tab.title,
                "url": tab.currentURL
            ])
        } else {
            throw BrowserCommandError.tabNotFound(tabId)
        }
    }

    // MARK: - Phase 2: Interaction Handlers

    private func handleClick(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        guard let ref = args["ref"] as? String else {
            throw BrowserCommandError.missingParam("ref")
        }
        let result = try await tab.clickElement(ref: ref)
        if let error = result["error"] as? String, error == "not_found" {
            throw BrowserCommandError.refNotFound(ref)
        }
        return toJSON(result)
    }

    private func handleType(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        guard let ref = args["ref"] as? String else {
            throw BrowserCommandError.missingParam("ref")
        }
        guard let text = args["text"] as? String else {
            throw BrowserCommandError.missingParam("text")
        }
        let clear = args["clear"] as? Bool ?? true
        let result = try await tab.typeText(ref: ref, text: text, clear: clear)
        if let error = result["error"] as? String {
            if error == "not_found" { throw BrowserCommandError.refNotFound(ref) }
            if error == "not_typeable" {
                let tag = result["tag"] as? String ?? "unknown"
                throw MCPBrowserError.notTypeable(ref: ref, tag: tag)
            }
        }
        return toJSON(result)
    }

    private func handleSelect(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        guard let ref = args["ref"] as? String else {
            throw BrowserCommandError.missingParam("ref")
        }
        let value = args["value"] as? String
        let label = args["label"] as? String
        guard value != nil || label != nil else {
            throw BrowserCommandError.missingParam("value or label")
        }
        let result = try await tab.selectOption(ref: ref, value: value, label: label)
        if let error = result["error"] as? String {
            if error == "not_found" { throw BrowserCommandError.refNotFound(ref) }
            if error == "not_select" {
                let tag = result["tag"] as? String ?? "unknown"
                throw MCPBrowserError.notSelect(ref: ref, tag: tag)
            }
            // no_match returns available options — pass through as result, not error
        }
        return toJSON(result)
    }

    private func handleScroll(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        let ref = args["ref"] as? String
        let direction = args["direction"] as? String
        let amount = args["amount"] as? Int
        let result = try await tab.scrollPage(ref: ref, direction: direction, amount: amount)
        if let error = result["error"] as? String, error == "not_found" {
            throw BrowserCommandError.refNotFound(ref ?? "unknown")
        }
        return toJSON(result)
    }

    private func handleWait(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        let ref = args["ref"] as? String
        let selector = args["selector"] as? String
        let timeout = args["timeout"] as? Int ?? 5
        let result = try await tab.waitForElement(ref: ref, selector: selector, timeout: timeout)
        if let error = result["error"] as? String, error == "missing_param" {
            throw BrowserCommandError.missingParam("ref or selector")
        }
        return toJSON(result)
    }

    // MARK: - Helpers

    private func resolveTab(_ args: [String: Any]) throws -> BrowserTab {
        guard let vm = browserViewModel else { throw BrowserCommandError.noBrowser }
        if let tabId = args["tab_id"] as? String {
            guard let tab = vm.tab(byId: tabId) else {
                throw BrowserCommandError.tabNotFound(tabId)
            }
            return tab
        }
        guard let tab = vm.activeTab else {
            throw BrowserCommandError.noActiveTab
        }
        return tab
    }

    private func updateCommand(_ cmd: inout BrowserCommand, in dbQueue: DatabaseQueue) {
        try? dbQueue.write { db in try cmd.update(db) }
    }

    private func parseArgs(_ argsJSON: String?) -> [String: Any] {
        guard let json = argsJSON,
              let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return dict
    }

    private func toJSON(_ dict: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let str = String(data: data, encoding: .utf8)
        else { return "{}" }
        return str
    }

    // MARK: - Cleanup

    private func startCleanupTimer() {
        cleanupTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.cleanupOldCommands()
            }
        }
    }

    private func cleanupOldCommands() {
        guard let dbQueue = db.dbQueue else { return }
        let cutoff = Date().addingTimeInterval(-3600) // 1 hour ago
        _ = try? dbQueue.write { db in
            try BrowserCommand
                .filter(Column("status") == "completed" || Column("status") == "error")
                .filter(Column("completedAt") < cutoff)
                .deleteAll(db)
        }
    }
}

// MARK: - BrowserCommand Model (GUI side)

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

// MARK: - Errors

enum BrowserCommandError: LocalizedError {
    case noBrowser
    case noActiveTab
    case tabNotFound(String)
    case missingParam(String)
    case unknownTool(String)
    case refNotFound(String)

    var errorDescription: String? {
        switch self {
        case .noBrowser:
            return "Browser is not available. Make sure a project window with the browser tab is open in Context.app."
        case .noActiveTab:
            return "No active browser tab. Use browser_tab_open to open a tab first."
        case .tabNotFound(let id):
            return "Tab '\(id)' not found. Use browser_list_tabs to see available tabs."
        case .missingParam(let name):
            return "Missing required parameter: \(name)"
        case .unknownTool(let name):
            return "Unknown browser tool: \(name)"
        case .refNotFound(let ref):
            return "Element with ref '\(ref)' not found. The page may have changed — use browser_snapshot to get fresh refs."
        }
    }
}

enum MCPBrowserError: LocalizedError {
    case notTypeable(ref: String, tag: String)
    case notSelect(ref: String, tag: String)

    var errorDescription: String? {
        switch self {
        case .notTypeable(let ref, let tag):
            return "Element '\(ref)' (\(tag)) is not a text input. Target an INPUT, TEXTAREA, or contenteditable element."
        case .notSelect(let ref, let tag):
            return "Element '\(ref)' (\(tag)) is not a <select> element."
        }
    }
}

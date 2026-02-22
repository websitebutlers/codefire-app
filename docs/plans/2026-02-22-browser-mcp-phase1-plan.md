# Browser MCP Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 9 read-only browser MCP tools to ContextMCP, enabling Claude Code to navigate, read, and inspect pages in Context's built-in WKWebView browser.

**Architecture:** ContextMCP writes browser commands to a shared SQLite table. The GUI app observes new rows via GRDB ValueObservation, executes JavaScript on the WKWebView, and writes results back. ContextMCP polls for results with a 50ms interval and 15s timeout.

**Tech Stack:** Swift 5.9, GRDB 7.0, WKWebView, WKContentWorld.defaultClient, callAsyncJavaScript

**Design doc:** `docs/plans/2026-02-22-browser-mcp-phase1-design.md`

---

### Task 1: Database Migration — browserCommands Table

**Files:**
- Modify: `Context/Sources/Context/Services/DatabaseService.swift:281` (before `return migrator`)

**Step 1: Add the migration**

Insert before line 282 (`return migrator`):

```swift
migrator.registerMigration("v14_createBrowserCommands") { db in
    try db.create(table: "browserCommands") { t in
        t.autoIncrementedPrimaryKey("id")
        t.column("tool", .text).notNull()
        t.column("args", .text)
        t.column("status", .text).notNull().defaults(to: "pending")
        t.column("result", .text)
        t.column("createdAt", .datetime).notNull()
        t.column("completedAt", .datetime)
    }
}
```

**Step 2: Build to verify migration compiles**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Services/DatabaseService.swift
git commit -m "feat: add browserCommands table migration (v14)"
```

---

### Task 2: BrowserCommand Model in ContextMCP

**Files:**
- Modify: `Context/Sources/ContextMCP/main.swift:88` (after the `Client` struct, before `// MARK: - MCP Protocol Types`)

**Step 1: Add the BrowserCommand model**

Insert after line 88 (after the `Client` struct closing brace):

```swift
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
```

**Step 2: Add the executeBrowserCommand helper**

Insert before the `// MARK: - JSON-RPC Helpers` section (around line 1081):

```swift
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
```

**Step 3: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add Context/Sources/ContextMCP/main.swift
git commit -m "feat: add BrowserCommand model and executeBrowserCommand helper"
```

---

### Task 3: Browser Tool Definitions and Handlers in ContextMCP

**Files:**
- Modify: `Context/Sources/ContextMCP/main.swift`
  - `toolDefinitions()` method (line 324) — add 9 new tool defs to the array
  - `handleToolCall` switch (line 532) — add 9 new cases

**Step 1: Add tool definitions**

Append to the array returned by `toolDefinitions()`, before the closing `]` (around line 518):

```swift
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
```

**Step 2: Add handler cases**

In the `handleToolCall` switch statement (around line 532), add cases before the `default`:

```swift
case "browser_navigate":   result = try browserNavigate(args)
case "browser_snapshot":    result = try browserSnapshot(args)
case "browser_extract":     result = try browserExtract(args)
case "browser_list_tabs":   result = try browserListTabs(args)
case "browser_console_logs": result = try browserConsoleLogs(args)
case "browser_screenshot":  result = try browserScreenshot(args)
case "browser_tab_open":    result = try browserTabOpen(args)
case "browser_tab_close":   result = try browserTabClose(args)
case "browser_tab_switch":  result = try browserTabSwitch(args)
```

**Step 3: Add handler implementations**

Add before the `// MARK: - Browser Command Execution` section:

```swift
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
```

**Step 4: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add Context/Sources/ContextMCP/main.swift
git commit -m "feat: add 9 browser MCP tool definitions and handlers"
```

---

### Task 4: BrowserViewModel Enhancements

**Files:**
- Modify: `Context/Sources/Context/Views/Browser/BrowserViewModel.swift`

**Step 1: Add tab lookup and external management methods**

Add after the existing `closeTab` method (after line 32):

```swift
/// Find a tab by its UUID string.
func tab(byId idString: String) -> BrowserTab? {
    guard let uuid = UUID(uuidString: idString) else { return nil }
    return tabs.first { $0.id == uuid }
}

/// Open a new tab and optionally navigate to a URL. Returns the new tab.
@discardableResult
func openTab(url: String? = nil) -> BrowserTab {
    let tab = BrowserTab()
    tabs.append(tab)
    activeTabId = tab.id

    // Forward tab property changes
    tab.objectWillChange
        .sink { [weak self] _ in
            self?.objectWillChange.send()
        }
        .store(in: &cancellables)

    if let url = url, !url.isEmpty {
        tab.navigate(to: url)
    }
    return tab
}

/// Switch active tab by UUID string. Returns true if found.
@discardableResult
func switchTab(to idString: String) -> Bool {
    guard let uuid = UUID(uuidString: idString) else { return false }
    guard tabs.contains(where: { $0.id == uuid }) else { return false }
    activeTabId = uuid
    return true
}

/// Close tab by UUID string. Returns true if found and closed.
@discardableResult
func closeTabById(_ idString: String) -> Bool {
    guard let uuid = UUID(uuidString: idString) else { return false }
    guard tabs.contains(where: { $0.id == uuid }) else { return false }
    closeTab(uuid)
    return true
}

/// Serialize all tabs to a JSON-compatible array.
func tabsInfo() -> [[String: Any]] {
    tabs.map { tab in
        [
            "id": tab.id.uuidString,
            "title": tab.title,
            "url": tab.currentURL,
            "isActive": tab.id == activeTabId,
            "isLoading": tab.isLoading
        ] as [String: Any]
    }
}
```

**Step 2: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Browser/BrowserViewModel.swift
git commit -m "feat: add tab lookup and management methods to BrowserViewModel"
```

---

### Task 5: BrowserTab Accessibility Tree and Extract Methods

**Files:**
- Modify: `Context/Sources/Context/Views/Browser/BrowserTab.swift`

**Step 1: Add the accessibility tree serializer JS constant and methods**

Add after the `navigate(to:)` method (after line 152), before `// MARK: - WKScriptMessageHandler`:

```swift
// MARK: - Automation Methods

/// Serialize the page's accessibility tree into compact structured text for LLM consumption.
/// Runs in .defaultClient content world (invisible to page JS, bypasses CSP).
@MainActor
func snapshotAccessibilityTree() async throws -> String {
    let js = Self.accessibilityTreeJS
    return try await withCheckedThrowingContinuation { continuation in
        webView.callAsyncJavaScript(
            js,
            arguments: [:],
            in: nil,
            in: .defaultClient
        ) { result in
            switch result {
            case .success(let value):
                continuation.resume(returning: value as? String ?? "- document\n  (empty page)")
            case .failure(let error):
                continuation.resume(throwing: error)
            }
        }
    }
}

/// Extract text content from an element by CSS selector.
@MainActor
func extractText(selector: String) async throws -> (text: String?, found: Bool) {
    let js = """
        const el = document.querySelector(selector);
        if (!el) return { found: false, text: null };
        return { found: true, text: el.textContent.trim() };
    """
    return try await withCheckedThrowingContinuation { continuation in
        webView.callAsyncJavaScript(
            js,
            arguments: ["selector": selector],
            in: nil,
            in: .defaultClient
        ) { result in
            switch result {
            case .success(let value):
                if let dict = value as? [String: Any] {
                    let found = dict["found"] as? Bool ?? false
                    let text = dict["text"] as? String
                    continuation.resume(returning: (text, found))
                } else {
                    continuation.resume(returning: (nil, false))
                }
            case .failure(let error):
                continuation.resume(throwing: error)
            }
        }
    }
}

/// Take a snapshot screenshot and return the saved file path.
@MainActor
func takeScreenshot() async throws -> (path: String, width: Int, height: Int) {
    let config = WKSnapshotConfiguration()
    let image = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<NSImage, Error>) in
        webView.takeSnapshot(with: config) { image, error in
            if let error = error {
                continuation.resume(throwing: error)
            } else if let image = image {
                continuation.resume(returning: image)
            } else {
                continuation.resume(throwing: NSError(domain: "BrowserTab", code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Screenshot returned nil"]))
            }
        }
    }

    guard let tiffData = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let pngData = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "BrowserTab", code: -2,
            userInfo: [NSLocalizedDescriptionKey: "Failed to convert screenshot to PNG"])
    }

    let dir = FileManager.default.urls(
        for: .applicationSupportDirectory, in: .userDomainMask
    ).first!.appendingPathComponent("Context/browser-screenshots", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

    let filename = "screenshot-\(ISO8601DateFormatter().string(from: Date())).png"
        .replacingOccurrences(of: ":", with: "-")
    let fileURL = dir.appendingPathComponent(filename)
    try pngData.write(to: fileURL)

    return (fileURL.path, Int(image.size.width), Int(image.size.height))
}

// MARK: - Accessibility Tree JS

private static let accessibilityTreeJS = """
(function() {
    let rc = 1;
    const rm = new WeakMap();
    const ir = {
        'A': (e) => e.href ? 'link' : null,
        'BUTTON': () => 'button',
        'INPUT': (e) => {
            const m = {'checkbox':'checkbox','radio':'radio','range':'slider',
                'number':'spinbutton','search':'searchbox','submit':'button',
                'reset':'button','button':'button'};
            return m[e.type.toLowerCase()] || 'textbox';
        },
        'SELECT': () => 'combobox', 'TEXTAREA': () => 'textbox',
        'NAV': () => 'navigation', 'MAIN': () => 'main',
        'HEADER': () => 'banner', 'FOOTER': () => 'contentinfo',
        'ASIDE': () => 'complementary', 'SECTION': () => 'region',
        'ARTICLE': () => 'article', 'FORM': () => 'form',
        'TABLE': () => 'table', 'UL': () => 'list', 'OL': () => 'list',
        'LI': () => 'listitem',
        'H1':()=>'heading','H2':()=>'heading','H3':()=>'heading',
        'H4':()=>'heading','H5':()=>'heading','H6':()=>'heading',
        'IMG': () => 'img', 'DIALOG': () => 'dialog'
    };
    const ia = new Set(['button','link','textbox','searchbox','checkbox','radio',
        'combobox','listbox','slider','spinbutton','switch','tab',
        'menuitem','option','treeitem']);
    const sa = new Set(['banner','navigation','main','contentinfo','complementary',
        'region','form','dialog','heading','list','listitem','table','row','cell',
        'article','group','img']);
    function gr(e) {
        const x = e.getAttribute('role');
        if (x) return x;
        const f = ir[e.tagName];
        return f ? f(e) : null;
    }
    function gn(e) {
        const lb = e.getAttribute('aria-labelledby');
        if (lb) {
            const n = lb.split(' ').map(i => document.getElementById(i)?.textContent?.trim()).filter(Boolean);
            if (n.length) return n.join(' ');
        }
        const al = e.getAttribute('aria-label');
        if (al) return al.trim();
        if (e.id) { const l = document.querySelector('label[for=\"'+e.id+'\"]'); if (l) return l.textContent.trim(); }
        if (e.title) return e.title.trim();
        if (e.alt) return e.alt.trim();
        if (e.placeholder) return e.placeholder.trim();
        const t = e.textContent?.trim().replace(/\\s+/g, ' ') ?? '';
        return t.length > 80 ? t.slice(0, 77) + '...' : t;
    }
    function ih(e) {
        if (e.getAttribute('aria-hidden') === 'true') return true;
        const s = window.getComputedStyle(e);
        return s.display === 'none' || s.visibility === 'hidden' || e.hidden;
    }
    function grf(e) {
        if (!rm.has(e)) { const r = 'e' + rc++; rm.set(e, r); e.setAttribute('data-ax-ref', r); }
        return rm.get(e);
    }
    function ga(e) {
        const a = [];
        if (e.tagName && e.tagName.match(/^H[1-6]$/)) a.push('level=' + e.tagName[1]);
        if (e.checked) a.push('checked');
        if (e.getAttribute('aria-expanded')) a.push('expanded=' + e.getAttribute('aria-expanded'));
        if (e.getAttribute('aria-selected') === 'true') a.push('selected');
        if (e.disabled) a.push('disabled');
        if (document.activeElement === e) a.push('focused');
        if (e.value && ia.has(gr(e))) a.push('value=\"' + e.value.slice(0,30) + '\"');
        return a;
    }
    function sn(e, d) {
        if (ih(e)) return '';
        const r = gr(e);
        const show = r && (ia.has(r) || sa.has(r));
        if (!show) return sc(e, d);
        const ind = '  '.repeat(d);
        const nm = gn(e);
        const ref = ia.has(r) ? ' [ref=' + grf(e) + ']' : '';
        const at = ga(e);
        const as2 = at.length ? ' [' + at.join(', ') + ']' : '';
        const ns = nm ? ' \"' + nm + '\"' : '';
        return ind + '- ' + r + ns + ref + as2 + '\\n' + sc(e, d + 1);
    }
    function sc(e, d) {
        let o = '';
        const roots = [e];
        if (e.shadowRoot) roots.push(e.shadowRoot);
        for (const root of roots)
            for (const c of root.children)
                o += sn(c, d);
        return o;
    }
    return '- document\\n' + sc(document.body, 1);
})()
"""
```

**Step 2: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Browser/BrowserTab.swift
git commit -m "feat: add accessibility tree snapshot, extract, and screenshot methods to BrowserTab"
```

---

### Task 6: BrowserCommandExecutor Service

**Files:**
- Create: `Context/Sources/Context/Services/BrowserCommandExecutor.swift`

This is the core new component — the bridge between the SQLite command table and the WKWebView.

**Step 1: Create the file**

```swift
import Foundation
import GRDB
import WebKit

/// Observes the browserCommands table for pending commands from ContextMCP,
/// executes them against the WKWebView browser, and writes results back.
@MainActor
class BrowserCommandExecutor: ObservableObject {

    private let db: DatabaseService
    private weak var browserViewModel: BrowserViewModel?
    private var observation: AnyDatabaseCancellable?
    private var cleanupTimer: Timer?

    init(db: DatabaseService = .shared) {
        self.db = db
    }

    /// Start observing for pending browser commands.
    /// Must be called after the BrowserViewModel is available.
    func start(browserViewModel: BrowserViewModel) {
        self.browserViewModel = browserViewModel
        startObservation()
        startCleanupTimer()
    }

    func stop() {
        observation?.cancel()
        observation = nil
        cleanupTimer?.invalidate()
        cleanupTimer = nil
    }

    // MARK: - Observation

    private func startObservation() {
        guard let dbQueue = db.dbQueue else { return }

        let observation = ValueObservation.tracking { db in
            try BrowserCommand
                .filter(Column("status") == "pending")
                .order(Column("createdAt").asc)
                .fetchAll(db)
        }

        self.observation = observation.start(
            in: dbQueue,
            scheduling: .immediate,
            onError: { error in
                print("BrowserCommandExecutor: observation error: \(error)")
            },
            onChange: { [weak self] commands in
                guard let self = self else { return }
                Task { @MainActor in
                    for command in commands {
                        await self.execute(command)
                    }
                }
            }
        )
    }

    // MARK: - Command Dispatch

    private func execute(_ command: BrowserCommand) async {
        guard let dbQueue = db.dbQueue else { return }

        // Mark as executing
        var cmd = command
        cmd.status = "executing"
        try? dbQueue.write { db in try cmd.update(db) }

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

        try? dbQueue.write { db in try cmd.update(db) }
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

        // Also save to browserScreenshots table if we have a project context
        // (not critical — skip if no project)

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
            self?.cleanupOldCommands()
        }
    }

    private func cleanupOldCommands() {
        guard let dbQueue = db.dbQueue else { return }
        let cutoff = Date().addingTimeInterval(-3600) // 1 hour ago
        try? dbQueue.write { db in
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
        }
    }
}
```

**Step 2: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Services/BrowserCommandExecutor.swift
git commit -m "feat: add BrowserCommandExecutor service for MCP-to-WKWebView bridge"
```

---

### Task 7: Wire Up BrowserCommandExecutor in GUIPanelView

**Files:**
- Modify: `Context/Sources/Context/Views/GUIPanelView.swift:83` (where browserViewModel is created)

**Step 1: Add the executor as a StateObject and start it**

At line 83 in `GUIPanelView`, after `@StateObject private var browserViewModel = BrowserViewModel()`, add:

```swift
@StateObject private var browserCommandExecutor = BrowserCommandExecutor()
```

At line 193, change the existing `.onAppear`:

```swift
.onAppear {
    mcpMonitor.startPolling()
    browserCommandExecutor.start(browserViewModel: browserViewModel)
}
.onDisappear {
    mcpMonitor.stopPolling()
    browserCommandExecutor.stop()
}
```

(This replaces the existing `.onAppear` and `.onDisappear` on lines 193-194.)

**Step 2: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/GUIPanelView.swift
git commit -m "feat: wire BrowserCommandExecutor into GUIPanelView lifecycle"
```

---

### Task 8: Build, Run, and Manual Integration Test

**Step 1: Full build**

Run: `cd Context && swift build 2>&1 | tail -10`
Expected: Build succeeds with no errors

**Step 2: Test the MCP tool listing**

Run the ContextMCP binary and send an initialize + tools/list request:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | /Users/nicknorris/Documents/claude-code-projects/claude-context-tool/Context/.build/debug/ContextMCP 2>/dev/null
```

Expected: JSON response containing all 26 tools including `browser_navigate`, `browser_snapshot`, etc.

**Step 3: Verify the migration runs**

Launch Context.app (or run the GUI binary). Check that the `browserCommands` table exists:

```bash
sqlite3 ~/Library/Application\ Support/Context/context.db ".tables" | tr ' ' '\n' | sort
```

Expected: `browserCommands` appears in the table list

**Step 4: Test a browser command end-to-end**

With Context.app running and a browser tab open, send a command via the MCP binary:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"browser_list_tabs","arguments":{}}}' | /Users/nicknorris/Documents/claude-code-projects/claude-context-tool/Context/.build/debug/ContextMCP 2>/dev/null
```

Expected: JSON response with tab info (or timeout error if no tabs are open — which confirms the round-trip path works)

**Step 5: Commit final state**

```bash
git add -A
git commit -m "feat: browser MCP Phase 1 complete — 9 read-only browser tools via shared SQLite IPC"
```

---

## File Summary

| File | Action | ~Lines |
|------|--------|--------|
| `Context/Sources/Context/Services/DatabaseService.swift` | Modify | +10 |
| `Context/Sources/ContextMCP/main.swift` | Modify | +200 |
| `Context/Sources/Context/Views/Browser/BrowserTab.swift` | Modify | +160 |
| `Context/Sources/Context/Views/Browser/BrowserViewModel.swift` | Modify | +45 |
| `Context/Sources/Context/Services/BrowserCommandExecutor.swift` | Create | +280 |
| `Context/Sources/Context/Views/GUIPanelView.swift` | Modify | +5 |
| **Total** | | **~700** |

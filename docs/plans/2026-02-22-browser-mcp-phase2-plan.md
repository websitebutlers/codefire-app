# Browser MCP Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 5 browser interaction tools (click, type, select, scroll, wait) to the existing 9 read-only browser MCP tools.

**Architecture:** Same SQLite IPC as Phase 1 — ContextMCP inserts command rows, GUI-side BrowserCommandExecutor polls and dispatches to BrowserTab JS methods, writes results back. No schema changes, no new dependencies.

**Tech Stack:** Swift, GRDB, WKWebView `callAsyncJavaScript`, JavaScript DOM APIs

**Design doc:** `docs/plans/2026-02-22-browser-mcp-phase2-design.md`

---

### Task 1: Add `browser_click` to BrowserTab

Add a JS-powered click method to `BrowserTab.swift` that finds an element by `data-ax-ref`, scrolls it into view, and dispatches a click.

**Files:**
- Modify: `Context/Sources/Context/Views/Browser/BrowserTab.swift` (after `extractText` method, ~line 207)

**Step 1: Add the `clickElement` method**

Insert after the closing `}` of `extractText(selector:)` (line 207), before `/// Take a snapshot screenshot`:

```swift
    /// Click an element identified by its data-ax-ref attribute.
    @MainActor
    func clickElement(ref: String) async throws -> [String: Any] {
        let js = """
            const el = document.querySelector('[data-ax-ref="' + ref + '"]');
            if (!el) return { error: "not_found" };
            el.scrollIntoView({block: 'center', behavior: 'instant'});
            el.focus();
            el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
            return { clicked: true, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 100) };
        """
        return try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(
                js,
                arguments: ["ref": ref],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    if let dict = value as? [String: Any] {
                        continuation.resume(returning: dict)
                    } else {
                        continuation.resume(returning: ["clicked": true])
                    }
                case .failure:
                    // Click may have triggered navigation, which kills the JS context
                    continuation.resume(returning: ["clicked": true, "navigated": true])
                }
            }
        }
    }
```

**Step 2: Build and verify**

Run: `swift build --package-path Context 2>&1 | tail -5`
Expected: `Build complete!`

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Browser/BrowserTab.swift
git commit -m "feat: add clickElement method to BrowserTab"
```

---

### Task 2: Add `browser_type` to BrowserTab

Add a method that types text into an input/textarea, using the React-compatible native value setter workaround.

**Files:**
- Modify: `Context/Sources/Context/Views/Browser/BrowserTab.swift` (after `clickElement` method)

**Step 1: Add the `typeText` method**

Insert after `clickElement`:

```swift
    /// Type text into an input or textarea element by ref. Uses native setter for React compatibility.
    @MainActor
    func typeText(ref: String, text: String, clear: Bool = true) async throws -> [String: Any] {
        let js = """
            const el = document.querySelector('[data-ax-ref="' + ref + '"]');
            if (!el) return { error: "not_found" };
            const tag = el.tagName;
            const editable = (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable);
            if (!editable) return { error: "not_typeable", tag: tag };

            el.focus();
            const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

            if (clear) {
                if (setter) setter.call(el, '');
                else el.value = '';
                el.dispatchEvent(new Event('input', {bubbles: true}));
            }

            if (setter) setter.call(el, text);
            else el.value = text;

            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
            return { typed: true, ref: ref, value: el.value };
        """
        return try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(
                js,
                arguments: ["ref": ref, "text": text, "clear": clear],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: value as? [String: Any] ?? ["typed": true])
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }
```

**Step 2: Build and verify**

Run: `swift build --package-path Context 2>&1 | tail -5`
Expected: `Build complete!`

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Browser/BrowserTab.swift
git commit -m "feat: add typeText method to BrowserTab"
```

---

### Task 3: Add `browser_select` to BrowserTab

Add a method that selects an option from a `<select>` dropdown by value or label.

**Files:**
- Modify: `Context/Sources/Context/Views/Browser/BrowserTab.swift` (after `typeText` method)

**Step 1: Add the `selectOption` method**

Insert after `typeText`:

```swift
    /// Select an option from a <select> element by value or visible label text.
    @MainActor
    func selectOption(ref: String, value: String?, label: String?) async throws -> [String: Any] {
        let js = """
            const el = document.querySelector('[data-ax-ref="' + ref + '"]');
            if (!el) return { error: "not_found" };
            if (el.tagName !== 'SELECT') return { error: "not_select", tag: el.tagName };

            const options = Array.from(el.options);
            let target;
            if (value) target = options.find(o => o.value === value);
            else if (label) target = options.find(o => o.text.trim() === label);

            if (!target) {
                return {
                    error: "no_match",
                    available: options.map(o => ({value: o.value, label: o.text.trim()}))
                };
            }

            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
            if (setter) setter.call(el, target.value);
            else el.value = target.value;

            el.dispatchEvent(new Event('change', {bubbles: true}));
            return { selected: true, value: target.value, label: target.text.trim() };
        """
        return try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(
                js,
                arguments: ["ref": ref, "value": value as Any, "label": label as Any],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: value as? [String: Any] ?? ["selected": true])
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }
```

**Step 2: Build and verify**

Run: `swift build --package-path Context 2>&1 | tail -5`
Expected: `Build complete!`

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Browser/BrowserTab.swift
git commit -m "feat: add selectOption method to BrowserTab"
```

---

### Task 4: Add `browser_scroll` to BrowserTab

Add a method that scrolls the page by direction/amount or scrolls an element into view by ref.

**Files:**
- Modify: `Context/Sources/Context/Views/Browser/BrowserTab.swift` (after `selectOption` method)

**Step 1: Add the `scrollPage` method**

Insert after `selectOption`:

```swift
    /// Scroll the page by direction/amount or scroll a specific element into view.
    @MainActor
    func scrollPage(ref: String?, direction: String?, amount: Int?) async throws -> [String: Any] {
        let js = """
            if (ref) {
                const el = document.querySelector('[data-ax-ref="' + ref + '"]');
                if (!el) return { error: "not_found" };
                el.scrollIntoView({block: 'center', behavior: 'instant'});
            } else {
                const amt = amount || 500;
                switch (direction) {
                    case 'down':  window.scrollBy(0, amt); break;
                    case 'up':    window.scrollBy(0, -amt); break;
                    case 'top':   window.scrollTo(0, 0); break;
                    case 'bottom': window.scrollTo(0, document.body.scrollHeight); break;
                }
            }
            return {
                scrolled: true,
                scrollY: Math.round(window.scrollY),
                scrollHeight: document.body.scrollHeight,
                viewportHeight: window.innerHeight
            };
        """
        return try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(
                js,
                arguments: [
                    "ref": ref as Any,
                    "direction": direction as Any,
                    "amount": amount as Any
                ],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: value as? [String: Any] ?? ["scrolled": true])
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }
```

**Step 2: Build and verify**

Run: `swift build --package-path Context 2>&1 | tail -5`
Expected: `Build complete!`

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Browser/BrowserTab.swift
git commit -m "feat: add scrollPage method to BrowserTab"
```

---

### Task 5: Add `browser_wait` to BrowserTab

Add a method that waits for an element to appear, using JS-side polling.

**Files:**
- Modify: `Context/Sources/Context/Views/Browser/BrowserTab.swift` (after `scrollPage` method)

**Step 1: Add the `waitForElement` method**

Insert after `scrollPage`:

```swift
    /// Wait for an element to appear in the DOM by ref or CSS selector.
    @MainActor
    func waitForElement(ref: String?, selector: String?, timeout: Int = 5) async throws -> [String: Any] {
        let js = """
            const maxMs = Math.min((timeout || 5), 15) * 1000;
            const query = ref ? '[data-ax-ref="' + ref + '"]' : selector;
            if (!query) return { error: "missing_param", message: "Provide ref or selector" };

            const start = Date.now();
            return new Promise((resolve) => {
                const check = () => {
                    if (document.querySelector(query)) {
                        resolve({ found: true, elapsed_ms: Date.now() - start });
                    } else if (Date.now() - start >= maxMs) {
                        resolve({ found: false, elapsed_ms: Date.now() - start });
                    } else {
                        setTimeout(check, 100);
                    }
                };
                check();
            });
        """
        // Wait tool needs a longer timeout on the Swift side to accommodate the JS polling
        let swiftTimeout = TimeInterval(min(timeout, 15)) + 2.0
        return try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(
                js,
                arguments: [
                    "ref": ref as Any,
                    "selector": selector as Any,
                    "timeout": timeout
                ],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: value as? [String: Any] ?? ["found": false])
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }
```

**Step 2: Build and verify**

Run: `swift build --package-path Context 2>&1 | tail -5`
Expected: `Build complete!`

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Browser/BrowserTab.swift
git commit -m "feat: add waitForElement method to BrowserTab"
```

---

### Task 6: Add 5 handler methods to BrowserCommandExecutor

Wire the 5 new BrowserTab methods into the command dispatch system.

**Files:**
- Modify: `Context/Sources/Context/Services/BrowserCommandExecutor.swift`

**Step 1: Add 5 new cases to `dispatch()` switch**

In `dispatch(_ command:)` (line 98), add before the `default:` case:

```swift
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
```

**Step 2: Add 5 handler methods**

Insert after `handleTabSwitch` (line 261), before `// MARK: - Helpers`:

```swift
    // MARK: - Phase 2: Interaction Handlers

    private func handleClick(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        guard let ref = args["ref"] as? String else {
            throw BrowserCommandError.missingParam("ref")
        }
        let result = try await tab.clickElement(ref: ref)
        if let error = result["error"] as? String {
            if error == "not_found" {
                throw BrowserCommandError.refNotFound(ref)
            }
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
            if error == "no_match" {
                // Return the available options as part of the result, not as an exception
                return toJSON(result)
            }
        }
        return toJSON(result)
    }

    private func handleScroll(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        let ref = args["ref"] as? String
        let direction = args["direction"] as? String
        let amount = args["amount"] as? Int
        let result = try await tab.scrollPage(ref: ref, direction: direction, amount: amount)
        if let error = result["error"] as? String {
            if error == "not_found" {
                let r = ref ?? "unknown"
                throw BrowserCommandError.refNotFound(r)
            }
        }
        return toJSON(result)
    }

    private func handleWait(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        let ref = args["ref"] as? String
        let selector = args["selector"] as? String
        let timeout = args["timeout"] as? Int ?? 5
        let result = try await tab.waitForElement(ref: ref, selector: selector, timeout: timeout)
        if let error = result["error"] as? String {
            if error == "missing_param" {
                throw BrowserCommandError.missingParam("ref or selector")
            }
        }
        return toJSON(result)
    }
```

**Step 3: Add new error cases**

Add to the `BrowserCommandError` enum (around line 339):

```swift
    case refNotFound(String)
```

And in the `errorDescription` computed property, add the case:

```swift
        case .refNotFound(let ref):
            return "Element with ref '\(ref)' not found. The page may have changed — use browser_snapshot to get fresh refs."
```

Also add a new error type for interaction-specific errors, after the `BrowserCommandError` enum:

```swift
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
```

**Step 4: Build and verify**

Run: `swift build --package-path Context 2>&1 | tail -5`
Expected: `Build complete!`

**Step 5: Commit**

```bash
git add Context/Sources/Context/Services/BrowserCommandExecutor.swift
git commit -m "feat: add click, type, select, scroll, wait handlers to BrowserCommandExecutor"
```

---

### Task 7: Add 5 tool definitions and handlers to ContextMCP

Register the 5 new tools in the MCP server and add wrapper functions.

**Files:**
- Modify: `Context/Sources/ContextMCP/main.swift`

**Step 1: Add 5 tool definitions to `toolDefinitions()`**

Find the end of the `browser_tab_switch` tool definition (around line 655) and add these 5 new definitions in the same array:

```swift
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
```

**Step 2: Add 5 handler cases to `handleToolCall`**

Find `case "browser_tab_switch"` (line 692) and add after it, before `default:`:

```swift
            case "browser_click":       result = try browserClick(args)
            case "browser_type":        result = try browserType(args)
            case "browser_select":      result = try browserSelect(args)
            case "browser_scroll":      result = try browserScroll(args)
            case "browser_wait":        result = try browserWait(args)
```

**Step 3: Add 5 wrapper functions**

Insert after `browserTabSwitch` (around line 1284), before `// MARK: - Browser Command Execution`:

```swift
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
        // Longer timeout: JS polls internally, so Swift timeout must exceed JS timeout
        let swiftTimeout = TimeInterval(min(timeout, 15)) + 3.0
        return try executeBrowserCommand(tool: "browser_wait", args: cmdArgs, timeout: swiftTimeout)
    }
```

**Step 4: Build and verify**

Run: `swift build --package-path Context 2>&1 | tail -5`
Expected: `Build complete!`

**Step 5: Commit**

```bash
git add Context/Sources/ContextMCP/main.swift
git commit -m "feat: add 5 browser interaction tool definitions and handlers to ContextMCP"
```

---

### Task 8: End-to-end testing

Test all 5 new tools against a real page.

**Files:** None (testing only)

**Step 1: Rebuild**

Run: `swift build --package-path Context 2>&1 | tail -5`
Expected: `Build complete!`

**Step 2: Relaunch Context.app**

Kill the current process and relaunch:

```bash
pkill -f '\.build/debug/Context$' ; sleep 2 ; open /path/to/Context/.build/debug/Context
```

Wait 3 seconds for the app to initialize.

**Step 3: Test browser_click**

Use the Python MCP test client pattern from Phase 1. Steps:

1. `browser_tab_open` with `url: "https://example.com"`
2. Wait 5s for SwiftUI to render
3. `browser_snapshot` to get refs (expect link "Learn more" with a ref like `e1`)
4. `browser_click` with `ref: "e1"` (the Learn more link)
5. Wait 2s for navigation
6. `browser_list_tabs` to confirm URL changed to `https://www.iana.org/help/example-domains`

Expected: Click succeeds, URL changes to the IANA page.

**Step 4: Test browser_type**

1. `browser_navigate` to `https://www.google.com`
2. `browser_snapshot` to find the search textbox ref
3. `browser_type` with the ref and text `"hello world"`
4. `browser_snapshot` again to verify the value shows in the textbox

Expected: Type succeeds, textbox value is "hello world".

**Step 5: Test browser_scroll**

1. Navigate to a long page (e.g. `https://en.wikipedia.org/wiki/Web_browser`)
2. `browser_scroll` with `direction: "down", amount: 1000`
3. Check returned `scrollY` is ~1000
4. `browser_scroll` with `direction: "top"`
5. Check returned `scrollY` is 0

Expected: Scroll succeeds with correct position reporting.

**Step 6: Test browser_wait**

1. Navigate to any page
2. `browser_wait` with `selector: "body"` (should resolve immediately)
3. Check `found: true` with low `elapsed_ms`
4. `browser_wait` with `selector: ".nonexistent"`, `timeout: 2`
5. Check `found: false` with `elapsed_ms` around 2000

Expected: Found elements resolve fast, missing elements timeout correctly.

**Step 7: Test browser_select**

1. Navigate to a page with a `<select>` element (or use `browser_navigate` to a test form)
2. `browser_snapshot` to find the select ref
3. `browser_select` with the ref and a value
4. Verify selection via snapshot

If no convenient select element is available, test with a known form page.

**Step 8: Test stale ref error**

1. `browser_snapshot` to get refs
2. `browser_navigate` to a different page (invalidates refs)
3. `browser_click` with an old ref
4. Verify error message mentions re-snapshotting

Expected: Clear error message about stale refs.

**Step 9: Commit test results**

If any fixes were needed during testing, commit them:

```bash
git add -A
git commit -m "fix: integration fixes from Phase 2 end-to-end testing"
```

# Browser MCP Phase 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 3 browser interaction tools — `browser_press` (keyboard events), `browser_eval` (JS execution), `browser_hover` (mouseover) — to the existing 14 MCP browser tools.

**Architecture:** Same SQLite IPC pattern as Phase 1 & 2. ContextMCP inserts command rows, GUI app polls and executes JS via `callAsyncJavaScript` in `.defaultClient` content world, writes results back. No schema changes, no new dependencies.

**Tech Stack:** Swift, WKWebView, GRDB, SQLite, JavaScript

---

### Task 1: Add `pressKey` method to BrowserTab

**Files:**
- Modify: `Context/Sources/Context/Views/Browser/BrowserTab.swift:416` (insert after `waitForElement` method, before `takeScreenshot`)

**Step 1: Add the method**

Insert after line 416 (closing brace of `waitForElement`) and before line 418 (`/// Take a snapshot screenshot`):

```swift
    /// Press a key or key combination on an element or the focused element.
    @MainActor
    func pressKey(ref: String?, key: String, modifiers: [String]) async throws -> [String: Any] {
        let js = """
            const el = ref
                ? document.querySelector('[data-ax-ref="' + ref + '"]')
                : document.activeElement;
            if (!el) return { error: ref ? "not_found" : "no_focused_element" };

            const keyCodeMap = {
                'Enter': 'Enter', 'Tab': 'Tab', 'Escape': 'Escape',
                'Backspace': 'Backspace', 'Delete': 'Delete', 'Space': 'Space',
                'ArrowUp': 'ArrowUp', 'ArrowDown': 'ArrowDown',
                'ArrowLeft': 'ArrowLeft', 'ArrowRight': 'ArrowRight',
                'Home': 'Home', 'End': 'End', 'PageUp': 'PageUp', 'PageDown': 'PageDown'
            };

            const mods = modifiers || [];
            const opts = {
                key: key === 'Space' ? ' ' : key,
                code: keyCodeMap[key] || ('Key' + key.toUpperCase()),
                bubbles: true, cancelable: true, view: window,
                shiftKey: mods.includes('shift'),
                ctrlKey: mods.includes('ctrl'),
                altKey: mods.includes('alt'),
                metaKey: mods.includes('meta')
            };

            if (ref) el.focus();
            el.dispatchEvent(new KeyboardEvent('keydown', opts));
            if (key.length === 1 || key === 'Space') el.dispatchEvent(new KeyboardEvent('keypress', opts));
            el.dispatchEvent(new KeyboardEvent('keyup', opts));

            // Handle native behaviors that synthetic events don't trigger
            if (key === 'Enter') {
                const form = el.closest('form');
                if (form) { try { form.requestSubmit(); } catch(e) { form.submit(); } }
                else if (el.tagName === 'A' || el.tagName === 'BUTTON') el.click();
            } else if (key === 'Tab') {
                const focusable = Array.from(document.querySelectorAll(
                    'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
                )).filter(e => e.offsetParent !== null);
                const idx = focusable.indexOf(el);
                const next = mods.includes('shift')
                    ? focusable[idx - 1] || focusable[focusable.length - 1]
                    : focusable[idx + 1] || focusable[0];
                if (next) next.focus();
            }

            return { pressed: true, key: key, modifiers: mods, target: el.tagName };
        """
        return try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(
                js,
                arguments: ["ref": ref as Any, "key": key, "modifiers": modifiers],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    if let dict = value as? [String: Any] {
                        continuation.resume(returning: dict)
                    } else {
                        continuation.resume(returning: ["pressed": true])
                    }
                case .failure:
                    // Key press may have triggered navigation
                    continuation.resume(returning: ["pressed": true, "navigated": true])
                }
            }
        }
    }
```

**Step 2: Build to verify compilation**

Run: `cd /Users/nicknorris/Documents/claude-code-projects/claude-context-tool/Context && swift build 2>&1 | tail -5`
Expected: Build succeeds (warnings OK, no errors)

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Browser/BrowserTab.swift
git commit -m "feat: add pressKey method to BrowserTab"
```

---

### Task 2: Add `evalJavaScript` method to BrowserTab

**Files:**
- Modify: `Context/Sources/Context/Views/Browser/BrowserTab.swift` (insert after the `pressKey` method added in Task 1)

**Step 1: Add the method**

Insert immediately after the `pressKey` method:

```swift
    /// Execute arbitrary JavaScript on the page and return the result.
    @MainActor
    func evalJavaScript(expression: String) async throws -> [String: Any] {
        let wrappedJS = """
            try {
                const __result = await (async () => { \(expression) })();
                if (__result === undefined) return { result: null };
                try {
                    JSON.stringify(__result);
                    return { result: __result };
                } catch(e) {
                    return { error: "Result is not JSON-serializable" };
                }
            } catch(e) {
                return { error: e.toString() };
            }
        """
        return try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(
                wrappedJS,
                arguments: [:],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    if let dict = value as? [String: Any] {
                        continuation.resume(returning: dict)
                    } else {
                        continuation.resume(returning: ["result": value as Any])
                    }
                case .failure(let error):
                    continuation.resume(returning: ["error": error.localizedDescription])
                }
            }
        }
    }
```

**Step 2: Build to verify compilation**

Run: `cd /Users/nicknorris/Documents/claude-code-projects/claude-context-tool/Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Browser/BrowserTab.swift
git commit -m "feat: add evalJavaScript method to BrowserTab"
```

---

### Task 3: Add `hoverElement` method to BrowserTab

**Files:**
- Modify: `Context/Sources/Context/Views/Browser/BrowserTab.swift` (insert after the `evalJavaScript` method added in Task 2)

**Step 1: Add the method**

Insert immediately after the `evalJavaScript` method:

```swift
    /// Hover over an element by ref, dispatching mouseenter and mouseover events.
    @MainActor
    func hoverElement(ref: String) async throws -> [String: Any] {
        let js = """
            const el = document.querySelector('[data-ax-ref="' + ref + '"]');
            if (!el) return { error: "not_found" };
            el.scrollIntoView({block: 'center', behavior: 'instant'});
            el.dispatchEvent(new MouseEvent('mouseenter', {bubbles: false, cancelable: false, view: window}));
            el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, cancelable: true, view: window}));
            return { hovered: true, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 100) };
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
                        continuation.resume(returning: ["hovered": true])
                    }
                case .failure:
                    // Hover may have triggered navigation
                    continuation.resume(returning: ["hovered": true, "navigated": true])
                }
            }
        }
    }
```

**Step 2: Build to verify compilation**

Run: `cd /Users/nicknorris/Documents/claude-code-projects/claude-context-tool/Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Browser/BrowserTab.swift
git commit -m "feat: add hoverElement method to BrowserTab"
```

---

### Task 4: Add 3 dispatch cases and handlers to BrowserCommandExecutor

**Files:**
- Modify: `Context/Sources/Context/Services/BrowserCommandExecutor.swift`
  - Add 3 dispatch cases at line ~126 (after `case "browser_wait"`, before `default:`)
  - Add 3 handler methods at line ~351 (after `handleWait`, before `// MARK: - Helpers`)

**Step 1: Add dispatch cases**

In the `dispatch` method, after `case "browser_wait": return try await handleWait(args)` (line 126) and before `default:` (line 127), add:

```swift
        case "browser_press":
            return try await handlePress(args)
        case "browser_eval":
            return try await handleEval(args)
        case "browser_hover":
            return try await handleHover(args)
```

**Step 2: Add handler methods**

After the `handleWait` method (ends at line 351) and before `// MARK: - Helpers` (line 353), add:

```swift
    // MARK: - Phase 3: JS Execution, Keyboard, Hover

    private func handlePress(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        guard let key = args["key"] as? String, !key.isEmpty else {
            throw BrowserCommandError.missingParam("key")
        }
        let ref = args["ref"] as? String
        let modifiers = args["modifiers"] as? [String] ?? []
        let result = try await tab.pressKey(ref: ref, key: key, modifiers: modifiers)
        if let error = result["error"] as? String {
            if error == "not_found" { throw BrowserCommandError.refNotFound(ref ?? "unknown") }
            if error == "no_focused_element" {
                throw MCPBrowserError.noFocusedElement
            }
        }
        return toJSON(result)
    }

    private func handleEval(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        guard let expression = args["expression"] as? String, !expression.isEmpty else {
            throw BrowserCommandError.missingParam("expression")
        }
        let result = try await tab.evalJavaScript(expression: expression)
        return toJSON(result)
    }

    private func handleHover(_ args: [String: Any]) async throws -> String {
        let tab = try resolveTab(args)
        guard let ref = args["ref"] as? String, !ref.isEmpty else {
            throw BrowserCommandError.missingParam("ref")
        }
        let result = try await tab.hoverElement(ref: ref)
        if let error = result["error"] as? String, error == "not_found" {
            throw BrowserCommandError.refNotFound(ref)
        }
        return toJSON(result)
    }
```

**Step 3: Add `noFocusedElement` error case to MCPBrowserError**

In the `MCPBrowserError` enum (line ~455), add a new case:

```swift
    case noFocusedElement
```

And in its `errorDescription` computed property, add:

```swift
        case .noFocusedElement:
            return "No element is currently focused. Provide a ref to target a specific element, or use browser_click to focus an element first."
```

**Step 4: Build to verify compilation**

Run: `cd /Users/nicknorris/Documents/claude-code-projects/claude-context-tool/Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add Context/Sources/Context/Services/BrowserCommandExecutor.swift
git commit -m "feat: add Phase 3 handlers to BrowserCommandExecutor"
```

---

### Task 5: Add 3 tool definitions and wrappers to ContextMCP

**Files:**
- Modify: `Context/Sources/ContextMCP/main.swift`
  - Add 3 tool definitions after `browser_wait` definition (line ~719)
  - Add 3 dispatch cases after `case "browser_wait"` (line ~764)
  - Add 3 wrapper functions after `browserWait` function (line ~1421)

**Step 1: Add tool definitions**

After the `browser_wait` tool definition (ends around line 719) and before the closing `]` of `toolDefinitions()`, add:

```swift
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
```

**Step 2: Add dispatch cases**

In `handleToolCall`, after `case "browser_wait": result = try browserWait(args)` (line ~764) and before `default:`, add:

```swift
            case "browser_press":       result = try browserPress(args)
            case "browser_eval":        result = try browserEval(args)
            case "browser_hover":       result = try browserHover(args)
```

**Step 3: Add wrapper functions**

After the `browserWait` function (ends around line 1421) and before `// MARK: - Browser Command Execution`, add:

```swift
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
```

**Step 4: Build to verify compilation**

Run: `cd /Users/nicknorris/Documents/claude-code-projects/claude-context-tool/Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add Context/Sources/ContextMCP/main.swift
git commit -m "feat: add Phase 3 tool definitions and wrappers to ContextMCP"
```

---

### Task 6: End-to-end testing

**Context:** All code is now in place. Test each tool against a real browser.

**Prerequisites:**
- Context.app must be running with a browser tab visible
- The ContextMCP binary must be rebuilt: `cd /Users/nicknorris/Documents/claude-code-projects/claude-context-tool/Context && swift build`

**Step 1: Test `browser_press` — Enter to submit a search**

Use the browser MCP tools in sequence:
1. `browser_navigate` to `https://www.google.com`
2. `browser_snapshot` to find the search box ref
3. `browser_type` to type a search query
4. `browser_press` with `key: "Enter"` (no ref — targets focused element)
5. `browser_snapshot` to verify search results loaded

Expected: After pressing Enter, the page should navigate to search results.

**Step 2: Test `browser_press` — Tab to move focus**

1. `browser_navigate` to `https://www.example.com`
2. `browser_snapshot` to see the page
3. `browser_press` with `key: "Tab"` to move focus
4. `browser_snapshot` to verify focus moved (look for `[focused]` attribute)

Expected: `{ "pressed": true, "key": "Tab", "modifiers": [], "target": "..." }`

**Step 3: Test `browser_press` — with ref targeting**

1. `browser_snapshot` to get a ref
2. `browser_press` with `ref: "e1"` and `key: "Enter"` to click a link via keyboard

Expected: `{ "pressed": true, "key": "Enter", ... }`

**Step 4: Test `browser_eval` — read page state**

1. `browser_navigate` to any page
2. `browser_eval` with `expression: "return document.title"`

Expected: `{ "result": "Example Domain" }` (or whatever the page title is)

**Step 5: Test `browser_eval` — read localStorage**

1. `browser_eval` with `expression: "return JSON.stringify(Object.keys(localStorage))"`

Expected: `{ "result": "[]" }` or a JSON array of keys

**Step 6: Test `browser_eval` — error handling**

1. `browser_eval` with `expression: "return undefinedVariable.foo"`

Expected: `{ "error": "ReferenceError: Can't find variable: undefinedVariable" }` (or similar)

**Step 7: Test `browser_hover`**

1. `browser_navigate` to a page with hover-interactive elements
2. `browser_snapshot` to find an element ref
3. `browser_hover` with the ref

Expected: `{ "hovered": true, "tag": "...", "text": "..." }`

**Step 8: Test stale ref error for `browser_press` and `browser_hover`**

1. `browser_press` with `ref: "e99"` — should return ref not found error
2. `browser_hover` with `ref: "e99"` — should return ref not found error

Expected: `"Element with ref 'e99' not found..."`

**Step 9: Commit any fixes discovered during testing**

If any issues are found during testing, fix them and commit with descriptive messages.

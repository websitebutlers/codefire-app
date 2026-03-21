# Browser Stability & MCP Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Swift browser so it reliably loads pages, preserves URLs across tab switches, shows error pages on failure, and exposes page source + network monitor activation via MCP.

**Architecture:** Move `WKNavigationDelegate` from an ephemeral `WebViewWrapper.Coordinator` to `BrowserTab` itself (stable, one-per-tab lifecycle). Guard all KVO observers with `isUnloaded` flag. Add inline error pages. Add 3 new MCP tools.

**Tech Stack:** Swift, WKWebView, SwiftUI (NSViewRepresentable), GRDB (SQLite MCP command bus)

**Spec:** `docs/superpowers/specs/2026-03-20-browser-stability-design.md`

---

### Task 1: Move WKNavigationDelegate to BrowserTab

**Files:**
- Modify: `swift/Sources/CodeFire/Views/Browser/BrowserTab.swift:46` (class declaration)
- Modify: `swift/Sources/CodeFire/Views/Browser/BrowserTab.swift:175` (after `super.init()`)
- Modify: `swift/Sources/CodeFire/Views/Browser/WebViewWrapper.swift` (entire file)

- [ ] **Step 1: Add WKNavigationDelegate to BrowserTab class declaration**

At line 46, add `WKNavigationDelegate` to the conformance list:

```swift
class BrowserTab: NSObject, Identifiable, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {
```

- [ ] **Step 2: Add navigationError published property**

After line 52 (`@Published var isLoading`), add:

```swift
@Published var navigationError: String?
```

- [ ] **Step 3: Add lastAttemptedURL property**

After line 74 (`lastKnownURL`), add:

```swift
/// The URL that was being loaded when a navigation error occurred.
/// Used by the error page retry button and preserved across unload/reload cycles.
private(set) var lastAttemptedURL: URL?
```

- [ ] **Step 4: Set navigationDelegate in init**

At line 175, after `super.init()`, add:

```swift
webView.navigationDelegate = self
```

- [ ] **Step 5: Add all WKNavigationDelegate methods**

After the `deinit` block (after line 205), add:

```swift
// MARK: - WKNavigationDelegate

func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    guard !isUnloaded else { return }
    isLoading = true
    navigationError = nil
}

func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard !isUnloaded else { return }
    isLoading = false
    navigationError = nil
}

func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    guard !isUnloaded else { return }
    isLoading = false
    if (error as NSError).code == NSURLErrorCancelled { return }
    navigationError = error.localizedDescription
    addConsoleLog(level: "error", message: "Navigation failed: \(error.localizedDescription)")
}

func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    guard !isUnloaded else { return }
    isLoading = false
    if (error as NSError).code == NSURLErrorCancelled { return }
    navigationError = error.localizedDescription
    loadErrorPage(error: error)
    addConsoleLog(level: "error", message: "Failed to load: \(error.localizedDescription)")
}

func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
             completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    let host = challenge.protectionSpace.host
    if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
       let trust = challenge.protectionSpace.serverTrust,
       (host == "localhost" || host == "127.0.0.1") {
        completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
        completionHandler(.performDefaultHandling, nil)
    }
}
```

- [ ] **Step 6: Simplify WebViewWrapper**

Replace the entire contents of `WebViewWrapper.swift` with:

```swift
import SwiftUI
import WebKit

struct WebViewWrapper: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
```

- [ ] **Step 7: Build and verify**

Run: `cd swift && swift build 2>&1 | grep -E '(error:|Build complete)'`
Expected: `Build complete!`

- [ ] **Step 8: Commit**

```bash
git add swift/Sources/CodeFire/Views/Browser/BrowserTab.swift swift/Sources/CodeFire/Views/Browser/WebViewWrapper.swift
git commit -m "fix(swift): move WKNavigationDelegate to BrowserTab, add error handling"
```

---

### Task 2: Add Inline Error Page

**Files:**
- Modify: `swift/Sources/CodeFire/Views/Browser/BrowserTab.swift` (add `loadErrorPage` method + error HTML)

- [ ] **Step 1: Add the error page HTML constant and loadErrorPage method**

Add after the navigation delegate methods from Task 1:

```swift
// MARK: - Error Page

func loadErrorPage(error: Error) {
    lastAttemptedURL = lastKnownURL ?? webView.url

    let nsError = error as NSError
    let title: String
    let detail: String
    let icon: String

    switch nsError.code {
    case NSURLErrorNotConnectedToInternet:
        title = "No Internet Connection"
        detail = "Check your network connection and try again."
        icon = "wifi.slash"
    case NSURLErrorCannotFindHost:
        let host = (nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String)
            .flatMap { URL(string: $0)?.host } ?? "this address"
        title = "Server Not Found"
        detail = "The server at \(host) could not be found."
        icon = "magnifyingglass"
    case NSURLErrorTimedOut:
        title = "Connection Timed Out"
        detail = "The server took too long to respond."
        icon = "clock"
    case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted:
        title = "Connection Not Secure"
        detail = "The certificate for this site is not trusted."
        icon = "lock.trianglebadge.exclamationmark"
    default:
        title = "Page Failed to Load"
        detail = error.localizedDescription
        icon = "exclamationmark.triangle"
    }

    let html = """
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #1a1a1a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
             display: flex; align-items: center; justify-content: center; min-height: 100vh; }
      .container { text-align: center; max-width: 420px; padding: 40px 24px; }
      .icon { font-size: 48px; margin-bottom: 20px; opacity: 0.5; }
      h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #fff; }
      p { font-size: 14px; color: #888; line-height: 1.5; margin-bottom: 24px; }
      .actions { display: flex; gap: 12px; justify-content: center; }
      button, a.btn { background: #f97316; color: #fff; border: none; padding: 10px 24px;
              border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer;
              text-decoration: none; display: inline-block; }
      button:hover, a.btn:hover { background: #ea580c; }
      a.secondary { color: #888; font-size: 13px; text-decoration: underline; cursor: pointer; }
    </style></head><body>
    <div class="container">
      <div class="icon">\(icon)</div>
      <h1>\(title)</h1>
      <p>\(detail)</p>
      <div class="actions">
        <button onclick="window.location.reload()">Retry</button>
      </div>
    </div>
    </body></html>
    """
    webView.loadHTMLString(html, baseURL: nil)
}
```

- [ ] **Step 2: Update unloadWebView to preserve lastAttemptedURL**

Replace the existing `unloadWebView()` method (lines 103-108) with:

```swift
func unloadWebView() {
    guard !isUnloaded else { return }
    // Prefer the original attempted URL over the error page's URL
    lastKnownURL = lastAttemptedURL ?? webView.url
    lastAttemptedURL = nil
    webView.loadHTMLString("", baseURL: nil)
    isUnloaded = true
}
```

- [ ] **Step 3: Add retry handler in userContentController**

In the `userContentController(_:didReceive:)` method, the existing `consoleLog` handler should also listen for the retry signal. Find the consoleLog case and add after the existing log handling:

```swift
// If the error page retry button was clicked, retry the last attempted URL
if level == "retry", let url = lastAttemptedURL {
    navigate(to: url.absoluteString)
}
```

Note: Actually, the retry button uses `window.location.reload()` which is simpler — WKWebView handles it. No message handler change needed. Skip this step if the HTML uses `window.location.reload()`.

- [ ] **Step 4: Build and verify**

Run: `cd swift && swift build 2>&1 | grep -E '(error:|Build complete)'`
Expected: `Build complete!`

- [ ] **Step 5: Commit**

```bash
git add swift/Sources/CodeFire/Views/Browser/BrowserTab.swift
git commit -m "fix(swift): add inline error page for failed navigations"
```

---

### Task 3: Fix URL Bar Blanking (KVO Guards)

**Files:**
- Modify: `swift/Sources/CodeFire/Views/Browser/BrowserTab.swift:182-198` (KVO observers)
- Modify: `swift/Sources/CodeFire/Views/Browser/BrowserTab.swift:111-115` (reloadIfNeeded)
- Modify: `swift/Sources/CodeFire/Views/Browser/BrowserTab.swift:207-218` (navigate)

- [ ] **Step 1: Add isUnloaded guard to KVO observers**

Replace lines 182-198 (the `observations` array) with:

```swift
observations = [
    webView.observe(\.title) { [weak self] wv, _ in
        DispatchQueue.main.async {
            guard let self, !self.isUnloaded else { return }
            self.title = wv.title ?? "New Tab"
        }
    },
    webView.observe(\.url) { [weak self] wv, _ in
        DispatchQueue.main.async {
            guard let self, !self.isUnloaded else { return }
            self.currentURL = wv.url?.absoluteString ?? ""
        }
    },
    webView.observe(\.isLoading) { [weak self] wv, _ in
        DispatchQueue.main.async {
            guard let self, !self.isUnloaded else { return }
            self.isLoading = wv.isLoading
        }
    },
    webView.observe(\.canGoBack) { [weak self] wv, _ in
        DispatchQueue.main.async {
            guard let self, !self.isUnloaded else { return }
            self.canGoBack = wv.canGoBack
        }
    },
    webView.observe(\.canGoForward) { [weak self] wv, _ in
        DispatchQueue.main.async {
            guard let self, !self.isUnloaded else { return }
            self.canGoForward = wv.canGoForward
        }
    },
]
```

- [ ] **Step 2: Fix reloadIfNeeded ordering**

Replace `reloadIfNeeded()` (lines 111-115) with:

```swift
func reloadIfNeeded() {
    guard isUnloaded, let url = lastKnownURL else { return }
    isUnloaded = false  // Clear BEFORE load so KVO fires correctly
    webView.load(URLRequest(url: url))
}
```

- [ ] **Step 3: Clear isUnloaded in navigate()**

Replace `navigate(to:)` (lines 207-218) with:

```swift
func navigate(to urlString: String) {
    isUnloaded = false  // Ensure KVO fires for this navigation
    navigationError = nil
    lastAttemptedURL = nil
    var input = urlString.trimmingCharacters(in: .whitespaces)
    if !input.contains("://") {
        if input.hasPrefix("localhost") || input.hasPrefix("127.0.0.1") {
            input = "http://\(input)"
        } else {
            input = "https://\(input)"
        }
    }
    guard let url = URL(string: input) else { return }
    webView.load(URLRequest(url: url))
}
```

- [ ] **Step 4: Build and verify**

Run: `cd swift && swift build 2>&1 | grep -E '(error:|Build complete)'`
Expected: `Build complete!`

- [ ] **Step 5: Commit**

```bash
git add swift/Sources/CodeFire/Views/Browser/BrowserTab.swift
git commit -m "fix(swift): guard KVO observers with isUnloaded, fix URL bar blanking"
```

---

### Task 4: MCP Navigate Guard

**Files:**
- Modify: `swift/Sources/CodeFire/Services/BrowserCommandExecutor.swift:178-188` (handleNavigate wait loop)
- Modify: `swift/Sources/CodeFire/Services/BrowserCommandExecutor.swift:268-279` (handleTabOpen wait loop)

- [ ] **Step 1: Fix handleNavigate wait loop**

Replace lines 178-188 with:

```swift
// Wait for navigation to finish (poll isLoading)
let start = Date()
while tab.isLoading && Date().timeIntervalSince(start) < 14.0 {
    if tab.isUnloaded { break }
    if tab.navigationError != nil { break }
    try await Task.sleep(nanoseconds: 100_000_000) // 100ms
}

if tab.isUnloaded {
    return toJSON(["error": "Tab was unloaded during navigation"])
}
if let error = tab.navigationError {
    return toJSON(["error": error, "url": tab.currentURL, "title": tab.title])
}

return toJSON([
    "url": tab.currentURL,
    "title": tab.title,
    "status": tab.isLoading ? "loading" : "loaded"
])
```

- [ ] **Step 2: Fix handleTabOpen wait loop**

Replace lines 268-279 with:

```swift
// If URL was provided, wait for load
if url != nil {
    let start = Date()
    while tab.isLoading && Date().timeIntervalSince(start) < 14.0 {
        if tab.isUnloaded { break }
        if tab.navigationError != nil { break }
        try await Task.sleep(nanoseconds: 100_000_000)
    }
}

var result: [String: Any] = [
    "tab_id": tab.id.uuidString,
    "title": tab.title,
    "url": tab.currentURL
]
if let error = tab.navigationError {
    result["error"] = error
}
return toJSON(result)
```

- [ ] **Step 3: Build and verify**

Run: `cd swift && swift build 2>&1 | grep -E '(error:|Build complete)'`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add swift/Sources/CodeFire/Services/BrowserCommandExecutor.swift
git commit -m "fix(swift): guard MCP navigate loops against unloaded tabs and errors"
```

---

### Task 5: Add MCP Tools (browser_get_source, network start/stop, cookie redaction)

**Files:**
- Modify: `swift/Sources/CodeFire/Views/Browser/BrowserTab.swift` (add `getPageSource`)
- Modify: `swift/Sources/CodeFire/Services/BrowserCommandExecutor.swift:95-156` (dispatch switch)
- Modify: `swift/Sources/CodeFire/Services/BrowserCommandExecutor.swift:514-518` (cookie filter)
- Modify: `swift/Sources/CodeFireMCP/main.swift` (tool schemas + dispatch + wrappers)

- [ ] **Step 1: Add getPageSource to BrowserTab**

Add after the `getStorage` method in BrowserTab.swift:

```swift
/// Get page HTML source, optionally filtered by CSS selector.
func getPageSource(selector: String? = nil) async -> String {
    let js: String
    if let sel = selector {
        let escaped = sel.replacingOccurrences(of: "'", with: "\\'")
        js = "return document.querySelector('\(escaped)')?.outerHTML ?? '';"
    } else {
        js = "return document.documentElement.outerHTML;"
    }
    let scopedJS = scopeJS(js)
    guard let result = try? await webView.callAsyncJavaScript(
        scopedJS, contentWorld: .defaultClient
    ) as? String else { return "" }
    return result
}
```

- [ ] **Step 2: Add dispatch cases in BrowserCommandExecutor**

In the dispatch switch (after line 153 `case "clear_network_log":`), add before the `default:` case:

```swift
case "browser_get_source":
    return try await handleGetSource(args)
case "browser_network_start":
    return try await handleNetworkStart(args)
case "browser_network_stop":
    return try await handleNetworkStop(args)
```

- [ ] **Step 3: Add handler methods in BrowserCommandExecutor**

Add after the `handleClearNetworkLog` method:

```swift
private func handleGetSource(_ args: [String: Any]) async throws -> String {
    let tab = try resolveTab(args)
    let selector = args["selector"] as? String
    let source = await tab.getPageSource(selector: selector)
    return toJSON(["source": source, "length": source.count])
}

private func handleNetworkStart(_ args: [String: Any]) async throws -> String {
    let tab = try resolveTab(args)
    tab.startNetworkMonitor()
    return toJSON(["status": "started"])
}

private func handleNetworkStop(_ args: [String: Any]) async throws -> String {
    let tab = try resolveTab(args)
    tab.stopNetworkMonitor()
    return toJSON(["status": "stopped"])
}
```

- [ ] **Step 4: Add httpOnly cookie filter**

Replace `handleGetCookies` (lines 514-518) with:

```swift
private func handleGetCookies(_ args: [String: Any]) async throws -> String {
    let tab = try resolveTab(args)
    let domain = args["domain"] as? String
    let cookies = await tab.getCookies(domain: domain)
    // Filter out httpOnly cookies to prevent session credential exposure via MCP
    let safeCookies = cookies.filter { !($0["httpOnly"] as? Bool ?? false) }
    return toJSON(["cookies": safeCookies, "count": safeCookies.count])
}
```

- [ ] **Step 5: Register new tools in CodeFireMCP/main.swift**

Find the tools array (after the `get_request_detail` tool entry, around line 1220). Add these three tool definitions before the closing of the tools array:

```swift
[
    "name": "browser_get_source",
    "description": "Get the HTML source of the current page or a specific element. Returns outerHTML. Requires CodeFire browser.",
    "inputSchema": [
        "type": "object",
        "properties": [
            "selector": ["type": "string", "description": "CSS selector to get specific element's HTML. Omit for full page source."],
            "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
        ],
        "required": [] as [String]
    ]
],
[
    "name": "browser_network_start",
    "description": "Start the network monitor to capture HTTP requests. Must be started before requests you want to capture. Use get_network_requests to read captured data.",
    "inputSchema": [
        "type": "object",
        "properties": [
            "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
        ],
        "required": [] as [String]
    ]
],
[
    "name": "browser_network_stop",
    "description": "Stop the network monitor. Captured requests remain available via get_network_requests until cleared.",
    "inputSchema": [
        "type": "object",
        "properties": [
            "tab_id": ["type": "string", "description": "Tab ID (defaults to active tab)"]
        ],
        "required": [] as [String]
    ]
],
```

- [ ] **Step 6: Update browser_get_cookies description**

Find the `browser_get_cookies` tool definition (line 1077-1078). Replace the description:

```swift
"description": "Get cookies for the current page. Returns non-httpOnly cookies visible to the application. Useful for debugging authentication, session management, and tracking. Requires CodeFire browser.",
```

- [ ] **Step 7: Add dispatch cases in CodeFireMCP/main.swift**

Find the tool dispatch switch (around line 1393). Add after the `clear_network_log` case:

```swift
case "browser_get_source":    result = try browserGetSource(args)
case "browser_network_start": result = try browserNetworkStart(args)
case "browser_network_stop":  result = try browserNetworkStop(args)
```

- [ ] **Step 8: Add wrapper functions in CodeFireMCP/main.swift**

Add after the existing `clearNetworkLog` wrapper function:

```swift
func browserGetSource(_ args: [String: Any]) throws -> String {
    var cmdArgs: [String: Any] = [:]
    if let selector = args["selector"] as? String { cmdArgs["selector"] = selector }
    if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
    return try executeBrowserCommand(tool: "browser_get_source", args: cmdArgs)
}

func browserNetworkStart(_ args: [String: Any]) throws -> String {
    var cmdArgs: [String: Any] = [:]
    if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
    return try executeBrowserCommand(tool: "browser_network_start", args: cmdArgs)
}

func browserNetworkStop(_ args: [String: Any]) throws -> String {
    var cmdArgs: [String: Any] = [:]
    if let tabId = args["tab_id"] as? String { cmdArgs["tab_id"] = tabId }
    return try executeBrowserCommand(tool: "browser_network_stop", args: cmdArgs)
}
```

- [ ] **Step 9: Build and verify**

Run: `cd swift && swift build 2>&1 | grep -E '(error:|Build complete)'`
Expected: `Build complete!`

- [ ] **Step 10: Commit**

```bash
git add swift/Sources/CodeFire/Views/Browser/BrowserTab.swift swift/Sources/CodeFire/Services/BrowserCommandExecutor.swift swift/Sources/CodeFireMCP/main.swift
git commit -m "feat(swift): add browser_get_source, network start/stop MCP tools, redact httpOnly cookies"
```

---

### Task 6: Final Build Verification & Push

- [ ] **Step 1: Full build**

Run: `cd swift && swift build -c release 2>&1 | grep -E '(error:|Build complete)'`
Expected: `Build complete!`

- [ ] **Step 2: Push all commits**

```bash
git push origin main
```

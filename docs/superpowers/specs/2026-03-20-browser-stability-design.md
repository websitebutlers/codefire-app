# Browser Stability & MCP Improvements — Design Spec

## Problem

The Swift app's built-in browser works about half the time. URLs reset to blank on tab switch, pages silently fail to load, and the MCP tools return false success when the browser is in a broken state. Three team-facing MCP tools are also missing (page source, network monitor activation, cookie redaction).

## Root Causes

Five interconnected issues drive the instability:

1. **No WKNavigationDelegate error callbacks.** `WebViewWrapper.Coordinator` only handles SSL challenges. No `didFail`, `didFailProvisionalNavigation`, or `didFinish` are implemented. Failed navigations are completely silent.

2. **URL bar blanks on tab switch.** `unloadWebView()` calls `loadHTMLString("")`, which drives the KVO observer to set `currentURL = ""`. An async dispatch race means the blank value overwrites the correct cached URL.

3. **Ephemeral Coordinator reassignment.** Each `WebViewWrapper` instantiation creates a new `Coordinator` that overwrites `navigationDelegate`. In-flight navigation callbacks are lost when the coordinator is replaced.

4. **Dual BrowserView instantiation.** `GUIPanelView` creates two `BrowserView` instances (home view line 94, project ZStack line 145) sharing one `BrowserViewModel`. Both run `syncURLBar()` asynchronously, racing over the URL bar value.

5. **MCP navigate returns false success.** If the user switches tabs during a 14-second MCP wait, `isLoading` goes false from the blank page load, and the executor returns `currentURL = ""` as a successful result.

## Design

### Fix 1: Make BrowserTab its own WKNavigationDelegate

**What changes:**
- `BrowserTab` adds `WKNavigationDelegate` conformance (it already extends `NSObject`).
- Set `webView.navigationDelegate = self` in `BrowserTab.init()`, right after `super.init()`.
- Remove `webView.navigationDelegate = context.coordinator` from `WebViewWrapper.makeNSView`.
- Move the localhost SSL challenge handler from `WebViewWrapper.Coordinator` to `BrowserTab`.
- `WebViewWrapper.makeCoordinator()` becomes unnecessary — remove it. `WebViewWrapper` becomes a pure passthrough.

**New delegate methods on BrowserTab:**

All delegate methods guard against `isUnloaded` to avoid interfering with the unload cycle (e.g., `didFinish` firing for the blank `loadHTMLString` during unload should not clear `navigationError`).

```swift
// Navigation started — clear error state, ensure isLoading is true immediately
func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    guard !isUnloaded else { return }
    isLoading = true
    navigationError = nil
}

// Navigation succeeded
func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard !isUnloaded else { return }
    isLoading = false
    navigationError = nil
}

// Navigation failed after response started
func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    guard !isUnloaded else { return }
    isLoading = false
    if (error as NSError).code == NSURLErrorCancelled { return }
    navigationError = error.localizedDescription
    addConsoleLog(level: "error", message: "Navigation failed: \(error.localizedDescription)")
}

// Navigation failed before response (DNS, connection refused, etc.)
func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    guard !isUnloaded else { return }
    isLoading = false
    if (error as NSError).code == NSURLErrorCancelled { return }
    navigationError = error.localizedDescription
    loadErrorPage(error: error)
    addConsoleLog(level: "error", message: "Failed to load: \(error.localizedDescription)")
}

// SSL challenge (moved from Coordinator)
func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
             completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    // Same localhost trust logic currently in WebViewWrapper.Coordinator
}
```

**New published property:** `@Published var navigationError: String?` on `BrowserTab`.

**Files changed:** `BrowserTab.swift`, `WebViewWrapper.swift`

### Fix 2: Inline Error Page

When `didFailProvisionalNavigation` fires, load a styled error page into the WebView. The originally-attempted URL is preserved as `lastAttemptedURL` so that the retry button and `lastKnownURL` (used by the unload/reload system) reference the correct URL, not the error page's `about:blank`.

```swift
/// The URL that was being loaded when an error occurred.
/// Used by the error page retry button and preserved across unload/reload cycles.
private(set) var lastAttemptedURL: URL?

func loadErrorPage(error: Error) {
    // Save the original URL before loading the error page HTML
    lastAttemptedURL = lastKnownURL ?? webView.url

    let nsError = error as NSError
    let title: String
    let detail: String

    switch nsError.code {
    case NSURLErrorNotConnectedToInternet:
        title = "No Internet Connection"
        detail = "Check your network connection and try again."
    case NSURLErrorCannotFindHost:
        title = "Server Not Found"
        detail = "The server at \(nsError.userInfo[NSURLErrorFailingURLStringErrorKey] ?? "this address") could not be found."
    case NSURLErrorTimedOut:
        title = "Connection Timed Out"
        detail = "The server took too long to respond."
    case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted:
        title = "Connection Not Secure"
        detail = "The certificate for this site is not trusted."
    default:
        title = "Page Failed to Load"
        detail = error.localizedDescription
    }

    // Load dark-themed error page HTML with retry button
    // Retry button calls: window.webkit.messageHandlers.consoleLog.postMessage({level:'retry', message:''})
    // BrowserTab listens for the 'retry' level and calls navigate(to: lastAttemptedURL)
}
```

When `unloadWebView()` is called on a tab showing an error page, `lastKnownURL` is set to `lastAttemptedURL` (the original failing URL) rather than the error page's base URL. This way, `reloadIfNeeded()` retries the original URL.

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

**Files changed:** `BrowserTab.swift` (new `loadErrorPage` method, `lastAttemptedURL` property, error page HTML constant, updated `unloadWebView`)

### Fix 3: Fix URL Bar Blanking

**The problem:** KVO on `webView.url` fires when `loadHTMLString("")` sets the URL to nil, overwriting the cached URL.

**The fix:** Guard all KVO observers to skip updates when the tab is unloaded:

```swift
webView.observe(\.url) { [weak self] wv, _ in
    DispatchQueue.main.async {
        guard let self, !self.isUnloaded else { return }
        self.currentURL = wv.url?.absoluteString ?? ""
    }
}

webView.observe(\.title) { [weak self] wv, _ in
    DispatchQueue.main.async {
        guard let self, !self.isUnloaded else { return }
        self.title = wv.title ?? "New Tab"
    }
}

webView.observe(\.isLoading) { [weak self] wv, _ in
    DispatchQueue.main.async {
        guard let self, !self.isUnloaded else { return }
        self.isLoading = wv.isLoading
    }
}
```

Update `reloadIfNeeded()` to clear `isUnloaded` *before* the load so KVO resumes:

```swift
func reloadIfNeeded() {
    guard isUnloaded, let url = lastKnownURL else { return }
    isUnloaded = false  // Clear BEFORE load so KVO fires correctly
    webView.load(URLRequest(url: url))
}
```

**Critical: `navigate(to:)` must also clear `isUnloaded`.** Without this, MCP-driven navigation on a previously-unloaded tab would appear to succeed but produce no observable state changes because all KVO updates would be suppressed:

```swift
func navigate(to urlString: String) {
    isUnloaded = false  // Ensure KVO fires for this navigation
    navigationError = nil
    // ... existing URL parsing and webView.load() logic
}
```

**Files changed:** `BrowserTab.swift`

### Fix 4: Simplify WebViewWrapper

After moving `WKNavigationDelegate` to `BrowserTab`, `WebViewWrapper` becomes:

```swift
struct WebViewWrapper: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
```

No coordinator, no delegate assignment. The WebView's delegate is set once in `BrowserTab.init()` and never changes.

**Files changed:** `WebViewWrapper.swift`

### Fix 5: MCP Navigate Guard

In `BrowserCommandExecutor`, the navigate wait loop should check `isUnloaded` and `navigationError`. Apply to both `handleNavigate` and `handleTabOpen` (both have the same 14-second polling pattern):

```swift
while tab.isLoading && elapsed < 14.0 {
    if tab.isUnloaded { break }
    if tab.navigationError != nil { break }  // Don't wait for error page to finish loading
    try? await Task.sleep(nanoseconds: 100_000_000)
    elapsed += 0.1
}

// After the loop, check for invalid state:
if tab.isUnloaded {
    return toJSON(["error": "Tab was unloaded during navigation"])
}
if let error = tab.navigationError {
    return toJSON(["error": error, "url": tab.currentURL, "title": tab.title])
}
```

Including `navigationError` in the response gives MCP callers immediate feedback on navigation failures rather than returning `status: "loaded"` with an error page URL.

**Files changed:** `BrowserCommandExecutor.swift`

### Fix 6: MCP Tool Additions

Each new tool requires 4 integration points:
1. Tool schema registration in `CodeFireMCP/main.swift` (tools list)
2. Case in the dispatch switch in `CodeFireMCP/main.swift` (calls `executeBrowserCommand`)
3. Case in `BrowserCommandExecutor.dispatch()` switch
4. Handler method in `BrowserCommandExecutor` (or direct delegation to `BrowserTab`)

#### browser_get_source

New MCP tool that returns the page's HTML source:

```swift
// In BrowserTab:
func getPageSource(selector: String? = nil) async -> String {
    let js: String
    if let selector = selector {
        js = "return document.querySelector('\(selector)')?.outerHTML ?? '';"
    } else {
        js = "return document.documentElement.outerHTML;"
    }
    guard let result = try? await webView.callAsyncJavaScript(
        js, contentWorld: .defaultClient
    ) as? String else { return "" }
    return result
}
```

Parameters: optional `selector` (CSS selector, defaults to full page `outerHTML`).

#### browser_network_start / browser_network_stop

New MCP tools to programmatically activate/deactivate the network monitor:

```swift
// In BrowserCommandExecutor dispatch:
case "browser_network_start":
    tab.startNetworkMonitor()
    return toJSON(["status": "started"])

case "browser_network_stop":
    tab.stopNetworkMonitor()
    return toJSON(["status": "stopped"])
```

`startNetworkMonitor()` and `stopNetworkMonitor()` already exist on `BrowserTab`.

#### httpOnly Cookie Redaction

In `BrowserCommandExecutor.handleGetCookies`, filter httpOnly cookies from the response to match Electron's security behavior. Cookies are `[[String: Any]]` dictionaries, not `HTTPCookie` objects:

```swift
let safeCookies = cookies.filter { !($0["httpOnly"] as? Bool ?? false) }
```

Update the `browser_get_cookies` tool description in `CodeFireMCP/main.swift` to remove the "including httpOnly cookies" claim, since httpOnly cookies will no longer be returned.

**Files changed:** `BrowserCommandExecutor.swift`, `BrowserTab.swift`, `CodeFireMCP/main.swift`

## Files Summary

| File | Changes |
|------|---------|
| `BrowserTab.swift` | Add `WKNavigationDelegate` + `isUnloaded` guards on all delegate methods, `navigationError` property, `lastAttemptedURL` property, `loadErrorPage()`, `didStartProvisionalNavigation`, KVO guards for `isUnloaded`, `isUnloaded = false` in `navigate(to:)`, set `webView.navigationDelegate = self` in init, `getPageSource()` method |
| `WebViewWrapper.swift` | Remove `Coordinator`, remove `navigationDelegate` assignment, simplify to pure passthrough |
| `BrowserCommandExecutor.swift` | Add `isUnloaded` + `navigationError` guards in both navigate wait loops (`handleNavigate` and `handleTabOpen`), include `navigationError` in response, add `browser_get_source`/`browser_network_start`/`browser_network_stop` dispatch cases, add httpOnly cookie filter using dictionary key check |
| `CodeFireMCP/main.swift` | Register 3 new tools (schema + dispatch): `browser_get_source`, `browser_network_start`, `browser_network_stop`. Update `browser_get_cookies` description to remove httpOnly claim. |

## What This Does NOT Change

- The dual `BrowserView` instantiation (Fix 3's KVO guard resolves the symptom; refactoring the view hierarchy is a larger change best deferred)
- The `syncURLBar()` mechanism (works correctly once the underlying KVO race is fixed)
- Tab unload/reload design (good memory management pattern, just needed the KVO guards)
- Existing MCP tool signatures (all backward compatible)

## Testing

- Navigate to a valid URL → page loads, loading spinner stops, URL bar shows correct URL
- Navigate to invalid domain → inline error page with retry button, `navigationError` set
- Switch tabs and back → URL bar preserves the correct URL, page reloads
- Close network, navigate → error page shows "No Internet Connection"
- Navigate on a previously-unloaded tab (via MCP or URL bar) → KVO fires, URL/title update
- Error page tab unloaded and reloaded → retries the original URL, not the error page
- MCP `browser_navigate` while switching tabs → returns error instead of false success
- MCP `browser_navigate` to invalid domain → response includes `error` field
- MCP `browser_get_source` → returns full HTML (or element HTML with selector)
- MCP `browser_network_start` → activates network capture without UI click
- MCP `browser_get_cookies` → no httpOnly cookies in response

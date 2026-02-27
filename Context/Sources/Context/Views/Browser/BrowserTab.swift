import Foundation
import WebKit
import Combine
import SwiftUI

// MARK: - Console Log Entry

struct ConsoleLogEntry: Identifiable {
    let id = UUID()
    let level: String
    let message: String
    let timestamp: Date

    var icon: String {
        switch level {
        case "error": return "xmark.circle.fill"
        case "warn":  return "exclamationmark.triangle.fill"
        case "info":  return "info.circle.fill"
        default:      return "chevron.right"
        }
    }

    var color: Color {
        switch level {
        case "error": return .red
        case "warn":  return .orange
        case "info":  return .blue
        default:      return .secondary
        }
    }
}

// MARK: - Weak Script Message Handler

/// Weak proxy to avoid retain cycle: WKUserContentController strongly retains its handlers.
private class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?
    init(delegate: WKScriptMessageHandler) { self.delegate = delegate }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(c, didReceive: message)
    }
}

// MARK: - Browser Tab

class BrowserTab: NSObject, Identifiable, ObservableObject, WKScriptMessageHandler {
    let id = UUID()
    let webView: WKWebView

    @Published var title: String = "New Tab"
    @Published var currentURL: String = ""
    @Published var isLoading: Bool = false
    @Published var canGoBack: Bool = false
    @Published var canGoForward: Bool = false
    @Published var consoleLogs: [ConsoleLogEntry] = []
    @Published var inspectedElement: InspectedElement?
    @Published var inspectedStyles: ComputedStyles?
    @Published var inspectedBoxModel: BoxModelData?
    @Published var isElementPickerActive = false

    // Network monitoring
    @Published var networkRequests: [NetworkRequestEntry] = []
    @Published var isNetworkMonitorActive = false
    private static let maxNetworkEntries = 200
    private var networkMonitorScript: WKUserScript?

    private static let maxLogEntries = 500
    private var observations: [NSKeyValueObservation] = []

    /// The last known URL before this tab was unloaded, used to reload on demand.
    private(set) var lastKnownURL: URL?
    /// Whether this tab's web content has been unloaded to save memory.
    @Published var isUnloaded: Bool = false

    /// When set, subsequent JS execution targets this iframe instead of the main frame.
    var activeIframeRef: String?

    var errorCount: Int {
        consoleLogs.filter { $0.level == "error" }.count
    }

    var warningCount: Int {
        consoleLogs.filter { $0.level == "warn" }.count
    }

    func addConsoleLog(level: String, message: String) {
        let entry = ConsoleLogEntry(level: level, message: message, timestamp: Date())
        consoleLogs.append(entry)
        if consoleLogs.count > Self.maxLogEntries {
            consoleLogs.removeFirst(consoleLogs.count - Self.maxLogEntries)
        }
    }

    func clearConsoleLogs() {
        consoleLogs.removeAll()
    }

    /// Unload page content to free memory. Preserves the URL so it can be reloaded later.
    /// The WKWebView instance stays alive (cookies/session intact), but the heavy DOM is released.
    func unloadWebView() {
        guard !isUnloaded else { return }
        lastKnownURL = webView.url
        webView.loadHTMLString("", baseURL: nil)
        isUnloaded = true
    }

    /// Reload the previously loaded page after it was unloaded.
    func reloadIfNeeded() {
        guard isUnloaded, let url = lastKnownURL else { return }
        webView.load(URLRequest(url: url))
        isUnloaded = false
    }

    override init() {
        let config = WKWebViewConfiguration()
        // Use persistent data store — cookies, localStorage, sessionStorage survive app restarts
        config.websiteDataStore = .default()
        config.preferences.isElementFullscreenEnabled = true

        // Inject console interceptor script
        let consoleScript = WKUserScript(
            source: """
            (function() {
                var orig = {};
                ['log','warn','error','info'].forEach(function(l) {
                    orig[l] = console[l];
                    console[l] = function() {
                        var m = Array.prototype.slice.call(arguments).map(function(a) {
                            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
                            catch(e) { return String(a); }
                        }).join(' ');
                        window.webkit.messageHandlers.consoleLog.postMessage({level:l, message:m});
                        orig[l].apply(console, arguments);
                    };
                });
                window.addEventListener('error', function(e) {
                    window.webkit.messageHandlers.consoleLog.postMessage({
                        level:'error', message: e.message + ' at ' + e.filename + ':' + e.lineno
                    });
                });
            })();
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(consoleScript)

        self.webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        // Register message handlers via weak proxy
        config.userContentController.add(WeakScriptMessageHandler(delegate: self), name: "consoleLog")
        config.userContentController.add(WeakScriptMessageHandler(delegate: self), name: "devtools")
        config.userContentController.add(WeakScriptMessageHandler(delegate: self), name: "networkMonitor")

        observations = [
            webView.observe(\.title) { [weak self] wv, _ in
                DispatchQueue.main.async { self?.title = wv.title ?? "New Tab" }
            },
            webView.observe(\.url) { [weak self] wv, _ in
                DispatchQueue.main.async { self?.currentURL = wv.url?.absoluteString ?? "" }
            },
            webView.observe(\.isLoading) { [weak self] wv, _ in
                DispatchQueue.main.async { self?.isLoading = wv.isLoading }
            },
            webView.observe(\.canGoBack) { [weak self] wv, _ in
                DispatchQueue.main.async { self?.canGoBack = wv.canGoBack }
            },
            webView.observe(\.canGoForward) { [weak self] wv, _ in
                DispatchQueue.main.async { self?.canGoForward = wv.canGoForward }
            },
        ]
    }

    deinit {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "consoleLog")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "devtools")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "networkMonitor")
    }

    func navigate(to urlString: String) {
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

    // MARK: - Iframe JS Scoping

    /// When an iframe context is active, wrap JS so `document` and `window` refer to the iframe's context.
    /// This allows all automation methods to transparently operate inside the active iframe.
    private func scopeJS(_ js: String) -> String {
        guard let ref = activeIframeRef else { return js }
        return """
            const __frame = document.querySelector('[data-ax-ref="\(ref)"]');
            if (!__frame || !__frame.contentDocument) throw new Error('iframe_not_accessible');
            return await (async function(document, window) { \(js) })(__frame.contentDocument, __frame.contentWindow);
        """
    }

    // MARK: - Automation Methods

    /// Serialize the page's accessibility tree into compact structured text for LLM consumption.
    /// Runs in .defaultClient content world (invisible to page JS, bypasses CSP).
    @MainActor
    func snapshotAccessibilityTree() async throws -> String {
        let js = scopeJS("try { return " + Self.accessibilityTreeJS + " } catch(e) { return 'ERROR: ' + e.message; }")
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
        let js = scopeJS("""
            const el = document.querySelector(selector);
            if (!el) return { found: false, text: null };
            return { found: true, text: el.textContent.trim() };
        """)
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

    /// Click an element identified by its data-ax-ref attribute.
    @MainActor
    func clickElement(ref: String) async throws -> [String: Any] {
        let js = scopeJS("""
            const el = document.querySelector('[data-ax-ref="' + ref + '"]');
            if (!el) return { error: "not_found" };
            el.scrollIntoView({block: 'center', behavior: 'instant'});
            el.focus();
            el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
            return { clicked: true, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 100) };
        """)
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

    /// Type text into an input or textarea element by ref. Uses native setter for React compatibility.
    @MainActor
    func typeText(ref: String, text: String, clear: Bool = true) async throws -> [String: Any] {
        let js = scopeJS("""
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
        """)
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

    /// Select an option from a <select> element by value or visible label text.
    @MainActor
    func selectOption(ref: String, value: String?, label: String?) async throws -> [String: Any] {
        let js = scopeJS("""
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
        """)
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

    /// Scroll the page by direction/amount or scroll a specific element into view.
    @MainActor
    func scrollPage(ref: String?, direction: String?, amount: Int?) async throws -> [String: Any] {
        let js = scopeJS("""
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
        """)
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

    /// Wait for an element to appear in the DOM by ref or CSS selector.
    @MainActor
    func waitForElement(ref: String?, selector: String?, timeout: Int = 5) async throws -> [String: Any] {
        let js = scopeJS("""
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
        """)
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

    /// Press a key or key combination on an element or the focused element.
    @MainActor
    func pressKey(ref: String?, key: String, modifiers: [String]) async throws -> [String: Any] {
        let js = scopeJS("""
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
        """)
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

    /// Execute arbitrary JavaScript on the page and return the result.
    @MainActor
    func evalJavaScript(expression: String) async throws -> [String: Any] {
        let wrappedJS = scopeJS("""
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
        """)
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

    /// Hover over an element by ref, dispatching mouseenter and mouseover events.
    @MainActor
    func hoverElement(ref: String) async throws -> [String: Any] {
        let js = scopeJS("""
            const el = document.querySelector('[data-ax-ref="' + ref + '"]');
            if (!el) return { error: "not_found" };
            el.scrollIntoView({block: 'center', behavior: 'instant'});
            el.dispatchEvent(new MouseEvent('mouseenter', {bubbles: false, cancelable: false, view: window}));
            el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, cancelable: true, view: window}));
            return { hovered: true, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 100) };
        """)
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
                    continuation.resume(returning: ["hovered": true, "navigated": true])
                }
            }
        }
    }

    /// Set a file on an <input type="file"> element using base64-encoded data.
    @MainActor
    func uploadFile(ref: String, fileData: String, filename: String, mimeType: String) async throws -> [String: Any] {
        let js = scopeJS("""
            const el = document.querySelector('[data-ax-ref="' + ref + '"]');
            if (!el) return { error: "not_found" };
            if (el.tagName !== 'INPUT' || el.type !== 'file') return { error: "not_file_input", tag: el.tagName, type: el.type || '' };

            const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
            const file = new File([bytes], filename, { type: mimeType });
            const dt = new DataTransfer();
            dt.items.add(file);
            el.files = dt.files;

            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));

            return { uploaded: true, filename: filename, size: bytes.length };
        """)
        return try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(
                js,
                arguments: ["ref": ref, "base64Data": fileData, "filename": filename, "mimeType": mimeType],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: value as? [String: Any] ?? ["uploaded": true])
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Drag an element to a target element using HTML5 drag and drop events.
    @MainActor
    func dragElement(fromRef: String, toRef: String) async throws -> [String: Any] {
        let js = scopeJS("""
            const from = document.querySelector('[data-ax-ref="' + fromRef + '"]');
            if (!from) return { error: "source_not_found" };
            const to = document.querySelector('[data-ax-ref="' + toRef + '"]');
            if (!to) return { error: "target_not_found" };

            const dt = new DataTransfer();
            dt.setData('text/plain', from.textContent || '');

            const mkOpts = () => ({
                bubbles: true, cancelable: true, view: window, dataTransfer: dt
            });

            from.dispatchEvent(new DragEvent('dragstart', mkOpts()));
            from.dispatchEvent(new DragEvent('drag', mkOpts()));
            to.dispatchEvent(new DragEvent('dragenter', mkOpts()));
            to.dispatchEvent(new DragEvent('dragover', mkOpts()));
            to.dispatchEvent(new DragEvent('drop', mkOpts()));
            from.dispatchEvent(new DragEvent('dragend', mkOpts()));

            return { dragged: true, from: from.tagName, to: to.tagName };
        """)
        return try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(
                js,
                arguments: ["fromRef": fromRef, "toRef": toRef],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: value as? [String: Any] ?? ["dragged": true])
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Switch execution context to an iframe, or back to main frame if ref is nil.
    @MainActor
    func switchToIframe(ref: String?) async throws -> [String: Any] {
        if let ref = ref {
            // Validate the iframe exists and is accessible
            let js = """
                const el = document.querySelector('[data-ax-ref="' + ref + '"]');
                if (!el) return { error: "not_found" };
                if (el.tagName !== 'IFRAME') return { error: "not_iframe", tag: el.tagName };
                try {
                    const doc = el.contentDocument;
                    if (!doc) return { error: "cross_origin", src: el.src || '' };
                    return { frame: "iframe", src: el.src || '', ref: ref, title: doc.title || '' };
                } catch(e) {
                    return { error: "cross_origin", src: el.src || '' };
                }
            """
            let result: [String: Any] = try await withCheckedThrowingContinuation { continuation in
                webView.callAsyncJavaScript(
                    js,
                    arguments: ["ref": ref],
                    in: nil,
                    in: .defaultClient
                ) { result in
                    switch result {
                    case .success(let value):
                        continuation.resume(returning: value as? [String: Any] ?? [:])
                    case .failure(let error):
                        continuation.resume(throwing: error)
                    }
                }
            }
            if result["error"] == nil {
                activeIframeRef = ref
            }
            return result
        } else {
            activeIframeRef = nil
            return ["frame": "main"]
        }
    }

    /// Clear browsing data (cookies, cache, localStorage).
    @MainActor
    func clearSessionData(types: [String]) async throws -> [String: Any] {
        var dataTypes = Set<String>()
        let requestedTypes = types.isEmpty ? ["all"] : types

        if requestedTypes.contains("all") {
            dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
        } else {
            if requestedTypes.contains("cookies") {
                dataTypes.insert(WKWebsiteDataTypeCookies)
            }
            if requestedTypes.contains("cache") {
                dataTypes.insert(WKWebsiteDataTypeDiskCache)
                dataTypes.insert(WKWebsiteDataTypeMemoryCache)
            }
            if requestedTypes.contains("localStorage") {
                dataTypes.insert(WKWebsiteDataTypeLocalStorage)
                dataTypes.insert(WKWebsiteDataTypeSessionStorage)
            }
        }

        await webView.configuration.websiteDataStore.removeData(
            ofTypes: dataTypes,
            modifiedSince: .distantPast
        )

        return ["cleared": requestedTypes]
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

        // Render NSImage into a fresh bitmap to get reliable PNG export.
        // WKWebView.takeSnapshot returns images with opaque backing representations
        // that don't convert directly via tiffRepresentation or cgImage().
        let pixelWidth = Int(image.size.width * (NSScreen.main?.backingScaleFactor ?? 2.0))
        let pixelHeight = Int(image.size.height * (NSScreen.main?.backingScaleFactor ?? 2.0))
        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: pixelWidth,
            pixelsHigh: pixelHeight,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ) else {
            throw NSError(domain: "BrowserTab", code: -2,
                userInfo: [NSLocalizedDescriptionKey: "Failed to create bitmap for screenshot"])
        }
        bitmap.size = image.size
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        image.draw(in: NSRect(origin: .zero, size: image.size),
                   from: .zero, operation: .copy, fraction: 1.0)
        NSGraphicsContext.restoreGraphicsState()

        guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
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

    // MARK: - Network Monitor

    /// Inject JS that monkey-patches fetch() and XMLHttpRequest to capture network requests.
    @MainActor
    func startNetworkMonitor() {
        isNetworkMonitorActive = true

        let js = """
            (function() {
                if (window.__ctxNetworkMonitorActive) return;
                window.__ctxNetworkMonitorActive = true;
                var reqCounter = 0;

                window.__ctxOrigFetch = window.fetch;
                window.__ctxOrigXHROpen = XMLHttpRequest.prototype.open;
                window.__ctxOrigXHRSend = XMLHttpRequest.prototype.send;

                function headersToObj(headers) {
                    var obj = {};
                    if (headers && typeof headers.forEach === 'function') {
                        headers.forEach(function(v, k) { obj[k] = v; });
                    }
                    return obj;
                }

                window.fetch = function() {
                    var id = 'net_' + (++reqCounter);
                    var startTime = Date.now();
                    var url = '';
                    var method = 'GET';
                    var reqHeaders = {};

                    if (typeof arguments[0] === 'string') {
                        url = arguments[0];
                    } else if (arguments[0] instanceof Request) {
                        url = arguments[0].url;
                        method = arguments[0].method || 'GET';
                        reqHeaders = headersToObj(arguments[0].headers);
                    } else if (arguments[0] instanceof URL) {
                        url = arguments[0].toString();
                    }

                    if (arguments[1]) {
                        if (arguments[1].method) method = arguments[1].method;
                        if (arguments[1].headers) {
                            var h = arguments[1].headers;
                            if (h instanceof Headers) reqHeaders = headersToObj(h);
                            else if (typeof h === 'object') reqHeaders = h;
                        }
                    }

                    try {
                        window.webkit.messageHandlers.networkMonitor.postMessage({
                            type: 'requestStart',
                            requestId: id,
                            method: method.toUpperCase(),
                            url: url,
                            requestType: 'fetch',
                            requestHeaders: reqHeaders
                        });
                    } catch(e) {}

                    return window.__ctxOrigFetch.apply(this, arguments).then(function(response) {
                        var respHeaders = headersToObj(response.headers);
                        var clone = response.clone();
                        clone.text().then(function(body) {
                            try {
                                window.webkit.messageHandlers.networkMonitor.postMessage({
                                    type: 'requestComplete',
                                    requestId: id,
                                    status: response.status,
                                    statusText: response.statusText,
                                    duration: (Date.now() - startTime) / 1000.0,
                                    responseSize: body ? body.length : 0,
                                    responseHeaders: respHeaders,
                                    responseBody: body ? body.substring(0, 2000) : ''
                                });
                            } catch(e) {}
                        }).catch(function() {
                            try {
                                window.webkit.messageHandlers.networkMonitor.postMessage({
                                    type: 'requestComplete',
                                    requestId: id,
                                    status: response.status,
                                    statusText: response.statusText,
                                    duration: (Date.now() - startTime) / 1000.0,
                                    responseSize: 0,
                                    responseHeaders: respHeaders
                                });
                            } catch(e) {}
                        });
                        return response;
                    }).catch(function(err) {
                        try {
                            window.webkit.messageHandlers.networkMonitor.postMessage({
                                type: 'requestError',
                                requestId: id,
                                error: err.message || String(err)
                            });
                        } catch(e) {}
                        throw err;
                    });
                };

                XMLHttpRequest.prototype.open = function(method, url) {
                    this.__ctxMethod = method;
                    this.__ctxUrl = typeof url === 'string' ? url : (url ? url.toString() : '');
                    return window.__ctxOrigXHROpen.apply(this, arguments);
                };

                XMLHttpRequest.prototype.send = function() {
                    var xhr = this;
                    var id = 'net_' + (++reqCounter);
                    var startTime = Date.now();

                    try {
                        window.webkit.messageHandlers.networkMonitor.postMessage({
                            type: 'requestStart',
                            requestId: id,
                            method: (xhr.__ctxMethod || 'GET').toUpperCase(),
                            url: xhr.__ctxUrl || '',
                            requestType: 'xhr'
                        });
                    } catch(e) {}

                    xhr.addEventListener('loadend', function() {
                        try {
                            var body = '';
                            var size = 0;
                            try {
                                body = xhr.responseText || '';
                                size = body.length;
                            } catch(e) {}
                            var respHeaders = {};
                            try {
                                var raw = xhr.getAllResponseHeaders() || '';
                                raw.split('\\r\\n').forEach(function(line) {
                                    var idx = line.indexOf(': ');
                                    if (idx > 0) respHeaders[line.substring(0, idx)] = line.substring(idx + 2);
                                });
                            } catch(e) {}
                            window.webkit.messageHandlers.networkMonitor.postMessage({
                                type: 'requestComplete',
                                requestId: id,
                                status: xhr.status,
                                statusText: xhr.statusText,
                                duration: (Date.now() - startTime) / 1000.0,
                                responseSize: size,
                                responseHeaders: respHeaders,
                                responseBody: body.substring(0, 2000)
                            });
                        } catch(e) {}
                    });

                    xhr.addEventListener('error', function() {
                        try {
                            window.webkit.messageHandlers.networkMonitor.postMessage({
                                type: 'requestError', requestId: id, error: 'Network error'
                            });
                        } catch(e) {}
                    });

                    xhr.addEventListener('abort', function() {
                        try {
                            window.webkit.messageHandlers.networkMonitor.postMessage({
                                type: 'requestError', requestId: id, error: 'Request aborted'
                            });
                        } catch(e) {}
                    });

                    xhr.addEventListener('timeout', function() {
                        try {
                            window.webkit.messageHandlers.networkMonitor.postMessage({
                                type: 'requestError', requestId: id, error: 'Request timed out'
                            });
                        } catch(e) {}
                    });

                    return window.__ctxOrigXHRSend.apply(this, arguments);
                };
            })();
        """

        // Use WKUserScript so the injection persists across page navigations
        let script = WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        networkMonitorScript = script
        webView.configuration.userContentController.addUserScript(script)

        // Also inject into the current page immediately
        webView.evaluateJavaScript(js) { _, _ in }
    }

    /// Remove JS monkey-patches by restoring original fetch and XMLHttpRequest.
    @MainActor
    func stopNetworkMonitor() {
        isNetworkMonitorActive = false

        // Remove the persistent user script
        if let script = networkMonitorScript {
            let controller = webView.configuration.userContentController
            let remaining = controller.userScripts.filter { $0 !== script }
            controller.removeAllUserScripts()
            for s in remaining { controller.addUserScript(s) }
            networkMonitorScript = nil
        }

        // Clean up in the current page
        let js = """
            (function() {
                if (window.__ctxOrigFetch) { window.fetch = window.__ctxOrigFetch; delete window.__ctxOrigFetch; }
                if (window.__ctxOrigXHROpen) { XMLHttpRequest.prototype.open = window.__ctxOrigXHROpen; delete window.__ctxOrigXHROpen; }
                if (window.__ctxOrigXHRSend) { XMLHttpRequest.prototype.send = window.__ctxOrigXHRSend; delete window.__ctxOrigXHRSend; }
                delete window.__ctxNetworkMonitorActive;
            })();
        """
        webView.evaluateJavaScript(js) { _, _ in }
    }

    /// Clear all captured network requests.
    func clearNetworkRequests() {
        networkRequests.removeAll()
    }

    // MARK: - DevTools Element Picker

    /// Inject an overlay that highlights hovered elements and captures clicks.
    @MainActor
    func startElementPicker() {
        isElementPickerActive = true
        let js = """
            (function() {
                if (document.getElementById('__ctx_devtools_overlay')) return;
                const overlay = document.createElement('div');
                overlay.id = '__ctx_devtools_overlay';
                overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #2196F3;background:rgba(33,150,243,0.1);z-index:2147483647;display:none;transition:none;';
                document.body.appendChild(overlay);

                function getSelector(el) {
                    if (el.id) return '#' + CSS.escape(el.id);
                    const parts = [];
                    let cur = el;
                    while (cur && cur !== document.body && cur !== document.documentElement) {
                        let seg = cur.tagName.toLowerCase();
                        if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
                        const parent = cur.parentElement;
                        if (parent) {
                            const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
                            if (siblings.length > 1) {
                                const idx = siblings.indexOf(cur) + 1;
                                seg += ':nth-of-type(' + idx + ')';
                            }
                        }
                        parts.unshift(seg);
                        cur = parent;
                    }
                    return parts.join(' > ');
                }

                function onMove(e) {
                    const el = document.elementFromPoint(e.clientX, e.clientY);
                    if (!el || el === overlay) { overlay.style.display = 'none'; return; }
                    const r = el.getBoundingClientRect();
                    overlay.style.top = r.top + 'px';
                    overlay.style.left = r.left + 'px';
                    overlay.style.width = r.width + 'px';
                    overlay.style.height = r.height + 'px';
                    overlay.style.display = 'block';
                }

                function onClick(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const el = document.elementFromPoint(e.clientX, e.clientY);
                    if (!el || el === overlay) return;

                    const r = el.getBoundingClientRect();
                    const attrs = {};
                    for (const a of el.attributes) { attrs[a.name] = a.value; }

                    const children = Array.from(el.children).slice(0, 20).map(c => ({
                        tagName: c.tagName.toLowerCase(),
                        elementId: c.id || null,
                        classes: Array.from(c.classList),
                        selector: getSelector(c)
                    }));

                    let parentInfo = null;
                    if (el.parentElement && el.parentElement !== document.body) {
                        const p = el.parentElement;
                        parentInfo = {
                            tagName: p.tagName.toLowerCase(),
                            elementId: p.id || null,
                            classes: Array.from(p.classList),
                            selector: getSelector(p)
                        };
                    }

                    window.webkit.messageHandlers.devtools.postMessage({
                        type: 'elementSelected',
                        tagName: el.tagName.toLowerCase(),
                        id: el.id || null,
                        classes: Array.from(el.classList),
                        attributes: attrs,
                        axRef: el.getAttribute('data-ax-ref') || null,
                        selector: getSelector(el),
                        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
                        children: children,
                        parent: parentInfo
                    });

                    // Clean up
                    document.removeEventListener('mousemove', onMove, true);
                    document.removeEventListener('click', onClick, true);
                    overlay.style.display = 'none';
                }

                document.addEventListener('mousemove', onMove, true);
                document.addEventListener('click', onClick, true);
            })();
        """
        webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .defaultClient) { _ in }
    }

    /// Remove the picker overlay and stop listening.
    @MainActor
    func stopElementPicker() {
        isElementPickerActive = false
        let js = """
            (function() {
                const overlay = document.getElementById('__ctx_devtools_overlay');
                if (overlay) overlay.remove();
            })();
        """
        webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .defaultClient) { _ in }
    }

    /// Fetch computed styles for the element matching the given CSS selector.
    @MainActor
    func fetchComputedStyles(selector: String) async -> ComputedStyles? {
        let js = """
            const el = document.querySelector(selector);
            if (!el) return null;
            const cs = window.getComputedStyle(el);

            const typoProps = ['font-family','font-size','font-weight','font-style','line-height',
                'letter-spacing','text-align','text-decoration','text-transform','white-space','word-spacing'];
            const layoutProps = ['display','position','float','clear','overflow','overflow-x','overflow-y',
                'box-sizing','flex-direction','flex-wrap','justify-content','align-items','align-self',
                'grid-template-columns','grid-template-rows','gap'];
            const spacingProps = ['padding-top','padding-right','padding-bottom','padding-left',
                'margin-top','margin-right','margin-bottom','margin-left','width','height',
                'min-width','min-height','max-width','max-height','top','right','bottom','left'];
            const colorProps = ['color','background-color','background','opacity'];
            const borderProps = ['border-top','border-right','border-bottom','border-left',
                'border-radius','outline','box-shadow'];

            function gather(props) { return props.map(p => [p, cs.getPropertyValue(p)]).filter(([,v]) => v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px'); }

            const allKnown = new Set([...typoProps,...layoutProps,...spacingProps,...colorProps,...borderProps]);
            const other = [];
            for (let i = 0; i < cs.length; i++) {
                const p = cs[i];
                if (!allKnown.has(p)) {
                    const v = cs.getPropertyValue(p);
                    if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'initial' && v !== 'inherit') {
                        other.push([p, v]);
                    }
                }
            }

            return {
                typography: gather(typoProps),
                layout: gather(layoutProps),
                spacing: gather(spacingProps),
                colors: gather(colorProps),
                border: gather(borderProps),
                other: other.slice(0, 30)
            };
        """

        return await withCheckedContinuation { continuation in
            webView.callAsyncJavaScript(
                js,
                arguments: ["selector": selector],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    guard let dict = value as? [String: Any] else {
                        continuation.resume(returning: nil)
                        return
                    }
                    func parsePairs(_ key: String) -> [(String, String)] {
                        guard let arr = dict[key] as? [[Any]] else { return [] }
                        return arr.compactMap { pair in
                            guard pair.count == 2,
                                  let k = pair[0] as? String,
                                  let v = pair[1] as? String else { return nil }
                            return (k, v)
                        }
                    }
                    let styles = ComputedStyles(
                        typography: parsePairs("typography"),
                        layout: parsePairs("layout"),
                        spacing: parsePairs("spacing"),
                        colors: parsePairs("colors"),
                        border: parsePairs("border"),
                        other: parsePairs("other")
                    )
                    continuation.resume(returning: styles)
                case .failure:
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    /// Fetch box model dimensions for the element matching the given CSS selector.
    @MainActor
    func fetchBoxModel(selector: String) async -> BoxModelData? {
        let js = """
            const el = document.querySelector(selector);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            function pf(v) { return parseFloat(v) || 0; }
            return {
                content: { width: r.width, height: r.height },
                padding: {
                    top: pf(cs.paddingTop), right: pf(cs.paddingRight),
                    bottom: pf(cs.paddingBottom), left: pf(cs.paddingLeft)
                },
                border: {
                    top: pf(cs.borderTopWidth), right: pf(cs.borderRightWidth),
                    bottom: pf(cs.borderBottomWidth), left: pf(cs.borderLeftWidth)
                },
                margin: {
                    top: pf(cs.marginTop), right: pf(cs.marginRight),
                    bottom: pf(cs.marginBottom), left: pf(cs.marginLeft)
                }
            };
        """

        return await withCheckedContinuation { continuation in
            webView.callAsyncJavaScript(
                js,
                arguments: ["selector": selector],
                in: nil,
                in: .defaultClient
            ) { result in
                switch result {
                case .success(let value):
                    guard let dict = value as? [String: Any],
                          let content = dict["content"] as? [String: Double],
                          let padding = dict["padding"] as? [String: Double],
                          let border = dict["border"] as? [String: Double],
                          let margin = dict["margin"] as? [String: Double] else {
                        continuation.resume(returning: nil)
                        return
                    }
                    let box = BoxModelData(
                        content: (width: content["width"] ?? 0, height: content["height"] ?? 0),
                        padding: (top: padding["top"] ?? 0, right: padding["right"] ?? 0,
                                  bottom: padding["bottom"] ?? 0, left: padding["left"] ?? 0),
                        border: (top: border["top"] ?? 0, right: border["right"] ?? 0,
                                 bottom: border["bottom"] ?? 0, left: border["left"] ?? 0),
                        margin: (top: margin["top"] ?? 0, right: margin["right"] ?? 0,
                                 bottom: margin["bottom"] ?? 0, left: margin["left"] ?? 0)
                    )
                    continuation.resume(returning: box)
                case .failure:
                    continuation.resume(returning: nil)
                }
            }
        }
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
            if (e.id) { const l = document.querySelector('label[for="'+e.id+'"]'); if (l) return l.textContent.trim(); }
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
            if (e.value && ia.has(gr(e))) a.push('value="' + e.value.slice(0,30) + '"');
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
            const ns = nm ? ' "' + nm + '"' : '';
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

    // MARK: - WKScriptMessageHandler

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "consoleLog" {
            guard let body = message.body as? [String: String],
                  let level = body["level"],
                  let msg = body["message"]
            else { return }

            DispatchQueue.main.async { [weak self] in
                self?.addConsoleLog(level: level, message: msg)
            }
        } else if message.name == "devtools" {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String
            else { return }

            if type == "elementSelected" {
                let tagName = body["tagName"] as? String ?? "unknown"
                let elId = body["id"] as? String
                let classes = body["classes"] as? [String] ?? []
                let attributes = body["attributes"] as? [String: String] ?? [:]
                let axRef = body["axRef"] as? String
                let selector = body["selector"] as? String ?? ""

                var rect = ElementRect(x: 0, y: 0, width: 0, height: 0)
                if let r = body["rect"] as? [String: Double] {
                    rect = ElementRect(x: r["x"] ?? 0, y: r["y"] ?? 0, width: r["width"] ?? 0, height: r["height"] ?? 0)
                }

                var children: [ElementSummary] = []
                if let childArr = body["children"] as? [[String: Any]] {
                    children = childArr.map { c in
                        ElementSummary(
                            tagName: c["tagName"] as? String ?? "unknown",
                            elementId: c["elementId"] as? String,
                            classes: c["classes"] as? [String] ?? [],
                            selector: c["selector"] as? String ?? ""
                        )
                    }
                }

                var parent: ElementSummary?
                if let p = body["parent"] as? [String: Any] {
                    parent = ElementSummary(
                        tagName: p["tagName"] as? String ?? "unknown",
                        elementId: p["elementId"] as? String,
                        classes: p["classes"] as? [String] ?? [],
                        selector: p["selector"] as? String ?? ""
                    )
                }

                let element = InspectedElement(
                    selector: selector,
                    tagName: tagName,
                    id: elId,
                    classes: classes,
                    attributes: attributes,
                    axRef: axRef,
                    rect: rect,
                    children: children,
                    parent: parent
                )

                DispatchQueue.main.async { [weak self] in
                    self?.inspectedElement = element
                    self?.isElementPickerActive = false

                    // Fetch styles and box model asynchronously
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        async let styles = self.fetchComputedStyles(selector: selector)
                        async let boxModel = self.fetchBoxModel(selector: selector)
                        self.inspectedStyles = await styles
                        self.inspectedBoxModel = await boxModel
                    }
                }
            }
        } else if message.name == "networkMonitor" {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String
            else { return }

            DispatchQueue.main.async { [weak self] in
                guard let self else { return }

                switch type {
                case "requestStart":
                    guard let requestId = body["requestId"] as? String,
                          let method = body["method"] as? String,
                          let url = body["url"] as? String,
                          let requestType = body["requestType"] as? String
                    else { return }

                    let reqHeaders = body["requestHeaders"] as? [String: String]
                    let entry = NetworkRequestEntry(
                        id: requestId,
                        method: method,
                        url: url,
                        type: NetworkRequestEntry.RequestType(rawValue: requestType) ?? .fetch,
                        startTime: Date(),
                        requestHeaders: reqHeaders
                    )
                    self.networkRequests.append(entry)

                    // Cap at max entries
                    if self.networkRequests.count > Self.maxNetworkEntries {
                        self.networkRequests.removeFirst(self.networkRequests.count - Self.maxNetworkEntries)
                    }

                case "requestComplete":
                    guard let requestId = body["requestId"] as? String else { return }
                    if let index = self.networkRequests.firstIndex(where: { $0.id == requestId }) {
                        self.networkRequests[index].status = body["status"] as? Int
                        self.networkRequests[index].statusText = body["statusText"] as? String
                        self.networkRequests[index].duration = body["duration"] as? TimeInterval
                        self.networkRequests[index].responseSize = body["responseSize"] as? Int
                        self.networkRequests[index].responseHeaders = body["responseHeaders"] as? [String: String]
                        self.networkRequests[index].responseBody = body["responseBody"] as? String
                        self.networkRequests[index].isComplete = true
                    }

                case "requestError":
                    guard let requestId = body["requestId"] as? String else { return }
                    if let index = self.networkRequests.firstIndex(where: { $0.id == requestId }) {
                        self.networkRequests[index].isError = true
                        self.networkRequests[index].isComplete = true
                    }

                default:
                    break
                }
            }
        }
    }
}

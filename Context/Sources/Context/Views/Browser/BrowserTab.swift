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

    private static let maxLogEntries = 500
    private var observations: [NSKeyValueObservation] = []

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

    override init() {
        let config = WKWebViewConfiguration()
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

        // Register message handler via weak proxy
        config.userContentController.add(WeakScriptMessageHandler(delegate: self), name: "consoleLog")

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

    // MARK: - Automation Methods

    /// Serialize the page's accessibility tree into compact structured text for LLM consumption.
    /// Runs in .defaultClient content world (invisible to page JS, bypasses CSP).
    @MainActor
    func snapshotAccessibilityTree() async throws -> String {
        let js = "try { return " + Self.accessibilityTreeJS + " } catch(e) { return 'ERROR: ' + e.message; }"
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
                    continuation.resume(returning: ["hovered": true, "navigated": true])
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
        guard message.name == "consoleLog",
              let body = message.body as? [String: String],
              let level = body["level"],
              let msg = body["message"]
        else { return }

        DispatchQueue.main.async { [weak self] in
            self?.addConsoleLog(level: level, message: msg)
        }
    }
}

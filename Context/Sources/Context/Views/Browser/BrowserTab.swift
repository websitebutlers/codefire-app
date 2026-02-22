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

import SwiftUI
import WebKit
import GRDB

struct BrowserView: View {
    @ObservedObject var viewModel: BrowserViewModel
    @EnvironmentObject var appState: AppState
    @State private var urlText: String = ""
    @FocusState private var isUrlBarFocused: Bool

    // Sheet management
    enum BrowserSheet: Identifiable {
        case annotation(NSImage)
        case captureIssue(NSImage)

        var id: String {
            switch self {
            case .annotation: return "annotation"
            case .captureIssue: return "captureIssue"
            }
        }
    }

    @State private var activeSheet: BrowserSheet?
    @State private var showConsolePopover = false
    @State private var showDevTools = false

    var body: some View {
        VStack(spacing: 0) {
            // Nav bar
            navBar
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color(nsColor: .windowBackgroundColor))

            Rectangle()
                .fill(Color(nsColor: .separatorColor).opacity(0.5))
                .frame(height: 1)

            // Tab strip
            tabStrip
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .background(Color(nsColor: .windowBackgroundColor))

            Rectangle()
                .fill(Color(nsColor: .separatorColor).opacity(0.5))
                .frame(height: 1)

            // Web content — only the active tab's WKWebView is rendered.
            // Inactive tabs are unloaded (blank HTML) to free memory.
            Group {
                if let activeTab = viewModel.activeTab {
                    WebViewWrapper(webView: activeTab.webView)
                } else {
                    VStack(spacing: 8) {
                        Image(systemName: "globe")
                            .font(.system(size: 24))
                            .foregroundStyle(.tertiary)
                        Text("No tabs open")
                            .font(.system(size: 12))
                            .foregroundStyle(.tertiary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }

            // DevTools panel
            if showDevTools, let activeTab = viewModel.activeTab {
                Divider()
                DevToolsPanel(tab: activeTab, isVisible: $showDevTools)
                    .frame(height: 250)
            }

            // Screenshot gallery strip
            if let projectId = appState.currentProject?.id {
                Divider()
                ScreenshotGalleryStrip(projectId: projectId)
            }
        }
        .onChange(of: viewModel.activeTabId) { oldId, newId in
            // Stop element picker and unload the previously active tab to free memory
            if let oldId, let oldTab = viewModel.tabs.first(where: { $0.id == oldId }) {
                oldTab.stopElementPicker()
                oldTab.unloadWebView()
            }
            // Reload the newly active tab if it was unloaded
            if let newId, let newTab = viewModel.tabs.first(where: { $0.id == newId }) {
                newTab.reloadIfNeeded()
            }
            syncURLBar()
        }
        .onReceive(viewModel.objectWillChange) { _ in
            // When any tab property changes, keep the URL bar in sync
            DispatchQueue.main.async {
                syncURLBar()
            }
        }
        .background {
            Group {
                Button("") { viewModel.newTab() }
                    .keyboardShortcut("t", modifiers: .command)
                Button("") {
                    if let id = viewModel.activeTabId {
                        viewModel.closeTab(id)
                    }
                }
                    .keyboardShortcut("w", modifiers: .command)
                Button("") { viewModel.activeTab?.webView.reload() }
                    .keyboardShortcut("r", modifiers: .command)
                Button("") { isUrlBarFocused = true }
                    .keyboardShortcut("l", modifiers: .command)
            }
            .frame(width: 0, height: 0)
            .opacity(0)
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .annotation(let img):
                ScreenshotAnnotationView(
                    image: img,
                    onSave: { finalImage in
                        saveScreenshot(finalImage)
                        activeSheet = nil
                    },
                    onCancel: {
                        activeSheet = nil
                    }
                )

            case .captureIssue(let img):
                CaptureIssueSheet(
                    screenshotImage: img,
                    pageURL: viewModel.activeTab?.currentURL,
                    pageTitle: viewModel.activeTab?.title,
                    consoleLogs: viewModel.activeTab?.consoleLogs ?? [],
                    projectId: appState.currentProject?.id ?? "__global__",
                    onDismiss: {
                        activeSheet = nil
                    }
                )
            }
        }
    }

    // MARK: - Nav Bar

    private var navBar: some View {
        HStack(spacing: 6) {
            // Back
            Button {
                viewModel.activeTab?.webView.goBack()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 12, weight: .medium))
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(viewModel.activeTab?.canGoBack != true)
            .foregroundColor(viewModel.activeTab?.canGoBack == true ? .primary : .secondary.opacity(0.4))

            // Forward
            Button {
                viewModel.activeTab?.webView.goForward()
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .medium))
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(viewModel.activeTab?.canGoForward != true)
            .foregroundColor(viewModel.activeTab?.canGoForward == true ? .primary : .secondary.opacity(0.4))

            // Reload / Stop
            Button {
                if let tab = viewModel.activeTab {
                    if tab.isLoading {
                        tab.webView.stopLoading()
                    } else {
                        tab.webView.reload()
                    }
                }
            } label: {
                Image(systemName: viewModel.activeTab?.isLoading == true ? "xmark" : "arrow.clockwise")
                    .font(.system(size: 11, weight: .medium))
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(viewModel.activeTab == nil)
            .foregroundColor(viewModel.activeTab != nil ? .primary : .secondary.opacity(0.4))

            // URL field
            TextField("Enter URL", text: $urlText)
                .textFieldStyle(.plain)
                .font(.system(size: 12, design: .monospaced))
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color(nsColor: .textBackgroundColor))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(nsColor: .separatorColor).opacity(0.5), lineWidth: 0.5)
                )
                .focused($isUrlBarFocused)
                .onSubmit {
                    let trimmed = urlText.trimmingCharacters(in: .whitespaces)
                    guard !trimmed.isEmpty else { return }
                    if viewModel.tabs.isEmpty {
                        viewModel.newTab()
                    }
                    viewModel.activeTab?.navigate(to: trimmed)
                }

            // Screenshot
            Button {
                takeScreenshot { image in
                    activeSheet = .annotation(image)
                }
            } label: {
                Image(systemName: "camera")
                    .font(.system(size: 11, weight: .medium))
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(viewModel.activeTab == nil)
            .foregroundColor(viewModel.activeTab != nil ? .primary : .secondary.opacity(0.4))

            // Capture Issue
            Button {
                takeScreenshot { image in
                    activeSheet = .captureIssue(image)
                }
            } label: {
                Image(systemName: "ladybug")
                    .font(.system(size: 11, weight: .medium))
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(viewModel.activeTab == nil)
            .foregroundColor(viewModel.activeTab != nil ? .primary : .secondary.opacity(0.4))
            .help("Capture Issue")

            // Console log badge
            Button {
                showConsolePopover.toggle()
            } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "terminal")
                        .font(.system(size: 11, weight: .medium))
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())

                    if let tab = viewModel.activeTab, !tab.consoleLogs.isEmpty {
                        let count = tab.consoleLogs.count
                        Text(count > 99 ? "99+" : "\(count)")
                            .font(.system(size: 7, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 3)
                            .padding(.vertical, 1)
                            .background(
                                Capsule()
                                    .fill(tab.errorCount > 0 ? Color.red : (tab.warningCount > 0 ? Color.orange : Color.secondary))
                            )
                            .offset(x: 4, y: -2)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(viewModel.activeTab == nil)
            .foregroundColor(viewModel.activeTab != nil ? .primary : .secondary.opacity(0.4))
            .popover(isPresented: $showConsolePopover, arrowEdge: .bottom) {
                if let tab = viewModel.activeTab {
                    ConsoleLogPopover(tab: tab)
                }
            }

            // DevTools toggle
            Button {
                showDevTools.toggle()
            } label: {
                Image(systemName: "hammer")
                    .font(.system(size: 11, weight: .medium))
                    .frame(width: 26, height: 26)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(showDevTools ? Color.accentColor.opacity(0.2) : Color.clear)
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(viewModel.activeTab == nil)
            .foregroundColor(showDevTools ? .accentColor : (viewModel.activeTab != nil ? .primary : .secondary.opacity(0.4)))
            .help("Toggle DevTools")
        }
    }

    // MARK: - Tab Strip

    private var tabStrip: some View {
        HStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(viewModel.tabs) { tab in
                        browserTabButton(for: tab)
                    }
                }
            }

            Button(action: { viewModel.newTab() }) {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.secondary)
                    .frame(width: 26, height: 26)
                    .background(Color.clear)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.leading, 2)

            Spacer()
        }
    }

    // MARK: - Tab Button (matches terminal tab style)

    @ViewBuilder
    private func browserTabButton(for tab: BrowserTab) -> some View {
        let isSelected = tab.id == viewModel.activeTabId

        HStack(spacing: 4) {
            if tab.isLoading {
                ProgressView()
                    .controlSize(.mini)
                    .scaleEffect(0.6)
                    .frame(width: 10, height: 10)
            } else {
                Image(systemName: "globe")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(isSelected ? .primary : .secondary.opacity(0.5))
            }

            Text(tab.title)
                .font(.system(size: 11, weight: isSelected ? .medium : .regular))
                .lineLimit(1)
                .frame(maxWidth: 120, alignment: .leading)
                .foregroundColor(isSelected ? .primary : .secondary)

            if isSelected {
                Button(action: { viewModel.closeTab(tab.id) }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(.tertiary)
                        .frame(width: 14, height: 14)
                        .background(
                            Circle()
                                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.6))
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(isSelected
                      ? Color(nsColor: .controlBackgroundColor)
                      : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 5)
                .stroke(isSelected
                        ? Color(nsColor: .separatorColor).opacity(0.3)
                        : Color.clear,
                        lineWidth: 0.5)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            viewModel.activeTabId = tab.id
        }
    }

    // MARK: - Helpers

    private func syncURLBar() {
        if let tab = viewModel.activeTab {
            urlText = tab.currentURL
        }
    }

    private func takeScreenshot(completion: @escaping (NSImage) -> Void) {
        guard let tab = viewModel.activeTab else { return }

        let config = WKSnapshotConfiguration()
        tab.webView.takeSnapshot(with: config) { image, error in
            if let error = error {
                print("BrowserView: snapshot failed: \(error)")
                return
            }
            guard let image = image else {
                print("BrowserView: snapshot returned nil image")
                return
            }
            DispatchQueue.main.async {
                completion(image)
            }
        }
    }

    private func saveScreenshot(_ image: NSImage) {
        guard let tiffData = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiffData),
              let pngData = bitmap.representation(using: .png, properties: [:]) else {
            print("BrowserView: failed to convert image to PNG")
            return
        }

        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!.appendingPathComponent("CodeFire/browser-screenshots", isDirectory: true)

        do {
            try FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        } catch {
            print("BrowserView: failed to create screenshots directory: \(error)")
            return
        }

        let filename = "screenshot-\(ISO8601DateFormatter().string(from: Date())).png"
            .replacingOccurrences(of: ":", with: "-")
        let fileURL = appSupport.appendingPathComponent(filename)

        do {
            try pngData.write(to: fileURL)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(fileURL.path, forType: .string)
            print("BrowserView: screenshot saved to \(fileURL.path)")

            // Also save to DB if we have a project context
            if let projectId = appState.currentProject?.id {
                var screenshot = BrowserScreenshot(
                    projectId: projectId,
                    filePath: fileURL.path,
                    pageURL: viewModel.activeTab?.currentURL,
                    pageTitle: viewModel.activeTab?.title,
                    createdAt: Date()
                )
                try DatabaseService.shared.dbQueue.write { db in
                    try screenshot.insert(db)
                }
                NotificationCenter.default.post(name: .screenshotsDidChange, object: nil)
            }
        } catch {
            print("BrowserView: failed to write screenshot: \(error)")
        }
    }
}

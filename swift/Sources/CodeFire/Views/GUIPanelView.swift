import SwiftUI

// MARK: - MCP Connection Monitor

struct MCPConnection: Identifiable {
    let id: Int // PID
    let cwd: String
    let projectId: String?
    let projectName: String?
    let connectedAt: String
}

class MCPConnectionMonitor: ObservableObject {
    @Published var connections: [MCPConnection] = []

    private var timer: Timer?
    private let statusDir: URL

    init() {
        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!.appendingPathComponent("CodeFire/mcp-connections", isDirectory: true)
        statusDir = appSupport
    }

    func startPolling() {
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    private func poll() {
        guard FileManager.default.fileExists(atPath: statusDir.path) else {
            DispatchQueue.main.async { self.connections = [] }
            return
        }

        var active: [MCPConnection] = []
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: statusDir, includingPropertiesForKeys: nil
        ) else {
            DispatchQueue.main.async { self.connections = [] }
            return
        }

        for file in files where file.pathExtension == "json" {
            guard let pidStr = file.deletingPathExtension().lastPathComponent.components(separatedBy: ".").first,
                  let pid = Int(pidStr) else { continue }

            // Check if process is still running
            if kill(Int32(pid), 0) != 0 {
                // Process is dead — clean up stale file
                try? FileManager.default.removeItem(at: file)
                continue
            }

            guard let data = try? Data(contentsOf: file),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }

            active.append(MCPConnection(
                id: pid,
                cwd: json["cwd"] as? String ?? "unknown",
                projectId: json["projectId"] as? String,
                projectName: json["projectName"] as? String,
                connectedAt: json["connectedAt"] as? String ?? ""
            ))
        }

        DispatchQueue.main.async { self.connections = active }
    }
}

struct GUIPanelView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var contextEngine: ContextEngine
    @ObservedObject private var premiumService = PremiumService.shared
    @StateObject private var mcpMonitor = MCPConnectionMonitor()
    @StateObject private var browserViewModel = BrowserViewModel()
    @StateObject private var browserCommandExecutor = BrowserCommandExecutor()
    @EnvironmentObject var appSettings: AppSettings
    @State private var mcpBannerDismissed = false
    @State private var mcpSetupResult: String?
    @State private var showMCPSetupAlert = false

    var body: some View {
        VStack(spacing: 0) {
            if appState.isHomeView {
                if appState.selectedTab == .browser {
                    BrowserView(viewModel: browserViewModel)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    // Home view header
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 6)
                            .fill(Color.accentColor.gradient)
                            .frame(width: 28, height: 28)
                            .overlay(
                                Image(systemName: "house.fill")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundColor(.white)
                            )
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Planner")
                                .font(.system(size: 13, weight: .semibold))
                            Text("Global tasks & emails")
                                .font(.system(size: 10))
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        MCPIndicator(connections: mcpMonitor.connections, currentProjectId: nil)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)

                    Divider()

                    // Home content
                    HomeView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                // Project header (simplified — no dropdown picker)
                projectHeader
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)

                Divider()

                // MCP setup banner
                mcpSetupBanner

                // Tab bar
                tabBar
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)

                Divider()

                // Tab content — browser persists via ZStack, others switch normally
                ZStack {
                    // Browser always exists in the ZStack (hidden when not selected)
                    BrowserView(viewModel: browserViewModel)
                        .opacity(appState.selectedTab == .browser ? 1 : 0)
                        .allowsHitTesting(appState.selectedTab == .browser)

                    // Other tabs render on demand
                    if appState.selectedTab != .browser {
                        Group {
                            switch appState.selectedTab {
                            case .dashboard:
                                DashboardView()
                            case .sessions:
                                SessionListView()
                            case .tasks:
                                KanbanBoard()
                            case .notes:
                                NoteListView()
                            case .files:
                                FileBrowserView()
                            case .memory:
                                MemoryEditorView()
                            case .rules:
                                ClaudeMdEditorView()
                            case .services:
                                ProjectServicesView()
                            case .git:
                                GitChangesView()
                            case .images:
                                ImageStudioView()
                            case .visualize:
                                VisualizerView()
                            case .recordings:
                                RecordingsView()
                            case .activity:
                                ActivityFeedView()
                            case .docs:
                                ProjectDocsView()
                            case .reviews:
                                ReviewRequestsView()
                            case .browser:
                                EmptyView() // Handled above in ZStack
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear {
            mcpMonitor.startPolling()
            browserCommandExecutor.start(browserViewModel: browserViewModel)
            Task { await CLIProvider.refreshInstallationStatus() }
        }
        .onDisappear {
            mcpMonitor.stopPolling()
            browserCommandExecutor.stop()
        }
        .onChange(of: appState.currentProject) { _, _ in
            mcpBannerDismissed = false  // Reset banner on project change
        }
        .onChange(of: premiumService.status.authenticated) { _, _ in
            // If user signed out while viewing a team tab, fall back to Tasks
            if Self.teamTabs.contains(appState.selectedTab) &&
               !(premiumService.status.authenticated && premiumService.status.user != nil) {
                appState.selectedTab = .tasks
            }
        }
        .alert("MCP Setup", isPresented: $showMCPSetupAlert) {
            Button("OK") {}
        } message: {
            Text(mcpSetupResult ?? "")
        }
    }

    // MARK: - Project Header

    private var projectHeader: some View {
        HStack(spacing: 10) {
            if let project = appState.currentProject {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.accentColor.gradient)
                    .frame(width: 28, height: 28)
                    .overlay(
                        Image(systemName: "folder.fill")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.white)
                    )

                VStack(alignment: .leading, spacing: 1) {
                    Text(project.name)
                        .font(.system(size: 13, weight: .semibold))
                    Text(project.path)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            Spacer()

            PresenceAvatarsView(projectId: appState.currentProject?.id)
            terminalToggle
            openInMenu
            NotificationBellView()
            IndexIndicator(
                isIndexing: contextEngine.isIndexing,
                indexStatus: contextEngine.indexStatus,
                progress: contextEngine.indexProgress,
                totalChunks: contextEngine.totalChunks,
                lastError: contextEngine.lastError,
                isEmbedding: contextEngine.isEmbedding,
                embeddingProgress: contextEngine.embeddingProgress,
                onReindex: {
                    contextEngine.rebuildIndex()
                },
                onClearIndex: {
                    Task { await contextEngine.clearIndex() }
                }
            )
            ProfileIndicator(
                isGenerating: appState.isProfileGenerating,
                hasProfile: appState.projectProfile != nil
            )
            MCPIndicator(connections: mcpMonitor.connections, currentProjectId: appState.currentProject?.id, projectPath: appState.currentProject?.path)
        }
    }

    // MARK: - Terminal Toggle

    private var terminalToggle: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                appState.showTerminal.toggle()
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "terminal")
                    .font(.system(size: 10, weight: appState.showTerminal ? .semibold : .regular))
                    .foregroundColor(appState.showTerminal ? .accentColor : .secondary)
                Text("Terminal")
                    .font(.system(size: 10, weight: appState.showTerminal ? .semibold : .medium))
                    .foregroundColor(appState.showTerminal ? .accentColor : .secondary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(appState.showTerminal ? Color.accentColor.opacity(0.12) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(appState.showTerminal ? "Hide Terminal" : "Show Terminal")
    }

    // MARK: - MCP Setup Banner

    @ViewBuilder
    private var mcpSetupBanner: some View {
        if !mcpBannerDismissed,
           let project = appState.currentProject {
            let injector = ContextInjector()
            let suggested = injector.suggestedCLIForSetup(
                projectPath: project.path,
                preferred: appSettings.preferredCLI
            )
            if let cli = suggested {
                let unconfigured = injector.unconfiguredCLIs(projectPath: project.path)

                HStack(spacing: 10) {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.accentColor)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("CodeFire MCP not configured")
                            .font(.system(size: 11, weight: .semibold))
                        Text("Connect your AI coding agent to this project's tasks, sessions, and codebase context.")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }

                    Spacer()

                    // Primary: set up for the suggested CLI
                    if unconfigured.count > 1 {
                        // Multiple unconfigured CLIs — use a menu
                        Menu {
                            ForEach(unconfigured, id: \.self) { c in
                                Button {
                                    performMCPSetup(cli: c, projectPath: project.path)
                                } label: {
                                    Label(c.displayName, systemImage: c.iconName)
                                }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Text("Set up for \(cli.shortName)")
                                    .font(.system(size: 11, weight: .semibold))
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 8, weight: .bold))
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.accentColor)
                            .foregroundColor(.white)
                            .cornerRadius(6)
                        }
                        .menuStyle(.borderlessButton)
                        .fixedSize()
                    } else {
                        // Single CLI — direct button
                        Button {
                            performMCPSetup(cli: cli, projectPath: project.path)
                        } label: {
                            Text("Set up for \(cli.shortName)")
                                .font(.system(size: 11, weight: .semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Color.accentColor)
                                .foregroundColor(.white)
                                .cornerRadius(6)
                        }
                        .buttonStyle(.plain)
                    }

                    Button {
                        withAnimation(.easeOut(duration: 0.2)) {
                            mcpBannerDismissed = true
                        }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Dismiss")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color.accentColor.opacity(0.06))
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private func performMCPSetup(cli: CLIProvider, projectPath: String) {
        let injector = ContextInjector()
        do {
            let configPath = try injector.installMCP(for: cli, projectPath: projectPath)
            mcpSetupResult = "MCP configured for \(cli.displayName) at \(configPath). Restart your CLI session to activate."
            showMCPSetupAlert = true
            withAnimation(.easeOut(duration: 0.2)) {
                mcpBannerDismissed = true
            }
        } catch {
            mcpSetupResult = "Failed to configure MCP: \(error.localizedDescription)"
            showMCPSetupAlert = true
        }
    }

    // MARK: - Open In Menu

    /// Apps that can open a project directory, detected at render time.
    private struct ExternalApp: Identifiable {
        let id: String // bundle identifier
        let name: String
        let icon: String // SF Symbol
        let category: String // "IDE" or "Terminal"

        static let catalog: [ExternalApp] = [
            // IDEs / Editors
            ExternalApp(id: "com.microsoft.VSCode", name: "VS Code", icon: "chevron.left.forwardslash.chevron.right", category: "IDE"),
            ExternalApp(id: "com.todesktop.230313mzl4w4u92", name: "Cursor", icon: "cursorarrow.rays", category: "IDE"),
            ExternalApp(id: "dev.zed.Zed", name: "Zed", icon: "bolt.fill", category: "IDE"),
            ExternalApp(id: "com.codeium.windsurf", name: "Windsurf", icon: "wind", category: "IDE"),
            ExternalApp(id: "com.apple.dt.Xcode", name: "Xcode", icon: "hammer.fill", category: "IDE"),
            ExternalApp(id: "com.sublimetext.4", name: "Sublime Text", icon: "text.cursor", category: "IDE"),
            ExternalApp(id: "com.jetbrains.intellij", name: "IntelliJ IDEA", icon: "brain", category: "IDE"),
            ExternalApp(id: "com.jetbrains.WebStorm", name: "WebStorm", icon: "globe", category: "IDE"),
            ExternalApp(id: "com.jetbrains.pycharm", name: "PyCharm", icon: "cube.fill", category: "IDE"),
            // Terminals
            ExternalApp(id: "com.apple.Terminal", name: "Terminal", icon: "terminal", category: "Terminal"),
            ExternalApp(id: "com.googlecode.iterm2", name: "iTerm", icon: "terminal.fill", category: "Terminal"),
            ExternalApp(id: "dev.warp.Warp-Stable", name: "Warp", icon: "bolt.horizontal.fill", category: "Terminal"),
            ExternalApp(id: "net.kovidgoyal.kitty", name: "Kitty", icon: "cat.fill", category: "Terminal"),
            ExternalApp(id: "io.alacritty", name: "Alacritty", icon: "rectangle.on.rectangle", category: "Terminal"),
            ExternalApp(id: "com.mitchellh.ghostty", name: "Ghostty", icon: "ghost", category: "Terminal"),
        ]

        /// Returns only apps that are currently installed.
        static var installed: [ExternalApp] {
            catalog.filter { app in
                NSWorkspace.shared.urlForApplication(withBundleIdentifier: app.id) != nil
            }
        }
    }

    private var openInMenu: some View {
        Menu {
            let apps = ExternalApp.installed
            let ides = apps.filter { $0.category == "IDE" }
            let terminals = apps.filter { $0.category == "Terminal" }

            if !ides.isEmpty {
                Section("Editors") {
                    ForEach(ides) { app in
                        Button {
                            openProjectIn(app)
                        } label: {
                            Label(app.name, systemImage: app.icon)
                        }
                    }
                }
            }
            if !terminals.isEmpty {
                Section("Terminals") {
                    ForEach(terminals) { app in
                        Button {
                            openProjectIn(app)
                        } label: {
                            Label(app.name, systemImage: app.icon)
                        }
                    }
                }
            }

            if let path = appState.currentProject?.path {
                Divider()
                Button {
                    NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: path)
                } label: {
                    Label("Reveal in Finder", systemImage: "folder")
                }
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "arrow.up.forward.app")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                Text("Open In")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(Color.clear)
            )
            .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .help("Open project in an external editor or terminal")
    }

    private func openProjectIn(_ app: ExternalApp) {
        guard let path = appState.currentProject?.path,
              let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: app.id)
        else { return }

        let projectURL = URL(fileURLWithPath: path)
        let config = NSWorkspace.OpenConfiguration()
        NSWorkspace.shared.open([projectURL], withApplicationAt: appURL, configuration: config)
    }

    // MARK: - Tab Bar

    /// Tabs hidden from the tab bar (but code kept for later re-enabling).
    private static let hiddenTabs: Set<AppState.GUITab> = [.visualize]

    /// Tabs that require team authentication (Supabase session).
    private static let teamTabs: Set<AppState.GUITab> = [.activity, .docs, .reviews]

    private var visibleTabs: [AppState.GUITab] {
        let isAuthenticated = premiumService.status.authenticated && premiumService.status.user != nil
        return AppState.GUITab.allCases.filter { tab in
            if Self.hiddenTabs.contains(tab) { return false }
            if Self.teamTabs.contains(tab) && !isAuthenticated { return false }
            return true
        }
    }

    private var tabBar: some View {
        GeometryReader { geometry in
            let iconOnly = geometry.size.width < 600
            HStack(spacing: 2) {
                ForEach(visibleTabs, id: \.self) { tab in
                    TabButton(tab: tab, isSelected: appState.selectedTab == tab, iconOnly: iconOnly) {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            appState.selectedTab = tab
                        }
                    }
                }
                Spacer()
            }
        }
        .frame(height: 32)
    }
}

struct TabButton: View {
    let tab: AppState.GUITab
    let isSelected: Bool
    var iconOnly: Bool = false
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: iconOnly ? 0 : 5) {
                Image(systemName: tab.icon)
                    .font(.system(size: 11, weight: isSelected ? .semibold : .regular))
                if !iconOnly {
                    Text(tab.rawValue)
                        .font(.system(size: 12, weight: isSelected ? .semibold : .regular))
                }
            }
            .padding(.horizontal, iconOnly ? 8 : 12)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isSelected
                          ? Color.accentColor.opacity(0.12)
                          : isHovering ? Color(nsColor: .separatorColor).opacity(0.15) : Color.clear)
            )
            .foregroundColor(isSelected ? .accentColor : .secondary)
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            isHovering = hovering
        }
        .help(iconOnly ? tab.rawValue : "")
    }
}

// MARK: - MCP Connection Indicator

struct MCPIndicator: View {
    let connections: [MCPConnection]
    let currentProjectId: String?
    var projectPath: String? = nil

    @State private var setupResult: String?

    /// Connections matching the currently selected project.
    private var projectConnections: [MCPConnection] {
        guard let pid = currentProjectId else { return [] }
        return connections.filter { $0.projectId == pid }
    }

    private var isConnectedToCurrentProject: Bool {
        !projectConnections.isEmpty
    }

    private var statusColor: Color {
        isConnectedToCurrentProject ? .green : .orange
    }

    var body: some View {
        Group {
        if connections.isEmpty {
            // No MCP connections — click to setup
            Menu {
                Section("Setup MCP Server") {
                    ForEach(CLIProvider.allCases) { cli in
                        Button {
                            installMCP(for: cli)
                        } label: {
                            Label(cli.displayName, systemImage: cli.iconName)
                        }
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "antenna.radiowaves.left.and.right.slash")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary.opacity(0.5))
                    Text("MCP")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.secondary.opacity(0.5))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(Color(nsColor: .separatorColor).opacity(0.12))
                )
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
        } else {
            Menu {
                Section("MCP Connections (\(connections.count))") {
                    ForEach(connections) { conn in
                        let isCurrent = conn.projectId == currentProjectId
                        Label {
                            Text("\(conn.projectName ?? "Unknown") — PID \(conn.id)")
                        } icon: {
                            Image(systemName: isCurrent ? "checkmark.circle.fill" : "circle")
                        }
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(statusColor)
                    Text("MCP")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(statusColor)
                    if connections.count > 1 {
                        Text("\(connections.count)")
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundColor(.white)
                            .frame(width: 16, height: 16)
                            .background(Circle().fill(statusColor))
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(statusColor.opacity(0.12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 5)
                                .strokeBorder(statusColor.opacity(0.3), lineWidth: 1)
                        )
                )
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
        }
        } // Group
        .alert("MCP Setup", isPresented: Binding(
            get: { setupResult != nil },
            set: { if !$0 { setupResult = nil } }
        )) {
            Button("OK") { setupResult = nil }
        } message: {
            Text(setupResult ?? "")
        }
    }

    // MARK: - MCP Install

    private func installMCP(for cli: CLIProvider) {
        // For Claude Code, prefer the `claude mcp add` command
        if cli == .claude {
            let binaryPath = ContextInjector.mcpBinaryPath
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["claude", "mcp", "add", "codefire", binaryPath]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            do {
                try process.run()
                process.waitUntilExit()
                if process.terminationStatus == 0 {
                    setupResult = "MCP configured for \(cli.displayName). Restart your CLI session to activate."
                    return
                }
            } catch {}
        }

        // File-based config for other CLIs (or as Claude fallback)
        let injector = ContextInjector()
        do {
            let path = try injector.installMCP(for: cli, projectPath: projectPath ?? "")
            setupResult = "MCP configured for \(cli.displayName) at \(path)"
        } catch {
            setupResult = "Failed: \(error.localizedDescription)"
        }
    }

    private func shortenPath(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path.hasPrefix(home) {
            return "~" + path.dropFirst(home.count)
        }
        return path
    }
}

// MARK: - Index Indicator

struct IndexIndicator: View {
    let isIndexing: Bool
    let indexStatus: String
    let progress: Double
    let totalChunks: Int
    let lastError: String?
    var isEmbedding: Bool = false
    var embeddingProgress: Double = 0
    var onReindex: (() -> Void)?
    var onClearIndex: (() -> Void)?

    private var statusColor: Color {
        switch indexStatus {
        case "indexing": return .orange
        case "ready": return .green
        case "error": return .red
        case "idle": return .secondary.opacity(0.6)
        default: return .secondary.opacity(0.5)
        }
    }

    private var label: String {
        if isIndexing {
            return "Indexing \(Int(progress * 100))%"
        }
        switch indexStatus {
        case "ready": return "Indexed \(totalChunks)"
        case "error": return "Index Error"
        case "idle": return "Not Indexed"
        default: return "Codebase"
        }
    }

    private var isActive: Bool {
        true // Always show as active so the button is clearly interactive
    }

    var body: some View {
        Menu {
            if indexStatus == "no_key" {
                Text("Set OpenRouter API key in Settings")
            }
            if let error = lastError, indexStatus == "error" {
                Text(error)
            }

            Divider()

            Button {
                onReindex?()
            } label: {
                Label(indexStatus == "idle" || indexStatus == "no_key" ? "Index Codebase" : "Re-index Codebase",
                      systemImage: "arrow.clockwise")
            }
            .disabled(isIndexing || indexStatus == "no_key")

            if indexStatus == "ready" || indexStatus == "error" {
                Button(role: .destructive) {
                    onClearIndex?()
                } label: {
                    Label("Clear Index", systemImage: "trash")
                }
                .disabled(isIndexing)
            }
        } label: {
            HStack(spacing: 5) {
                if isIndexing {
                    ProgressView()
                        .controlSize(.mini)
                        .scaleEffect(0.6)
                } else {
                    Image(systemName: "chevron.left.forwardslash.chevron.right")
                        .font(.system(size: 10, weight: isActive ? .semibold : .regular))
                        .foregroundColor(statusColor)
                }
                Text(label)
                    .font(.system(size: 10, weight: isActive ? .semibold : .medium))
                    .foregroundColor(statusColor)
                if isEmbedding && !isIndexing {
                    ProgressView()
                        .controlSize(.mini)
                        .scaleEffect(0.5)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(statusColor.opacity(0.12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 5)
                            .strokeBorder(
                                isActive ? statusColor.opacity(0.3) : Color.clear,
                                lineWidth: 1
                            )
                    )
            )
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }
}

// MARK: - Profile Indicator

struct ProfileIndicator: View {
    let isGenerating: Bool
    let hasProfile: Bool

    private var statusColor: Color {
        if isGenerating { return .orange }
        if hasProfile { return .green }
        return .secondary.opacity(0.5)
    }

    private var label: String {
        if isGenerating { return "Filesystem" }
        if hasProfile { return "Filesystem" }
        return "Filesystem"
    }

    private var icon: String {
        if isGenerating { return "arrow.triangle.2.circlepath" }
        if hasProfile { return "folder.fill" }
        return "folder"
    }

    var body: some View {
        HStack(spacing: 5) {
            if isGenerating {
                ProgressView()
                    .controlSize(.mini)
                    .scaleEffect(0.6)
            } else {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: hasProfile ? .semibold : .regular))
                    .foregroundColor(statusColor)
            }
            Text(label)
                .font(.system(size: 10, weight: hasProfile || isGenerating ? .semibold : .medium))
                .foregroundColor(statusColor)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(statusColor.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(
                            hasProfile || isGenerating ? statusColor.opacity(0.3) : Color.clear,
                            lineWidth: 1
                        )
                )
        )
    }
}

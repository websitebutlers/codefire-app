import SwiftUI
import SwiftTerm
import AppKit

/// Tracks all active terminal views so they can be terminated on app quit.
final class TerminalTracker {
    static let shared = TerminalTracker()
    private var terminals: [ObjectIdentifier: WeakTerminalRef] = [:]

    private struct WeakTerminalRef {
        weak var view: LocalProcessTerminalView?
    }

    func register(_ view: LocalProcessTerminalView) {
        terminals[ObjectIdentifier(view)] = WeakTerminalRef(view: view)
    }

    func terminateAll() {
        for (_, ref) in terminals {
            if let process = ref.view?.process {
                // Send SIGHUP first (shells respond to this), then SIGKILL as fallback
                let pid = process.shellPid
                if pid > 0 {
                    kill(pid, SIGHUP)
                    kill(pid, SIGKILL)
                }
            }
        }
        terminals.removeAll()
    }
}

/// Handles app lifecycle — ensures shell processes are killed on quit.
class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        TerminalTracker.shared.terminateAll()
        return .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Belt-and-suspenders: kill any remaining child processes
        TerminalTracker.shared.terminateAll()
    }

}

@main
struct CodeFireApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    @StateObject private var appState = AppState()
    @StateObject private var appSettings: AppSettings
    @StateObject private var sessionWatcher = SessionWatcher()
    @StateObject private var liveMonitor = LiveSessionMonitor()
    @StateObject private var devEnvironment = DevEnvironment()
    @StateObject private var projectAnalyzer = ProjectAnalyzer()
    @StateObject private var claudeService = ClaudeService()
    @StateObject private var githubService = GitHubService()
    @StateObject private var oauthManager: GoogleOAuthManager
    @StateObject private var gmailPoller: GmailPoller
    @StateObject private var contextEngine = ContextEngine()
    @StateObject private var briefingService = BriefingService()
    @StateObject private var notificationService: SystemNotificationService
    @StateObject private var updateService = UpdateService.shared

    @State private var deepLinkResult: DeepLinkResult?
    @State private var showDeepLinkSheet = false

    /// Result of a deep link installation attempt.
    private enum DeepLinkResult {
        case success(CLIProvider)
        case failure(String)
    }

    init() {
        // Register as a foreground GUI app. Without this, a bare SPM executable
        // isn't recognized by macOS as a real app — it won't become key/foreground,
        // so keyboard events go to whatever app was previously active.
        NSApplication.shared.setActivationPolicy(.regular)

        // Migrate data from old "Context" paths before any DB/service init
        Self.migrateFromContext()

        let oauth = GoogleOAuthManager()
        _oauthManager = StateObject(wrappedValue: oauth)
        let poller = GmailPoller(oauthManager: oauth)
        _gmailPoller = StateObject(wrappedValue: poller)

        let settings = AppSettings()
        _appSettings = StateObject(wrappedValue: settings)
        _notificationService = StateObject(wrappedValue: SystemNotificationService(
            settings: settings,
            gmailPoller: poller
        ))

        do {
            try DatabaseService.shared.setup()
        } catch {
            fatalError("Database setup failed: \(error)")
        }

        // Deploy MCP binary to ~/Library/Application Support/CodeFire/bin/
        // macOS blocks binaries inside .app bundles from being spawned as subprocesses,
        // so Claude Code needs the binary at a standalone path.
        Self.deployMCPBinary()
    }

    /// Copies the CodeFireMCP binary from the app bundle to Application Support
    /// so Claude Code can spawn it as an MCP server (binaries inside .app bundles hang).
    private static func deployMCPBinary() {
        guard let execURL = Bundle.main.executableURL else { return }
        let bundleMCP = execURL.deletingLastPathComponent().appendingPathComponent("CodeFireMCP")
        guard FileManager.default.fileExists(atPath: bundleMCP.path) else { return }

        let dest = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first!.appendingPathComponent("CodeFire/bin", isDirectory: true)
        let destBinary = dest.appendingPathComponent("CodeFireMCP")

        // Skip if already up-to-date (same size)
        if let srcAttr = try? FileManager.default.attributesOfItem(atPath: bundleMCP.path),
           let dstAttr = try? FileManager.default.attributesOfItem(atPath: destBinary.path),
           let srcSize = srcAttr[.size] as? Int,
           let dstSize = dstAttr[.size] as? Int,
           srcSize == dstSize {
            return
        }

        try? FileManager.default.createDirectory(at: dest, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: destBinary)
        try? FileManager.default.copyItem(at: bundleMCP, to: destBinary)
        // Ensure executable
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: destBinary.path)
    }

    /// Migrates existing user data from old "Context" paths to new "CodeFire" paths.
    /// Moves the Application Support directory, renames database files, and copies UserDefaults.
    /// Only runs once: when the old directory exists and the new one does not.
    private static func migrateFromContext() {
        let fm = FileManager.default
        let appSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!

        let oldDir = appSupport.appendingPathComponent("Context", isDirectory: true)
        let newDir = appSupport.appendingPathComponent("CodeFire", isDirectory: true)

        // Only migrate if old exists AND new doesn't
        guard fm.fileExists(atPath: oldDir.path),
              !fm.fileExists(atPath: newDir.path) else { return }

        // 1. Move entire directory
        do {
            try fm.moveItem(at: oldDir, to: newDir)
        } catch {
            // If move fails, don't crash — just use fresh data
            return
        }

        // 2. Rename database files inside
        let dbRenames = [
            ("context.db", "codefire.db"),
            ("context.db-wal", "codefire.db-wal"),
            ("context.db-shm", "codefire.db-shm"),
        ]
        for (oldName, newName) in dbRenames {
            let oldFile = newDir.appendingPathComponent(oldName)
            let newFile = newDir.appendingPathComponent(newName)
            try? fm.moveItem(at: oldFile, to: newFile)
        }

        // 3. Migrate UserDefaults from old suite
        if let oldDefaults = UserDefaults(suiteName: "com.context.app") {
            let standardDefaults = UserDefaults.standard
            for (key, value) in oldDefaults.dictionaryRepresentation() {
                // Skip Apple's internal keys
                if key.hasPrefix("Apple") || key.hasPrefix("NS") || key.hasPrefix("com.apple") { continue }
                standardDefaults.set(value, forKey: key)
            }
            // Clean up old suite
            oldDefaults.removePersistentDomain(forName: "com.context.app")
        }
    }

    var body: some Scene {
        WindowGroup {
            MainSplitView()
                .environmentObject(appState)
                .environmentObject(appSettings)
                .environmentObject(liveMonitor)
                .environmentObject(devEnvironment)
                .environmentObject(projectAnalyzer)
                .environmentObject(claudeService)
                .environmentObject(gmailPoller)
                .environmentObject(githubService)
                .environmentObject(contextEngine)
                .environmentObject(briefingService)
                .environmentObject(updateService)
                .accentColor(Color(red: 0.976, green: 0.451, blue: 0.086)) // CodeFire orange (#f97316)
                .background(PlannerWindowTagger())
                .onAppear {
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    appState.loadProjects()
                    if appSettings.gmailSyncEnabled {
                        gmailPoller.startPolling(interval: appSettings.gmailSyncInterval)
                    }
                    contextEngine.startPollingForRequests()
                    notificationService.observeGmailPoller()
                    notificationService.observeClaudeExitNotifications()
                    Task {
                        await briefingService.checkAndGenerate(settings: appSettings)
                    }
                    // Start auto-update checks if enabled
                    if appSettings.checkForUpdates {
                        let parts = appSettings.githubRepo.split(separator: "/")
                        if parts.count == 2 {
                            updateService.startPeriodicChecks(
                                owner: String(parts[0]),
                                repo: String(parts[1])
                            )
                        }
                    }
                }
                .onChange(of: appState.currentProject) { _, project in
                    if let project = project {
                        sessionWatcher.watchProject(project)
                        devEnvironment.scan(projectPath: project.path)
                        projectAnalyzer.scan(projectPath: project.path)
                        githubService.startMonitoring(projectPath: project.path)
                        contextEngine.startIndexing(projectId: project.id, projectPath: project.path)
                        if let claudeDir = project.claudeProject {
                            liveMonitor.startMonitoring(claudeProjectPath: claudeDir)
                        }
                    }
                }
                .onOpenURL { url in
                    handleDeepLink(url)
                }
                .sheet(isPresented: $showDeepLinkSheet) {
                    VStack(spacing: 16) {
                        if case .success(let cli) = deepLinkResult {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 48))
                                .foregroundColor(.green)
                            Text("MCP Configured")
                                .font(.headline)
                            Text("CodeFire is now connected to \(cli.displayName).")
                            Text("Restart your CLI session to activate.")
                                .foregroundColor(.secondary)
                        } else if case .failure(let message) = deepLinkResult {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 48))
                                .foregroundColor(.red)
                            Text("Configuration Failed")
                                .font(.headline)
                            Text(message)
                                .foregroundColor(.secondary)
                        }

                        Button("Done") { showDeepLinkSheet = false }
                            .keyboardShortcut(.defaultAction)
                    }
                    .padding(32)
                    .frame(width: 360)
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1400, height: 900)
        .commands {
            CommandGroup(after: .windowList) {
                Button("Show Planner") {
                    if let plannerWindow = NSApp.windows.first(where: {
                        $0.identifier?.rawValue == "codefire-planner"
                    }) {
                        plannerWindow.makeKeyAndOrderFront(nil)
                    }
                    NSApp.activate(ignoringOtherApps: true)
                }
                .keyboardShortcut("h", modifiers: [.command, .shift])

                Button("Agent Arena") {
                    if let arenaWindow = NSApp.windows.first(where: {
                        $0.identifier?.rawValue == "codefire-arena"
                    }) {
                        arenaWindow.makeKeyAndOrderFront(nil)
                    }
                    NSApp.activate(ignoringOtherApps: true)
                }
                .keyboardShortcut("g", modifiers: [.command, .shift])
            }
        }

        WindowGroup(for: String.self) { $projectId in
            if let projectId {
                ProjectWindowView(projectId: projectId)
            }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1200, height: 850)

        Window("Agent Arena", id: "agent-arena") {
            AgentArenaView()
                .environmentObject(liveMonitor)
                .background(ArenaWindowTagger())
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 600, height: 250)

        Settings {
            SettingsView(settings: appSettings)
                .environmentObject(contextEngine)
        }
    }


    // MARK: - Deep Link Handling

    /// Handle codefire:// deep links for one-click MCP onboarding.
    /// Format: codefire://install-mcp?client=claude
    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "codefire",
              url.host == "install-mcp",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let clientParam = components.queryItems?.first(where: { $0.name == "client" })?.value,
              let cli = CLIProvider(rawValue: clientParam) else {
            return
        }

        let injector = ContextInjector()
        // Use the current project path if available, otherwise empty string
        let projectPath = appState.currentProject?.path ?? ""

        do {
            // For Claude Code, prefer the `claude mcp add` command
            if cli == .claude {
                let binaryPath = ContextInjector.mcpBinaryPath
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
                process.arguments = ["claude", "mcp", "add", "codefire", binaryPath]
                process.standardOutput = FileHandle.nullDevice
                process.standardError = FileHandle.nullDevice
                try process.run()
                process.waitUntilExit()

                if process.terminationStatus == 0 {
                    deepLinkResult = .success(cli)
                } else {
                    // Fall back to file-based config
                    _ = try injector.installMCP(for: cli, projectPath: projectPath)
                    deepLinkResult = .success(cli)
                }
            } else {
                _ = try injector.installMCP(for: cli, projectPath: projectPath)
                deepLinkResult = .success(cli)
            }
        } catch {
            deepLinkResult = .failure(error.localizedDescription)
        }
        showDeepLinkSheet = true
    }
}

// MARK: - Planner Window Tagger

/// Tags the hosting NSWindow with a known identifier so "Show Planner" can find it.
private struct PlannerWindowTagger: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            view.window?.identifier = NSUserInterfaceItemIdentifier("codefire-planner")
        }
        return view
    }
    func updateNSView(_ nsView: NSView, context: Context) {}
}

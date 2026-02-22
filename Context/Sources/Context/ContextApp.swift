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
struct ContextApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    @StateObject private var appState = AppState()
    @StateObject private var appSettings = AppSettings()
    @StateObject private var sessionWatcher = SessionWatcher()
    @StateObject private var liveMonitor = LiveSessionMonitor()
    @StateObject private var devEnvironment = DevEnvironment()
    @StateObject private var projectAnalyzer = ProjectAnalyzer()
    @StateObject private var claudeService = ClaudeService()
    @StateObject private var githubService = GitHubService()
    @StateObject private var oauthManager: GoogleOAuthManager
    @StateObject private var gmailPoller: GmailPoller
    @StateObject private var contextEngine = ContextEngine()

    init() {
        // Register as a foreground GUI app. Without this, a bare SPM executable
        // isn't recognized by macOS as a real app — it won't become key/foreground,
        // so keyboard events go to whatever app was previously active.
        NSApplication.shared.setActivationPolicy(.regular)

        let oauth = GoogleOAuthManager()
        _oauthManager = StateObject(wrappedValue: oauth)
        _gmailPoller = StateObject(wrappedValue: GmailPoller(oauthManager: oauth))

        do {
            try DatabaseService.shared.setup()
        } catch {
            fatalError("Database setup failed: \(error)")
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
                .onAppear {
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    appState.loadProjects()
                    if appSettings.gmailSyncEnabled {
                        gmailPoller.startPolling(interval: appSettings.gmailSyncInterval)
                    }
                }
                .onChange(of: appState.currentProject) { _, project in
                    if let project = project {
                        sessionWatcher.watchProject(project)
                        devEnvironment.scan(projectPath: project.path)
                        projectAnalyzer.scan(projectPath: project.path)
                        githubService.startMonitoring(projectPath: project.path)
                        if appSettings.contextSearchEnabled {
                            contextEngine.startIndexing(projectId: project.id, projectPath: project.path)
                        }
                        if let claudeDir = project.claudeProject {
                            liveMonitor.startMonitoring(claudeProjectPath: claudeDir)
                        }
                    }
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1400, height: 900)

        WindowGroup(for: String.self) { $projectId in
            if let projectId {
                ProjectWindowView(projectId: projectId)
            }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1200, height: 850)

        Settings {
            SettingsView(settings: appSettings)
                .environmentObject(contextEngine)
        }
    }
}

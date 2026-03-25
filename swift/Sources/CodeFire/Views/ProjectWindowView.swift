import SwiftUI
import UserNotifications

/// Self-contained root view for project-specific windows.
///
/// Per-project services (SessionWatcher, LiveSessionMonitor, etc.) are created per window.
/// App-level services (AppSettings, BriefingService, ClaudeService) are shared via SharedServices
/// to avoid duplicating memory for every open project window.
struct ProjectWindowView: View {
    let projectId: String

    // App-level services — shared across all windows
    private var appSettings: AppSettings { SharedServices.shared.appSettings }
    private var briefingService: BriefingService { SharedServices.shared.briefingService }
    private var claudeService: ClaudeService { SharedServices.shared.claudeService }

    // Per-window services — legitimately per-project
    @StateObject private var appState = AppState()
    @StateObject private var sessionWatcher = SessionWatcher()
    @StateObject private var liveMonitor = LiveSessionMonitor()
    @StateObject private var devEnvironment = DevEnvironment()
    @StateObject private var projectAnalyzer = ProjectAnalyzer()
    @StateObject private var githubService = GitHubService()
    @StateObject private var contextEngine = ContextEngine()

    @State private var projectPath: String = ""
    @State private var project: Project?

    var body: some View {
        Group {
            if project != nil {
                HSplitView {
                    if appState.showTerminal {
                        TerminalTabView(projectPath: $projectPath, projectId: projectId)
                            .frame(minWidth: 400, idealWidth: 600)
                    }

                    GUIPanelView()
                        .frame(minWidth: 400, idealWidth: 600)
                }
            } else {
                VStack {
                    ProgressView()
                    Text("Loading project…")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .environmentObject(appState)
        .environmentObject(appSettings)
        .environmentObject(liveMonitor)
        .environmentObject(devEnvironment)
        .environmentObject(projectAnalyzer)
        .environmentObject(claudeService)
        .environmentObject(githubService)
        .environmentObject(contextEngine)
        .background(Color(nsColor: .windowBackgroundColor))
        .ignoresSafeArea()
        .background(WindowConfigurator(title: project?.name))
        .onAppear {
            loadProject()
        }
        .onDisappear {
            devEnvironment.stop()
            liveMonitor.stopMonitoring()
            sessionWatcher.stopWatching()
            githubService.stopMonitoring()
            contextEngine.stopWatching()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didResignKeyNotification)) { _ in
            liveMonitor.pauseMonitoring()
            githubService.pauseMonitoring()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in
            liveMonitor.resumeMonitoring()
            githubService.resumeMonitoring()
        }
        .onReceive(NotificationCenter.default.publisher(for: .sessionDidEnd)) { notification in
            // Auto-share session in the background if premium sync is enabled
            guard PremiumService.shared.status.syncEnabled,
                  let info = notification.userInfo,
                  let sessionId = info["sessionId"] as? String else { return }
            let slug = info["slug"] as? String
            let model = info["model"] as? String
            let gitBranch = info["gitBranch"] as? String
            let filesChanged = info["filesChanged"] as? [String] ?? []
            let startedAt = info["startedAt"] as? Date
            let durationMins = info["durationMins"] as? Int

            Task {
                await autoShareSession(
                    sessionId: sessionId, slug: slug, model: model,
                    gitBranch: gitBranch, filesChanged: filesChanged,
                    startedAt: startedAt, durationMins: durationMins
                )
            }
        }
    }

    /// Generate a summary and share the session with the team silently in the background.
    private func autoShareSession(
        sessionId: String, slug: String?, model: String?,
        gitBranch: String?, filesChanged: [String],
        startedAt: Date?, durationMins: Int?
    ) async {
        guard let project = appState.currentProject,
              let claudeDir = project.claudeProject else { return }

        // Generate summary via AI
        let summary = await claudeService.generateSessionSummary(
            sessionId: sessionId,
            claudeProjectPath: claudeDir
        ) ?? "Session completed on \(gitBranch ?? "unknown branch")."

        // Share with team
        let premium = PremiumService.shared
        let toShare = SessionSummary(
            id: "",
            projectId: project.id,
            userId: premium.status.user?.id ?? "",
            sessionSlug: slug,
            model: model,
            gitBranch: gitBranch,
            summary: summary,
            filesChanged: filesChanged,
            durationMins: durationMins,
            startedAt: startedAt.map { ISO8601DateFormatter().string(from: $0) },
            endedAt: ISO8601DateFormatter().string(from: Date()),
            sharedAt: ISO8601DateFormatter().string(from: Date()),
            user: nil
        )

        do {
            _ = try await premium.shareSessionSummary(toShare)
            sendSessionSharedNotification(branch: gitBranch)
        } catch {
            print("[AutoShare] Failed to share session: \(error)")
        }
    }

    private func sendSessionSharedNotification(branch: String?) {
        guard Bundle.main.bundleIdentifier != nil else { return }
        let content = UNMutableNotificationContent()
        content.title = "Session Shared"
        content.body = "Session on \(branch ?? "unknown branch") shared with your team."
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "sessionShared-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    private func loadProject() {
        do {
            let loaded = try DatabaseService.shared.dbQueue.read { db in
                try Project.fetchOne(db, key: projectId)
            }
            guard let loaded else { return }

            // Set project + path immediately so the terminal renders instantly.
            project = loaded
            projectPath = loaded.path
            appState.selectProject(loaded)
            appState.loadProjects()

            // Defer heavy service startup to the next run loop tick so
            // SwiftUI can render the terminal before these block the main thread.
            DispatchQueue.main.async { [self] in
                sessionWatcher.watchProject(loaded)
                devEnvironment.scan(projectPath: loaded.path)
                projectAnalyzer.scan(projectPath: loaded.path)
                githubService.startMonitoring(projectPath: loaded.path)
                contextEngine.startIndexing(projectId: loaded.id, projectPath: loaded.path)
                if let claudeDir = loaded.claudeProject {
                    liveMonitor.startMonitoring(claudeProjectPath: claudeDir)
                }
            }
        } catch {
            print("Failed to load project \(projectId): \(error)")
        }
    }
}

import SwiftUI

/// Self-contained root view for project-specific windows.
///
/// Each project window creates its own instances of all per-project services
/// so multiple projects can run independently and simultaneously.
struct ProjectWindowView: View {
    let projectId: String

    @StateObject private var appState = AppState()
    @StateObject private var appSettings = AppSettings()
    @StateObject private var sessionWatcher = SessionWatcher()
    @StateObject private var liveMonitor = LiveSessionMonitor()
    @StateObject private var devEnvironment = DevEnvironment()
    @StateObject private var projectAnalyzer = ProjectAnalyzer()
    @StateObject private var claudeService = ClaudeService()
    @StateObject private var githubService = GitHubService()

    @State private var projectPath: String = ""
    @State private var project: Project?

    var body: some View {
        Group {
            if project != nil {
                HSplitView {
                    TerminalTabView(projectPath: $projectPath)
                        .frame(minWidth: 400, idealWidth: 600)

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
        }
    }

    private func loadProject() {
        do {
            let loaded = try DatabaseService.shared.dbQueue.read { db in
                try Project.fetchOne(db, key: projectId)
            }
            guard let loaded else { return }
            project = loaded
            projectPath = loaded.path
            appState.selectProject(loaded)
            sessionWatcher.watchProject(loaded)
            devEnvironment.scan(projectPath: loaded.path)
            projectAnalyzer.scan(projectPath: loaded.path)
            githubService.startMonitoring(projectPath: loaded.path)
            if let claudeDir = loaded.claudeProject {
                liveMonitor.startMonitoring(claudeProjectPath: claudeDir)
            }
        } catch {
            print("Failed to load project \(projectId): \(error)")
        }
    }
}

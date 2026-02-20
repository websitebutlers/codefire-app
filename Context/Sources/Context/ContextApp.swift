import SwiftUI

@main
struct ContextApp: App {
    @StateObject private var appState = AppState()
    @StateObject private var appSettings = AppSettings()
    @StateObject private var sessionWatcher = SessionWatcher()

    init() {
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
                .onAppear {
                    appState.loadProjects()
                }
                .onChange(of: appState.currentProject) { _, project in
                    if let project = project {
                        sessionWatcher.watchProject(project)
                    }
                }
        }
        .windowStyle(.automatic)
        .defaultSize(width: 1400, height: 900)

        Settings {
            SettingsView(settings: appSettings)
        }
    }
}

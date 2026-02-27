import Foundation
import GRDB
import Combine

@MainActor
class AppState: ObservableObject {
    @Published var currentProject: Project?
    @Published var projects: [Project] = []
    @Published var selectedTab: GUITab = .tasks
    @Published var isHomeView: Bool = true
    @Published var clients: [Client] = []
    @Published var projectProfile: String?
    @Published var isProfileGenerating = false

    enum GUITab: String, CaseIterable {
        case tasks = "Tasks"
        case notes = "Notes"
        case files = "Files"
        case browser = "Browser"
        case memory = "Memory"
        case rules = "Rules"
        case services = "Services"
        case git = "Git"
        case sessions = "Sessions"
        case dashboard = "Details"
        case visualize = "Visualize"

        var icon: String {
            switch self {
            case .tasks: return "checklist"
            case .notes: return "note.text"
            case .files: return "folder"
            case .browser: return "globe"
            case .memory: return "brain"
            case .rules: return "doc.text.magnifyingglass"
            case .services: return "puzzlepiece.extension"
            case .git: return "arrow.triangle.branch"
            case .sessions: return "clock"
            case .dashboard: return "info.circle"
            case .visualize: return "chart.dots.scatter"
            }
        }
    }

    func loadProjects() {
        do {
            let discovery = ProjectDiscovery()
            try discovery.importProjects()
            projects = try DatabaseService.shared.dbQueue.read { db in
                try Project.order(Project.Columns.lastOpened.desc).fetchAll(db)
            }

            // Auto-select the most recently opened project if none is selected
            // and we're not on the home view.
            if !isHomeView && currentProject == nil, let first = projects.first {
                selectProject(first)
            }
        } catch {
            print("Failed to load projects: \(error)")
        }
        loadClients()
    }

    func selectProject(_ project: Project) {
        isHomeView = false
        currentProject = project
        do {
            try DatabaseService.shared.dbQueue.write { db in
                var updated = project
                updated.lastOpened = Date()
                try updated.update(db)
            }
            let discovery = ProjectDiscovery()
            try discovery.importSessions(for: project)

            // Notify views that session data is available.
            NotificationCenter.default.post(name: .sessionsDidChange, object: nil)
        } catch {
            print("Failed to update project: \(error)")
        }

        // Generate project profile asynchronously
        generateProjectProfile(for: project)
    }

    private func generateProjectProfile(for project: Project) {
        // Load cached profile immediately for instant availability
        projectProfile = ProjectProfileGenerator.loadCached(projectId: project.id)
        isProfileGenerating = true

        // Then regenerate in background
        Task {
            let profile = await ProjectProfileGenerator.generate(
                projectId: project.id,
                projectPath: project.path
            )
            self.projectProfile = profile
            self.isProfileGenerating = false
        }
    }

    func selectHome() {
        isHomeView = true
        currentProject = nil
        projectProfile = nil
        isProfileGenerating = false
    }

    func loadClients() {
        do {
            clients = try DatabaseService.shared.dbQueue.read { db in
                try Client.order(Column("sortOrder").asc, Column("name").asc).fetchAll(db)
            }
        } catch {
            print("Failed to load clients: \(error)")
        }
    }

    func createClient(name: String, color: String) {
        var client = Client(
            id: UUID().uuidString,
            name: name,
            color: color,
            sortOrder: clients.count,
            createdAt: Date()
        )
        do {
            try DatabaseService.shared.dbQueue.write { db in
                try client.insert(db)
            }
            loadClients()
        } catch {
            print("Failed to create client: \(error)")
        }
    }

    func deleteClient(_ client: Client) {
        do {
            _ = try DatabaseService.shared.dbQueue.write { db in
                try client.delete(db)
            }
            loadClients()
            loadProjects() // refresh since projects may have lost their clientId
        } catch {
            print("Failed to delete client: \(error)")
        }
    }

    func addProjectFromFolder(_ url: URL) {
        let path = url.path
        let name = url.lastPathComponent

        // Check if this path is already in the DB
        do {
            let exists = try DatabaseService.shared.dbQueue.read { db in
                try Project.filter(Project.Columns.path == path).fetchCount(db) > 0
            }
            if exists {
                // Already tracked — just select it
                if let project = projects.first(where: { $0.path == path }) {
                    selectProject(project)
                }
                return
            }
        } catch {
            print("Failed to check existing project: \(error)")
        }

        // Check if there's a matching ~/.claude/projects/ directory
        let claudeProjectsDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/projects", isDirectory: true)
        let encoded = encodePath(path)
        let claudeDir = claudeProjectsDir.appendingPathComponent(encoded)
        let claudeProject: String? = FileManager.default.fileExists(atPath: claudeDir.path)
            ? claudeDir.path : nil

        var project = Project(
            id: UUID().uuidString,
            name: name,
            path: path,
            claudeProject: claudeProject,
            lastOpened: Date(),
            createdAt: Date()
        )
        do {
            try DatabaseService.shared.dbQueue.write { db in
                try project.insert(db)
            }
            loadProjects()
            selectProject(project)
        } catch {
            print("Failed to add project: \(error)")
        }
    }

    func removeProject(_ project: Project) {
        do {
            _ = try DatabaseService.shared.dbQueue.write { db in
                try project.delete(db)
            }
            if currentProject?.id == project.id {
                selectHome()
            }
            loadProjects()
        } catch {
            print("Failed to remove project: \(error)")
        }
    }

    func updateProjectTag(_ project: Project, tag: String?) {
        do {
            try DatabaseService.shared.dbQueue.write { db in
                var updated = project
                if let tag {
                    updated.setTags([tag])
                } else {
                    updated.setTags([])
                }
                try updated.update(db)
            }
            loadProjects()
        } catch {
            print("Failed to update project tag: \(error)")
        }
    }

    /// Encode a filesystem path the same way Claude Code does for ~/.claude/projects/
    private func encodePath(_ path: String) -> String {
        var result = ""
        for ch in path {
            if ch == "/" || ch == " " || ch == "." || ch == "-" {
                result.append("-")
            } else {
                result.append(ch)
            }
        }
        return result
    }

    func updateProjectClient(_ project: Project, clientId: String?) {
        do {
            try DatabaseService.shared.dbQueue.write { db in
                var updated = project
                updated.clientId = clientId
                try updated.update(db)
            }
            loadProjects()
        } catch {
            print("Failed to update project client: \(error)")
        }
    }

    /// Projects grouped by client for the sidebar.
    var projectsByClient: [(client: Client?, projects: [Project])] {
        var groups: [(client: Client?, projects: [Project])] = []

        for client in clients {
            let clientProjects = projects.filter { $0.clientId == client.id }
            if !clientProjects.isEmpty {
                groups.append((client: client, projects: clientProjects))
            }
        }

        let ungrouped = projects.filter { $0.clientId == nil }
        if !ungrouped.isEmpty {
            groups.append((client: nil, projects: ungrouped))
        }

        return groups
    }
}

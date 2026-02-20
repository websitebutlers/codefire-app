import SwiftUI
import GRDB

struct DashboardView: View {
    @EnvironmentObject var appState: AppState
    @State private var sessions: [Session] = []
    @State private var sessionCount: Int = 0
    @State private var pendingTaskCount: Int = 0
    @State private var inProgressTaskCount: Int = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Quick action buttons
                HStack(spacing: 12) {
                    ActionButton(icon: "plus.circle.fill", title: "New Claude Session") {
                        // Placeholder action
                    }
                    ActionButton(icon: "arrow.counterclockwise.circle.fill", title: "Continue Last Session") {
                        // Placeholder action
                    }
                    ActionButton(icon: "folder.fill", title: "Open in Finder") {
                        if let path = appState.currentProject?.path {
                            NSWorkspace.shared.open(URL(fileURLWithPath: path))
                        }
                    }
                    Spacer()
                }

                // Stats cards row
                HStack(spacing: 12) {
                    StatCard(icon: "clock", value: "\(sessionCount)", label: "Sessions")
                    StatCard(icon: "circle", value: "\(pendingTaskCount)", label: "Pending Tasks")
                    StatCard(icon: "arrow.triangle.2.circlepath", value: "\(inProgressTaskCount)", label: "In Progress")
                    Spacer()
                }

                // Recent sessions
                if !sessions.isEmpty {
                    Text("Recent Sessions")
                        .font(.headline)
                        .padding(.top, 4)

                    LazyVStack(spacing: 8) {
                        ForEach(sessions) { session in
                            SessionCard(session: session)
                        }
                    }
                } else {
                    Text("No sessions yet for this project.")
                        .foregroundColor(.secondary)
                        .padding(.top, 8)
                }
            }
            .padding(16)
        }
        .onAppear { loadData() }
        .onChange(of: appState.currentProject) { _, _ in loadData() }
    }

    private func loadData() {
        guard let project = appState.currentProject else {
            sessions = []
            sessionCount = 0
            pendingTaskCount = 0
            inProgressTaskCount = 0
            return
        }

        do {
            let result = try DatabaseService.shared.dbQueue.read { db -> (sessions: [Session], total: Int, pending: Int, inProgress: Int) in
                let recentSessions = try Session
                    .filter(Session.Columns.projectId == project.id)
                    .order(Session.Columns.startedAt.desc)
                    .limit(10)
                    .fetchAll(db)

                let total = try Session
                    .filter(Session.Columns.projectId == project.id)
                    .fetchCount(db)

                let pending = try TaskItem
                    .filter(Column("projectId") == project.id)
                    .filter(Column("status") == "todo")
                    .fetchCount(db)

                let inProgress = try TaskItem
                    .filter(Column("projectId") == project.id)
                    .filter(Column("status") == "in_progress")
                    .fetchCount(db)

                return (recentSessions, total, pending, inProgress)
            }

            sessions = result.sessions
            sessionCount = result.total
            pendingTaskCount = result.pending
            inProgressTaskCount = result.inProgress
        } catch {
            print("DashboardView: failed to load data: \(error)")
        }
    }
}

// MARK: - Action Button

struct ActionButton: View {
    let icon: String
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                Text(title)
                    .font(.system(size: 12, weight: .medium))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.accentColor.opacity(0.15))
            .foregroundColor(.accentColor)
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Stat Card

struct StatCard: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundColor(.accentColor)
            Text(value)
                .font(.system(size: 20, weight: .bold))
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.secondary)
        }
        .frame(width: 100, height: 80)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }
}

// MARK: - Session Card

struct SessionCard: View {
    let session: Session

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(session.slug ?? String(session.id.prefix(8)))
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)

            HStack(spacing: 10) {
                if let date = session.startedAt {
                    Label(date.formatted(.dateTime.month(.abbreviated).day().hour().minute()), systemImage: "calendar")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }
                if let branch = session.gitBranch {
                    Label(branch, systemImage: "arrow.triangle.branch")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                Label("\(session.messageCount) msgs", systemImage: "message")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                Label("\(session.toolUseCount) tools", systemImage: "wrench")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                if let model = session.model {
                    Label(model, systemImage: "cpu")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }

            if let summary = session.summary, !summary.isEmpty {
                Text(summary)
                    .font(.system(size: 12))
                    .foregroundColor(.primary.opacity(0.8))
                    .lineLimit(3)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }
}

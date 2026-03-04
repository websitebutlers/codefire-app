import SwiftUI
import GRDB

struct DashboardView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var appSettings: AppSettings
    @EnvironmentObject var liveMonitor: LiveSessionMonitor
    @State private var sessions: [Session] = []
    @State private var sessionCount: Int = 0
    @State private var pendingTaskCount: Int = 0
    @State private var inProgressTaskCount: Int = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Live session (shown when active)
                if liveMonitor.state.isActive {
                    LiveSessionView()
                    Divider()
                        .padding(.bottom, 12)
                }

                VStack(alignment: .leading, spacing: 20) {
                // Quick action buttons
                HStack(spacing: 8) {
                    ActionButton(
                        icon: "plus.circle.fill",
                        title: "New Claude Session",
                        style: .primary
                    ) {
                        NotificationCenter.default.post(
                            name: .launchTask,
                            object: nil,
                            userInfo: [
                                LaunchTaskKey.title: "Claude",
                                LaunchTaskKey.command: appSettings.commandWithArgs(for: .claude),
                                LaunchTaskKey.projectId: appState.currentProject?.id ?? ""
                            ]
                        )
                    }
                    ActionButton(
                        icon: "arrow.counterclockwise",
                        title: "Continue Last",
                        style: .secondary
                    ) {
                        NotificationCenter.default.post(
                            name: .launchTask,
                            object: nil,
                            userInfo: [
                                LaunchTaskKey.title: "Claude (Resume)",
                                LaunchTaskKey.command: "\(appSettings.commandWithArgs(for: .claude)) --continue",
                                LaunchTaskKey.projectId: appState.currentProject?.id ?? ""
                            ]
                        )
                    }
                    ActionButton(
                        icon: "folder",
                        title: "Open in Finder",
                        style: .secondary
                    ) {
                        if let path = appState.currentProject?.path {
                            NSWorkspace.shared.open(URL(fileURLWithPath: path))
                        }
                    }
                    Spacer()
                }

                // Task launcher
                TaskLauncherView()

                // Dev tools (project-aware)
                DevToolsView()

                // Cost tracker
                CostSummaryView()

                // Stats row
                HStack(spacing: 10) {
                    StatCard(
                        icon: "clock.arrow.circlepath",
                        value: "\(sessionCount)",
                        label: "Sessions",
                        color: .blue
                    )
                    StatCard(
                        icon: "circle.dotted",
                        value: "\(pendingTaskCount)",
                        label: "Pending",
                        color: .orange
                    )
                    StatCard(
                        icon: "arrow.triangle.2.circlepath",
                        value: "\(inProgressTaskCount)",
                        label: "In Progress",
                        color: .green
                    )
                    Spacer()
                }

                // Recent sessions
                VStack(alignment: .leading, spacing: 10) {
                    Text("Recent Sessions")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.primary)

                    if !sessions.isEmpty {
                        LazyVStack(spacing: 6) {
                            ForEach(sessions) { session in
                                SessionCard(session: session)
                            }
                        }
                    } else {
                        emptyState
                    }
                }
            }
            .padding(20)
            } // end inner VStack
        }
        .onAppear { loadData() }
        .onChange(of: appState.currentProject) { _, _ in loadData() }
        .onReceive(NotificationCenter.default.publisher(for: .sessionsDidChange)) { _ in
            loadData()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "clock.badge.questionmark")
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)

            Text("No sessions yet")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.secondary)

            Text("Select a project to see its session history")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
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
    enum Style { case primary, secondary }

    let icon: String
    let title: String
    let style: Style
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .medium))
                Text(title)
                    .font(.system(size: 12, weight: .medium))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 7)
                    .fill(style == .primary
                          ? Color.accentColor.opacity(isHovering ? 0.25 : 0.15)
                          : Color(nsColor: .controlBackgroundColor).opacity(isHovering ? 1 : 0.8))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .stroke(style == .primary
                            ? Color.accentColor.opacity(0.3)
                            : Color(nsColor: .separatorColor).opacity(0.5),
                            lineWidth: 0.5)
            )
            .foregroundColor(style == .primary ? .accentColor : .primary)
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            isHovering = hovering
        }
    }
}

// MARK: - Stat Card

struct StatCard: View {
    let icon: String
    let value: String
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(color.opacity(0.8))

            Text(value)
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundColor(.primary)

            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.secondary)
        }
        .frame(width: 100, height: 85)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color(nsColor: .separatorColor).opacity(0.4), lineWidth: 0.5)
        )
    }
}

// MARK: - Session Card

struct SessionCard: View {
    let session: Session
    @EnvironmentObject var settings: AppSettings
    @State private var isHovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header row
            HStack {
                Text(settings.demoMode ? DemoContent.shared.mask(session.slug ?? String(session.id.prefix(8)), as: .session) : (session.slug ?? String(session.id.prefix(8))))
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)

                Spacer()

                if let date = session.startedAt {
                    Text(date.formatted(.dateTime.month(.abbreviated).day().hour().minute()))
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }
            }

            // Metadata pills
            HStack(spacing: 6) {
                if let branch = session.gitBranch {
                    MetadataPill(icon: "arrow.triangle.branch", text: settings.demoMode ? DemoContent.shared.mask(branch, as: .gitBranch) : branch, color: .purple)
                }
                if let model = session.model {
                    MetadataPill(icon: "cpu", text: model, color: .blue)
                }
                MetadataPill(
                    icon: "message",
                    text: "\(session.messageCount) msgs",
                    color: .secondary
                )
                MetadataPill(
                    icon: "wrench",
                    text: "\(session.toolUseCount) tools",
                    color: .secondary
                )
                if session.estimatedCost > 0 {
                    MetadataPill(
                        icon: "dollarsign.circle",
                        text: String(format: "$%.2f", session.estimatedCost),
                        color: session.estimatedCost > 1 ? .orange : .green
                    )
                }
            }

            // Summary
            if let summary = session.summary, !summary.isEmpty {
                Text(settings.demoMode ? DemoContent.shared.mask(summary, as: .snippet) : summary)
                    .font(.system(size: 12))
                    .foregroundColor(.primary.opacity(0.7))
                    .lineLimit(2)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(isHovering ? 1 : 0.7))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
        )
        .onHover { hovering in
            isHovering = hovering
        }
    }
}

// MARK: - Metadata Pill

struct MetadataPill: View {
    let icon: String
    let text: String
    let color: Color

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .medium))
            Text(text)
                .font(.system(size: 10, weight: .medium))
                .lineLimit(1)
        }
        .foregroundColor(color == .secondary ? .secondary : color.opacity(0.8))
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(
            Capsule()
                .fill(color == .secondary
                      ? Color(nsColor: .separatorColor).opacity(0.15)
                      : color.opacity(0.1))
        )
    }
}

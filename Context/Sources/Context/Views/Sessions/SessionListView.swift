import SwiftUI
import GRDB

struct SessionListView: View {
    @EnvironmentObject var appState: AppState
    @State private var sessions: [Session] = []
    @State private var selectedSession: Session?
    @State private var searchText: String = ""

    var body: some View {
        HSplitView {
            // Left panel: search + session list
            VStack(spacing: 0) {
                // Search bar
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(.secondary)
                    TextField("Search sessions...", text: $searchText)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13))
                }
                .padding(8)
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(6)
                .padding(8)

                Divider()

                // Session list
                ScrollView {
                    LazyVStack(spacing: 1) {
                        ForEach(sessions) { session in
                            SessionRow(session: session, isSelected: selectedSession?.id == session.id)
                                .onTapGesture {
                                    selectedSession = session
                                }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .frame(minWidth: 220, idealWidth: 280)

            // Right panel: detail view
            if let session = selectedSession {
                SessionDetailView(session: session)
                    .frame(minWidth: 300)
            } else {
                VStack {
                    Image(systemName: "clock")
                        .font(.system(size: 32))
                        .foregroundColor(.secondary.opacity(0.5))
                    Text("Select a session")
                        .foregroundColor(.secondary)
                        .font(.system(size: 14))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear { loadSessions() }
        .onChange(of: appState.currentProject) { _, _ in
            selectedSession = nil
            loadSessions()
        }
        .onChange(of: searchText) { _, _ in loadSessions() }
    }

    private func loadSessions() {
        guard let project = appState.currentProject else {
            sessions = []
            return
        }

        do {
            sessions = try DatabaseService.shared.dbQueue.read { db in
                var request = Session
                    .filter(Session.Columns.projectId == project.id)

                if !searchText.isEmpty {
                    request = request.filter(Session.Columns.summary.like("%\(searchText)%"))
                }

                return try request
                    .order(Session.Columns.startedAt.desc)
                    .fetchAll(db)
            }
        } catch {
            print("SessionListView: failed to load sessions: \(error)")
        }
    }
}

// MARK: - Session Row

struct SessionRow: View {
    let session: Session
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(session.slug ?? String(session.id.prefix(8)))
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                Spacer()
                if let date = session.startedAt {
                    Text(date.formatted(.dateTime.month(.abbreviated).day()))
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
            }

            HStack(spacing: 8) {
                Label("\(session.messageCount)", systemImage: "message")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                Label("\(session.toolUseCount)", systemImage: "wrench")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                if let branch = session.gitBranch {
                    Label(branch, systemImage: "arrow.triangle.branch")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(isSelected ? Color.accentColor.opacity(0.15) : Color.clear)
        .cornerRadius(4)
        .contentShape(Rectangle())
    }
}

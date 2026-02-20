import SwiftUI

struct GUIPanelView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            // Project header
            HStack {
                if let project = appState.currentProject {
                    Image(systemName: "folder.fill")
                        .foregroundColor(.accentColor)
                    Text(project.name)
                        .font(.headline)
                    Text(project.path)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                } else {
                    Text("No project selected")
                        .foregroundColor(.secondary)
                }
                Spacer()
                Menu {
                    ForEach(appState.projects) { project in
                        Button(project.name) {
                            appState.selectProject(project)
                        }
                    }
                } label: {
                    Image(systemName: "chevron.down.circle")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            // Tab bar
            HStack(spacing: 0) {
                ForEach(AppState.GUITab.allCases, id: \.self) { tab in
                    TabButton(tab: tab, isSelected: appState.selectedTab == tab) {
                        appState.selectedTab = tab
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 8)

            Divider()

            // Tab content
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
                case .memory:
                    PatternListView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct TabButton: View {
    let tab: AppState.GUITab
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: tab.icon)
                    .font(.system(size: 12))
                Text(tab.rawValue)
                    .font(.system(size: 12))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isSelected ? Color.accentColor.opacity(0.15) : Color.clear)
            .foregroundColor(isSelected ? .accentColor : .secondary)
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
    }
}

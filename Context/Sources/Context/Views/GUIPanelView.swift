import SwiftUI

// MARK: - MCP Connection Monitor

struct MCPConnection: Identifiable {
    let id: Int // PID
    let cwd: String
    let projectId: String?
    let projectName: String?
    let connectedAt: String
}

class MCPConnectionMonitor: ObservableObject {
    @Published var connections: [MCPConnection] = []

    private var timer: Timer?
    private let statusDir: URL

    init() {
        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!.appendingPathComponent("Context/mcp-connections", isDirectory: true)
        statusDir = appSupport
    }

    func startPolling() {
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    private func poll() {
        guard FileManager.default.fileExists(atPath: statusDir.path) else {
            DispatchQueue.main.async { self.connections = [] }
            return
        }

        var active: [MCPConnection] = []
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: statusDir, includingPropertiesForKeys: nil
        ) else {
            DispatchQueue.main.async { self.connections = [] }
            return
        }

        for file in files where file.pathExtension == "json" {
            guard let pidStr = file.deletingPathExtension().lastPathComponent.components(separatedBy: ".").first,
                  let pid = Int(pidStr) else { continue }

            // Check if process is still running
            if kill(Int32(pid), 0) != 0 {
                // Process is dead — clean up stale file
                try? FileManager.default.removeItem(at: file)
                continue
            }

            guard let data = try? Data(contentsOf: file),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }

            active.append(MCPConnection(
                id: pid,
                cwd: json["cwd"] as? String ?? "unknown",
                projectId: json["projectId"] as? String,
                projectName: json["projectName"] as? String,
                connectedAt: json["connectedAt"] as? String ?? ""
            ))
        }

        DispatchQueue.main.async { self.connections = active }
    }
}

struct GUIPanelView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var mcpMonitor = MCPConnectionMonitor()
    @StateObject private var browserViewModel = BrowserViewModel()
    @State private var showChatDrawer = false

    var body: some View {
        VStack(spacing: 0) {
            if appState.isHomeView {
                if appState.selectedTab == .browser {
                    BrowserView(viewModel: browserViewModel)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    // Home view header
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 6)
                            .fill(Color.accentColor.gradient)
                            .frame(width: 28, height: 28)
                            .overlay(
                                Image(systemName: "house.fill")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundColor(.white)
                            )
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Planner")
                                .font(.system(size: 13, weight: .semibold))
                            Text("Global tasks & emails")
                                .font(.system(size: 10))
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        chatButton
                        MCPIndicator(connections: mcpMonitor.connections, currentProjectId: nil)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)

                    Divider()

                    // Home content
                    HomeView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                // Project header (simplified — no dropdown picker)
                projectHeader
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)

                Divider()

                // Tab bar
                tabBar
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)

                Divider()

                // Tab content — browser persists via ZStack, others switch normally
                ZStack {
                    // Browser always exists in the ZStack (hidden when not selected)
                    BrowserView(viewModel: browserViewModel)
                        .opacity(appState.selectedTab == .browser ? 1 : 0)
                        .allowsHitTesting(appState.selectedTab == .browser)

                    // Other tabs render on demand
                    if appState.selectedTab != .browser {
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
                                MemoryEditorView()
                            case .rules:
                                ClaudeMdEditorView()
                            case .github:
                                GitHubTabView()
                            case .visualize:
                                VisualizerView()
                            case .browser:
                                EmptyView() // Handled above in ZStack
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .overlay(alignment: .trailing) {
            if showChatDrawer {
                HStack(spacing: 0) {
                    // Backdrop
                    Color.black.opacity(0.15)
                        .ignoresSafeArea()
                        .onTapGesture {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                showChatDrawer = false
                            }
                        }

                    // Drawer
                    ChatDrawerView(isOpen: $showChatDrawer)
                        .transition(.move(edge: .trailing))
                }
            }
        }
        .onAppear { mcpMonitor.startPolling() }
        .onDisappear { mcpMonitor.stopPolling() }
    }

    // MARK: - Project Header

    private var projectHeader: some View {
        HStack(spacing: 10) {
            if let project = appState.currentProject {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.accentColor.gradient)
                    .frame(width: 28, height: 28)
                    .overlay(
                        Image(systemName: "folder.fill")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.white)
                    )

                VStack(alignment: .leading, spacing: 1) {
                    Text(project.name)
                        .font(.system(size: 13, weight: .semibold))
                    Text(project.path)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            Spacer()

            chatButton
            ProfileIndicator(
                isGenerating: appState.isProfileGenerating,
                hasProfile: appState.projectProfile != nil
            )
            MCPIndicator(connections: mcpMonitor.connections, currentProjectId: appState.currentProject?.id)
        }
    }

    // MARK: - Chat Button

    private var chatButton: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                showChatDrawer.toggle()
            }
        } label: {
            Image(systemName: showChatDrawer ? "bubble.right.fill" : "bubble.right")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(showChatDrawer ? .accentColor : .secondary)
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(showChatDrawer ? Color.accentColor.opacity(0.12) : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Chat")
    }

    // MARK: - Tab Bar

    /// Tabs hidden from the tab bar (but code kept for later re-enabling).
    private static let hiddenTabs: Set<AppState.GUITab> = [.visualize]

    private var tabBar: some View {
        HStack(spacing: 2) {
            ForEach(AppState.GUITab.allCases.filter { !Self.hiddenTabs.contains($0) }, id: \.self) { tab in
                TabButton(tab: tab, isSelected: appState.selectedTab == tab) {
                    withAnimation(.easeInOut(duration: 0.15)) {
                        appState.selectedTab = tab
                    }
                }
            }
            Spacer()
        }
    }
}

struct TabButton: View {
    let tab: AppState.GUITab
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: tab.icon)
                    .font(.system(size: 11, weight: isSelected ? .semibold : .regular))
                Text(tab.rawValue)
                    .font(.system(size: 12, weight: isSelected ? .semibold : .regular))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isSelected
                          ? Color.accentColor.opacity(0.12)
                          : isHovering ? Color(nsColor: .separatorColor).opacity(0.15) : Color.clear)
            )
            .foregroundColor(isSelected ? .accentColor : .secondary)
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            isHovering = hovering
        }
    }
}

// MARK: - MCP Connection Indicator

struct MCPIndicator: View {
    let connections: [MCPConnection]
    let currentProjectId: String?

    /// Connections matching the currently selected project.
    private var projectConnections: [MCPConnection] {
        guard let pid = currentProjectId else { return [] }
        return connections.filter { $0.projectId == pid }
    }

    private var isConnectedToCurrentProject: Bool {
        !projectConnections.isEmpty
    }

    private var statusColor: Color {
        isConnectedToCurrentProject ? .green : .orange
    }

    var body: some View {
        if connections.isEmpty {
            // No MCP connections — show disconnected state
            HStack(spacing: 5) {
                Image(systemName: "antenna.radiowaves.left.and.right.slash")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary.opacity(0.5))
                Text("MCP")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.secondary.opacity(0.5))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(Color(nsColor: .separatorColor).opacity(0.12))
            )
        } else {
            Menu {
                Section("MCP Connections (\(connections.count))") {
                    ForEach(connections) { conn in
                        let isCurrent = conn.projectId == currentProjectId
                        Label {
                            Text("\(conn.projectName ?? "Unknown") — PID \(conn.id)")
                        } icon: {
                            Image(systemName: isCurrent ? "checkmark.circle.fill" : "circle")
                        }
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(statusColor)
                    Text("MCP")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(statusColor)
                    if connections.count > 1 {
                        Text("\(connections.count)")
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundColor(.white)
                            .frame(width: 16, height: 16)
                            .background(Circle().fill(statusColor))
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(statusColor.opacity(0.12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 5)
                                .strokeBorder(statusColor.opacity(0.3), lineWidth: 1)
                        )
                )
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
        }
    }

    private func shortenPath(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path.hasPrefix(home) {
            return "~" + path.dropFirst(home.count)
        }
        return path
    }
}

// MARK: - Profile Indicator

struct ProfileIndicator: View {
    let isGenerating: Bool
    let hasProfile: Bool

    private var statusColor: Color {
        if isGenerating { return .orange }
        if hasProfile { return .green }
        return .secondary.opacity(0.5)
    }

    private var label: String {
        if isGenerating { return "Indexing" }
        if hasProfile { return "Indexed" }
        return "Profile"
    }

    private var icon: String {
        if isGenerating { return "arrow.triangle.2.circlepath" }
        if hasProfile { return "doc.text.magnifyingglass" }
        return "doc.text.magnifyingglass"
    }

    var body: some View {
        HStack(spacing: 5) {
            if isGenerating {
                ProgressView()
                    .controlSize(.mini)
                    .scaleEffect(0.6)
            } else {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: hasProfile ? .semibold : .regular))
                    .foregroundColor(statusColor)
            }
            Text(label)
                .font(.system(size: 10, weight: hasProfile || isGenerating ? .semibold : .medium))
                .foregroundColor(statusColor)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(statusColor.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(
                            hasProfile || isGenerating ? statusColor.opacity(0.3) : Color.clear,
                            lineWidth: 1
                        )
                )
        )
    }
}

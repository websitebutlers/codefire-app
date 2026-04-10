import SwiftUI

/// Notification payload for launching a Claude task in a new terminal tab.
extension Notification.Name {
    static let launchTask = Notification.Name("launchTask")
}

/// Keys for `.launchTask` notification userInfo.
enum LaunchTaskKey {
    static let title = "title"
    static let command = "command"
    static let projectId = "projectId"
}

/// A view that manages multiple terminal tabs, each backed by a `TerminalWrapper`.
///
/// The tab bar sits at the top. A "+" button creates new tabs whose initial
/// directory matches the current `projectPath`. When the project path changes
/// the active terminal receives a `cd` command so it stays in sync.
///
/// Listens for `.launchTask` notifications from the GUI side to create new
/// tabs that auto-run Claude commands.
struct TerminalTabView: View {
    @Binding var projectPath: String
    var projectId: String = ""
    @State private var tabs: [TerminalTab] = []
    @State private var selectedTabId: UUID?
    @State private var commandToSend: String?
    @State private var pasteRawText: String?
    @StateObject private var agentMonitor = AgentMonitor()

    var body: some View {
        VStack(spacing: 0) {
            // Tab bar
            HStack(spacing: 0) {
                ForEach(tabs) { tab in
                    tabButton(for: tab)
                }

                Button(action: addTab) {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                        .frame(width: 26, height: 26)
                        .background(Color.clear)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.leading, 2)

                Spacer()

                CLIQuickLaunchView(
                    projectPath: projectPath,
                    onLaunchCLI: { title, command in
                        launchTask(title: title, command: command)
                    }
                )
                .padding(.trailing, 6)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(Color(nsColor: .windowBackgroundColor))

            // Thin separator
            Rectangle()
                .fill(Color(nsColor: .separatorColor).opacity(0.5))
                .frame(height: 1)

            // Agent status bar (visible when Claude Code is running)
            AgentStatusBar(monitor: agentMonitor)

            // Terminal content — all tabs stay alive in a ZStack,
            // only the selected tab is visible and interactive.
            ZStack {
                ForEach(tabs) { tab in
                    let isActive = tab.id == selectedTabId
                    TerminalWrapper(
                        initialDirectory: tab.initialDirectory,
                        initialCommand: tab.initialCommand,
                        isActive: isActive,
                        sendCommand: isActive ? $commandToSend : .constant(nil),
                        pasteRawText: isActive ? $pasteRawText : .constant(nil),
                        onShellStarted: { [weak agentMonitor] pid in
                            tab.shellPid = pid
                            // Start monitoring if this is the active tab
                            if tab.id == selectedTabId {
                                agentMonitor?.start(shellPid: pid)
                            }
                        }
                    )
                    .opacity(isActive ? 1 : 0)
                    .allowsHitTesting(isActive)
                }
            }
            .overlay {
                if tabs.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "terminal")
                            .font(.system(size: 24))
                            .foregroundStyle(.tertiary)
                        Text("No terminal open")
                            .font(.system(size: 12))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .onAppear {
            if tabs.isEmpty {
                addTab()
            }
        }
        .onDisappear {
            agentMonitor.stop()
        }
        .onChange(of: selectedTabId) { _, newId in
            // Switch agent monitor to the newly selected tab's shell
            if let tab = tabs.first(where: { $0.id == newId }), tab.shellPid > 0 {
                agentMonitor.start(shellPid: tab.shellPid)
            } else {
                agentMonitor.stop()
            }
        }
        .onChange(of: projectPath) { _, newPath in
            if !newPath.isEmpty {
                commandToSend = "cd \"\(newPath)\""
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .launchTask)) { notification in
            guard let info = notification.userInfo,
                  let title = info[LaunchTaskKey.title] as? String,
                  let command = info[LaunchTaskKey.command] as? String else { return }
            // Filter: only handle if projectId matches or notification has no projectId
            if let notifProjectId = info[LaunchTaskKey.projectId] as? String,
               !projectId.isEmpty,
               notifProjectId != projectId {
                return
            }
            launchTask(title: title, command: command)
        }
        .onReceive(NotificationCenter.default.publisher(for: .pasteToTerminal)) { notification in
            guard let text = notification.userInfo?["text"] as? String else { return }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        }
        .onReceive(NotificationCenter.default.publisher(for: .insertIntoTerminal)) { notification in
            guard let text = notification.userInfo?["text"] as? String else { return }
            // Writes the text directly to the active terminal's input buffer,
            // no newline — the user can review before pressing Return.
            pasteRawText = text
        }
    }

    // MARK: - Tab actions

    private func addTab() {
        let tab = TerminalTab(
            title: "Terminal \(tabs.count + 1)",
            initialDirectory: projectPath
        )
        tabs.append(tab)
        selectedTabId = tab.id
    }

    private func launchTask(title: String, command: String) {
        let tab = TerminalTab(
            title: title,
            initialDirectory: projectPath,
            initialCommand: command
        )
        tabs.append(tab)
        selectedTabId = tab.id
    }

    private func closeTab(_ tab: TerminalTab) {
        tabs.removeAll { $0.id == tab.id }
        if selectedTabId == tab.id {
            selectedTabId = tabs.last?.id
        }
    }

    // MARK: - Tab button

    @ViewBuilder
    private func tabButton(for tab: TerminalTab) -> some View {
        let isSelected = tab.id == selectedTabId

        HStack(spacing: 4) {
            Image(systemName: "terminal")
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(isSelected ? .primary : .secondary.opacity(0.5))

            Text(tab.title)
                .font(.system(size: 11, weight: isSelected ? .medium : .regular))
                .lineLimit(1)
                .foregroundColor(isSelected ? .primary : .secondary)

            if tabs.count > 1 {
                Button(action: { closeTab(tab) }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(.tertiary)
                        .frame(width: 14, height: 14)
                        .background(
                            Circle()
                                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.6))
                        )
                }
                .buttonStyle(.plain)
                .opacity(isSelected ? 1 : 0)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(isSelected
                      ? Color(nsColor: .controlBackgroundColor)
                      : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 5)
                .stroke(isSelected
                        ? Color(nsColor: .separatorColor).opacity(0.3)
                        : Color.clear,
                        lineWidth: 0.5)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            selectedTabId = tab.id
        }
    }
}

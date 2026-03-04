import SwiftUI

/// Quick-launch panel for spinning up Claude Code agents in new terminal tabs.
///
/// Provides preset task buttons (code review, tests, debug, etc.) and a custom
/// prompt field. Each launch creates a new terminal tab via `.launchTask` notification.
struct TaskLauncherView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var appSettings: AppSettings
    @State private var customPrompt: String = ""
    @State private var isExpanded: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack {
                Label("Task Launcher", systemImage: "bolt.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.primary)

                Spacer()

                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                } label: {
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.secondary)
                        .frame(width: 20, height: 20)
                }
                .buttonStyle(.plain)
            }

            if isExpanded {
                // Preset task grid
                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: 8),
                    GridItem(.flexible(), spacing: 8)
                ], spacing: 8) {
                    ForEach(TaskPreset.defaults) { preset in
                        TaskPresetButton(preset: preset) {
                            launchPreset(preset)
                        }
                    }
                }

                // Custom prompt
                HStack(spacing: 6) {
                    Image(systemName: "terminal.fill")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)

                    TextField("Custom prompt...", text: $customPrompt)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12))
                        .onSubmit {
                            launchCustom()
                        }

                    Button {
                        launchCustom()
                    } label: {
                        Image(systemName: "arrow.right.circle.fill")
                            .font(.system(size: 14))
                            .foregroundColor(customPrompt.isEmpty ? .secondary.opacity(0.4) : .accentColor)
                    }
                    .buttonStyle(.plain)
                    .disabled(customPrompt.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(
                    RoundedRectangle(cornerRadius: 7)
                        .fill(Color(nsColor: .controlBackgroundColor))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(Color(nsColor: .separatorColor).opacity(0.4), lineWidth: 0.5)
                )
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.5))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
        )
    }

    // MARK: - Actions

    private func launchPreset(_ preset: TaskPreset) {
        let prompt = preset.prompt(for: appState.currentProject)
        let escaped = prompt.replacingOccurrences(of: "\"", with: "\\\"")
        let command = "\(appSettings.commandWithArgs(for: appSettings.preferredCLI)) \"\(escaped)\""

        NotificationCenter.default.post(
            name: .launchTask,
            object: nil,
            userInfo: [
                LaunchTaskKey.title: preset.title,
                LaunchTaskKey.command: command,
                LaunchTaskKey.projectId: appState.currentProject?.id ?? ""
            ]
        )
    }

    private func launchCustom() {
        let trimmed = customPrompt.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        let escaped = trimmed.replacingOccurrences(of: "\"", with: "\\\"")
        let command = "\(appSettings.commandWithArgs(for: appSettings.preferredCLI)) \"\(escaped)\""
        let shortTitle = String(trimmed.prefix(20)) + (trimmed.count > 20 ? "..." : "")

        NotificationCenter.default.post(
            name: .launchTask,
            object: nil,
            userInfo: [
                LaunchTaskKey.title: shortTitle,
                LaunchTaskKey.command: command,
                LaunchTaskKey.projectId: appState.currentProject?.id ?? ""
            ]
        )

        customPrompt = ""
    }
}

// MARK: - Task Preset Model

struct TaskPreset: Identifiable {
    let id: String
    let icon: String
    let title: String
    let description: String
    let color: Color
    let promptTemplate: String

    func prompt(for project: Project?) -> String {
        promptTemplate
    }

    static let defaults: [TaskPreset] = [
        TaskPreset(
            id: "review",
            icon: "eye.fill",
            title: "Code Review",
            description: "Review recent changes",
            color: .blue,
            promptTemplate: "Review the recent code changes in this project. Look for bugs, security issues, and suggest improvements. Focus on the most recently modified files."
        ),
        TaskPreset(
            id: "tests",
            icon: "checkmark.shield.fill",
            title: "Write Tests",
            description: "Generate test coverage",
            color: .green,
            promptTemplate: "Analyze the codebase and write tests for any untested or under-tested code. Focus on critical business logic and edge cases."
        ),
        TaskPreset(
            id: "debug",
            icon: "ant.fill",
            title: "Debug",
            description: "Investigate issues",
            color: .red,
            promptTemplate: "Investigate the codebase for potential bugs, error-prone patterns, and issues. Check error handling, edge cases, and race conditions."
        ),
        TaskPreset(
            id: "refactor",
            icon: "arrow.triangle.2.circlepath",
            title: "Refactor",
            description: "Improve code quality",
            color: .purple,
            promptTemplate: "Look for opportunities to refactor and improve code quality. Focus on reducing duplication, improving readability, and simplifying complex logic."
        ),
        TaskPreset(
            id: "docs",
            icon: "doc.text.fill",
            title: "Documentation",
            description: "Add or update docs",
            color: .orange,
            promptTemplate: "Review the codebase and add or improve documentation. Focus on public APIs, complex logic, and architecture decisions that need explaining."
        ),
        TaskPreset(
            id: "security",
            icon: "lock.shield.fill",
            title: "Security Audit",
            description: "Check for vulnerabilities",
            color: .red.opacity(0.8),
            promptTemplate: "Perform a security audit of this codebase. Check for common vulnerabilities like injection attacks, authentication issues, data exposure, and insecure configurations."
        ),
    ]
}

// MARK: - Preset Button

struct TaskPresetButton: View {
    let preset: TaskPreset
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: preset.icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(preset.color)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 1) {
                    Text(preset.title)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.primary)
                    Text(preset.description)
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                Image(systemName: "arrow.up.right")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundColor(.secondary.opacity(isHovering ? 0.8 : 0.3))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 7)
                    .fill(isHovering
                          ? preset.color.opacity(0.08)
                          : Color(nsColor: .controlBackgroundColor).opacity(0.6))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .stroke(isHovering
                            ? preset.color.opacity(0.3)
                            : Color(nsColor: .separatorColor).opacity(0.3),
                            lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            isHovering = hovering
        }
    }
}

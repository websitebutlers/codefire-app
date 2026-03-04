import SwiftUI
import GRDB

struct SessionDetailView: View {
    let session: Session
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var claudeService: ClaudeService
    @EnvironmentObject var settings: AppSettings

    @State private var aiSummary: String?
    @State private var showAISummary = false
    @State private var summaryError: String?
    @State private var extractedTaskCount: Int?
    @State private var extractError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                VStack(alignment: .leading, spacing: 8) {
                    Text(settings.demoMode ? DemoContent.shared.mask(session.slug ?? session.id, as: .session) : (session.slug ?? session.id))
                        .font(.system(size: 16, weight: .bold))
                        .textSelection(.enabled)

                    HStack(spacing: 8) {
                        if let date = session.startedAt {
                            DetailBadge(
                                icon: "calendar",
                                text: date.formatted(.dateTime.month(.abbreviated).day().year().hour().minute())
                            )
                        }
                        if let branch = session.gitBranch {
                            DetailBadge(icon: "arrow.triangle.branch", text: settings.demoMode ? DemoContent.shared.mask(branch, as: .gitBranch) : branch, color: .purple)
                        }
                        if let model = session.model {
                            DetailBadge(icon: "cpu", text: model, color: .blue)
                        }
                    }
                }

                // Stats row
                HStack(spacing: 10) {
                    DetailStat(icon: "message", label: "Messages", value: "\(session.messageCount)", color: .blue)
                    DetailStat(icon: "wrench", label: "Tool Uses", value: "\(session.toolUseCount)", color: .orange)
                    DetailStat(icon: "doc", label: "Files", value: "\(session.filesChangedArray.count)", color: .green)
                    DetailStat(
                        icon: "dollarsign.circle",
                        label: "Cost",
                        value: String(format: "$%.2f", session.estimatedCost),
                        color: session.estimatedCost > 1 ? .orange : .green
                    )
                }

                // Summary section
                summarySection

                // Files changed
                let files = session.filesChangedArray
                if !files.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Files Changed (\(files.count))")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.secondary)
                            .textCase(.uppercase)
                            .tracking(0.3)

                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(files.enumerated()), id: \.offset) { index, file in
                                HStack(spacing: 6) {
                                    Image(systemName: "doc.text")
                                        .font(.system(size: 10))
                                        .foregroundColor(.secondary)
                                    Text(settings.demoMode ? DemoContent.shared.mask(file, as: .filePath) : file)
                                        .font(.system(size: 11, design: .monospaced))
                                        .lineLimit(1)
                                        .textSelection(.enabled)
                                    Spacer()
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)

                                if index < files.count - 1 {
                                    Divider().padding(.leading, 28)
                                }
                            }
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.5))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color(nsColor: .separatorColor).opacity(0.2), lineWidth: 0.5)
                        )
                    }
                }

                // Resume button
                Button {
                    NotificationCenter.default.post(
                        name: .launchTask,
                        object: nil,
                        userInfo: [
                            LaunchTaskKey.title: "Claude (Resume)",
                            LaunchTaskKey.command: "\(settings.commandWithArgs(for: .claude)) --resume \(session.id)",
                            LaunchTaskKey.projectId: appState.currentProject?.id ?? ""
                        ]
                    )
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 10))
                        Text("Resume This Session")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(Color.accentColor.opacity(0.15))
                    .foregroundColor(.accentColor)
                    .cornerRadius(7)
                    .overlay(
                        RoundedRectangle(cornerRadius: 7)
                            .stroke(Color.accentColor.opacity(0.25), lineWidth: 0.5)
                    )
                }
                .buttonStyle(.plain)
                .padding(.top, 4)

                // Extract Tasks section
                extractTasksSection

                Spacer()
            }
            .padding(20)
        }
    }

    // MARK: - Summary Section

    @ViewBuilder
    private var summarySection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Summary")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.secondary)
                    .textCase(.uppercase)
                    .tracking(0.3)

                Spacer()

                // AI Summary button
                if claudeService.isGenerating {
                    HStack(spacing: 6) {
                        ProgressView()
                            .scaleEffect(0.6)
                        Text("Generating...")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                } else {
                    Button {
                        generateAISummary()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 10, weight: .semibold))
                            Text(aiSummary != nil ? "Regenerate" : "AI Summary")
                                .font(.system(size: 10, weight: .semibold))
                        }
                        .foregroundColor(.purple)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            Capsule().fill(Color.purple.opacity(0.1))
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            // Show AI summary if available, otherwise show basic summary
            if let ai = aiSummary {
                VStack(alignment: .leading, spacing: 8) {
                    Text(settings.demoMode ? DemoContent.shared.mask(ai, as: .snippet) : ai)
                        .font(.system(size: 13))
                        .foregroundColor(.primary.opacity(0.85))
                        .textSelection(.enabled)

                    HStack(spacing: 8) {
                        Button("Save to Session") {
                            ClaudeService.saveSummary(ai, sessionId: session.id)
                            NotificationCenter.default.post(name: .sessionsDidChange, object: nil)
                        }
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.accentColor)
                        .buttonStyle(.plain)

                        Button("Dismiss") {
                            aiSummary = nil
                        }
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.secondary)
                        .buttonStyle(.plain)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.purple.opacity(0.05))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.purple.opacity(0.15), lineWidth: 0.5)
                )
            } else if let summary = session.summary, !summary.isEmpty {
                Text(settings.demoMode ? DemoContent.shared.mask(summary, as: .snippet) : summary)
                    .font(.system(size: 13))
                    .foregroundColor(.primary.opacity(0.85))
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color(nsColor: .controlBackgroundColor).opacity(0.5))
                    )
            } else if let error = summaryError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 11))
                        .foregroundColor(.orange)
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.orange.opacity(0.05))
                )
            } else {
                Text("No summary available")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                    .italic()
            }
        }
    }

    // MARK: - Extract Tasks Section

    @ViewBuilder
    private var extractTasksSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if claudeService.isGenerating {
                    HStack(spacing: 6) {
                        ProgressView()
                            .scaleEffect(0.6)
                        Text("Extracting tasks...")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                } else {
                    Button {
                        extractTasks()
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "text.magnifyingglass")
                                .font(.system(size: 10, weight: .semibold))
                            Text("Extract Tasks from Session")
                                .font(.system(size: 12, weight: .medium))
                        }
                        .foregroundColor(.purple)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Color.purple.opacity(0.1))
                        .cornerRadius(7)
                        .overlay(
                            RoundedRectangle(cornerRadius: 7)
                                .stroke(Color.purple.opacity(0.2), lineWidth: 0.5)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            if let count = extractedTaskCount {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 11))
                        .foregroundColor(.green)
                    Text("Extracted \(count) task\(count == 1 ? "" : "s") — view in Task Board")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }
            }

            if let error = extractError {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 10))
                        .foregroundColor(.orange)
                    Text(error)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    // MARK: - Extract Tasks Action

    private func extractTasks() {
        guard let project = appState.currentProject,
              let claudeDir = project.claudeProject else {
            extractError = "No project context available"
            return
        }

        extractError = nil
        extractedTaskCount = nil

        Task {
            guard let tasks = await claudeService.extractTasksFromSession(
                sessionId: session.id,
                claudeProjectPath: claudeDir
            ) else {
                extractError = claudeService.lastError ?? "Failed to extract tasks"
                return
            }

            if tasks.isEmpty {
                extractedTaskCount = 0
                return
            }

            // Save extracted tasks to database
            let projectId = project.id
            let sessionId = session.id
            let count = Self.saveExtractedTasks(tasks, projectId: projectId, sessionId: sessionId)
            extractedTaskCount = count
        }
    }

    // MARK: - Save Extracted Tasks (synchronous, non-isolated)

    private nonisolated static func saveExtractedTasks(
        _ tasks: [(title: String, description: String?, priority: Int)],
        projectId: String,
        sessionId: String
    ) -> Int {
        var count = 0
        for extracted in tasks {
            do {
                try DatabaseService.shared.dbQueue.write { db in
                    var task = TaskItem(
                        id: nil,
                        projectId: projectId,
                        title: extracted.title,
                        description: extracted.description,
                        status: "todo",
                        priority: extracted.priority,
                        sourceSession: sessionId,
                        source: "ai-extracted",
                        createdAt: Date(),
                        completedAt: nil,
                        labels: nil,
                        attachments: nil
                    )
                    try task.insert(db)
                }
                count += 1
            } catch {
                print("SessionDetailView: failed to insert extracted task: \(error)")
            }
        }
        return count
    }

    // MARK: - AI Generation

    private func generateAISummary() {
        guard let project = appState.currentProject,
              let claudeDir = project.claudeProject else {
            summaryError = "No project context available"
            return
        }

        summaryError = nil

        Task {
            if let result = await claudeService.generateSessionSummary(
                sessionId: session.id,
                claudeProjectPath: claudeDir
            ) {
                aiSummary = result
            } else {
                summaryError = claudeService.lastError ?? "Failed to generate summary"
            }
        }
    }
}

// MARK: - Detail Badge

struct DetailBadge: View {
    let icon: String
    let text: String
    var color: Color = .secondary

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10))
            Text(text)
                .font(.system(size: 11))
                .lineLimit(1)
        }
        .foregroundColor(color == .secondary ? .secondary : color.opacity(0.8))
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(
            Capsule()
                .fill(color == .secondary
                      ? Color(nsColor: .separatorColor).opacity(0.12)
                      : color.opacity(0.1))
        )
    }
}

// MARK: - Detail Stat

struct DetailStat: View {
    let icon: String
    let label: String
    let value: String
    var color: Color = .accentColor

    var body: some View {
        VStack(spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(color.opacity(0.7))
            Text(value)
                .font(.system(size: 17, weight: .bold, design: .rounded))
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.secondary)
        }
        .frame(width: 80, height: 60)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.6))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(nsColor: .separatorColor).opacity(0.25), lineWidth: 0.5)
        )
    }
}

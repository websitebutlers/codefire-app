import SwiftUI
import AppKit

struct GitChangesView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var githubService: GitHubService
    @StateObject private var gitService = GitChangesService()

    @State private var commitMessage: String = ""
    @State private var collapsedSections: Set<String> = []
    @State private var isCommitting = false

    var body: some View {
        Group {
            if !gitService.isGitRepo && !gitService.isLoading {
                emptyState
            } else {
                changesContent
            }
        }
        .onAppear { scanProject() }
        .onChange(of: appState.currentProject?.id) { scanProject() }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 32))
                .foregroundStyle(.tertiary)

            Text("Not a Git Repository")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.secondary)

            Text("This project is not tracked by Git. Initialize a repository to see changes here.")
                .font(.system(size: 12))
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 280)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Changes Content

    private var changesContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Header
                header
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)

                Divider()

                // Commit Composer
                commitComposer
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)

                Divider()

                // Staged Changes
                sectionHeader(
                    title: "Staged Changes",
                    icon: "checkmark.circle.fill",
                    count: gitService.stagedFiles.count,
                    key: "staged",
                    accentColor: .green
                )

                if !collapsedSections.contains("staged") {
                    if gitService.stagedFiles.isEmpty {
                        sectionEmpty("No staged changes")
                    } else {
                        LazyVStack(spacing: 4) {
                            ForEach(gitService.stagedFiles) { file in
                                fileRow(file, isStaged: true)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 8)
                    }
                }

                Divider()

                // Unstaged Changes
                sectionHeader(
                    title: "Changes",
                    icon: "circle.dashed",
                    count: gitService.unstagedFiles.count,
                    key: "unstaged",
                    accentColor: .orange
                )

                if !collapsedSections.contains("unstaged") {
                    if gitService.unstagedFiles.isEmpty {
                        sectionEmpty("No unstaged changes")
                    } else {
                        LazyVStack(spacing: 4) {
                            ForEach(gitService.unstagedFiles) { file in
                                fileRow(file, isStaged: false)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 8)
                    }
                }

                Divider()

                // Untracked Files
                sectionHeader(
                    title: "Untracked",
                    icon: "questionmark.circle",
                    count: gitService.untrackedFiles.count,
                    key: "untracked",
                    accentColor: .secondary
                )

                if !collapsedSections.contains("untracked") {
                    if gitService.untrackedFiles.isEmpty {
                        sectionEmpty("No untracked files")
                    } else {
                        LazyVStack(spacing: 4) {
                            ForEach(gitService.untrackedFiles) { file in
                                fileRow(file, isStaged: false)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 8)
                    }
                }

                Divider()

                // Recent Commits
                sectionHeader(
                    title: "Recent Commits",
                    icon: "clock",
                    count: gitService.recentCommits.count,
                    key: "commits",
                    accentColor: .secondary
                )

                if !collapsedSections.contains("commits") {
                    if gitService.recentCommits.isEmpty {
                        sectionEmpty("No commits yet")
                    } else {
                        LazyVStack(spacing: 4) {
                            ForEach(gitService.recentCommits) { entry in
                                commitRow(entry)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 8)
                    }
                }

                // MARK: - GitHub Sections
                if githubService.isAvailable {
                    Divider()

                    // GitHub header
                    HStack(spacing: 6) {
                        Image(systemName: "link")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.tertiary)
                        if let repo = githubService.repo {
                            Text("\(repo.owner)/\(repo.name)")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        if githubService.isLoading {
                            ProgressView()
                                .controlSize(.mini)
                                .scaleEffect(0.7)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)

                    Divider()

                    // Pull Requests
                    sectionHeader(
                        title: "Pull Requests",
                        icon: "arrow.triangle.pull",
                        count: githubService.pullRequests.count,
                        key: "prs",
                        accentColor: .purple
                    )

                    if !collapsedSections.contains("prs") {
                        if githubService.pullRequests.isEmpty {
                            sectionEmpty("No open pull requests")
                        } else {
                            LazyVStack(spacing: 4) {
                                ForEach(githubService.pullRequests) { pr in
                                    prRow(pr)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.bottom, 8)
                        }
                    }

                    Divider()

                    // CI / Workflows
                    sectionHeader(
                        title: "CI / Workflows",
                        icon: "gearshape.2",
                        count: githubService.workflows.count,
                        key: "ci",
                        accentColor: .cyan
                    )

                    if !collapsedSections.contains("ci") {
                        if githubService.workflows.isEmpty {
                            sectionEmpty("No recent workflow runs")
                        } else {
                            LazyVStack(spacing: 4) {
                                ForEach(githubService.workflows) { workflow in
                                    workflowRow(workflow)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.bottom, 8)
                        }
                    }

                    Divider()

                    // Issues
                    sectionHeader(
                        title: "Issues",
                        icon: "exclamationmark.circle",
                        count: githubService.issues.count,
                        key: "issues",
                        accentColor: .yellow
                    )

                    if !collapsedSections.contains("issues") {
                        if githubService.issues.isEmpty {
                            sectionEmpty("No issues assigned to you")
                        } else {
                            LazyVStack(spacing: 4) {
                                ForEach(githubService.issues) { issue in
                                    issueRow(issue)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.bottom, 8)
                        }
                    }
                }
            }
            .padding(.bottom, 20)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.secondary)

            Text(gitService.currentBranch)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundColor(.primary)
                .lineLimit(1)

            let totalChanges = gitService.stagedFiles.count + gitService.unstagedFiles.count + gitService.untrackedFiles.count
            if totalChanges > 0 {
                Text("\(totalChanges)")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(Color.orange))
            }

            Spacer()

            if gitService.isLoading {
                ProgressView()
                    .controlSize(.mini)
                    .scaleEffect(0.7)
            }

            Button {
                Task { await gitService.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
            .help("Refresh")
        }
    }

    // MARK: - Commit Composer

    private var commitComposer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Commit Message")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.secondary)

            TextEditor(text: $commitMessage)
                .font(.system(size: 12, design: .monospaced))
                .frame(height: 60)
                .scrollContentBackground(.hidden)
                .padding(6)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color(nsColor: .controlBackgroundColor))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(nsColor: .separatorColor).opacity(0.5), lineWidth: 0.5)
                )

            HStack(spacing: 8) {
                Button {
                    gitService.stageAll()
                } label: {
                    Text("Stage All")
                        .font(.system(size: 11, weight: .medium))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(Color.green.opacity(0.12))
                )
                .foregroundColor(.green)

                Button {
                    gitService.unstageAll()
                } label: {
                    Text("Unstage All")
                        .font(.system(size: 11, weight: .medium))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(Color.orange.opacity(0.12))
                )
                .foregroundColor(.orange)

                Spacer()

                Button {
                    performCommit()
                } label: {
                    HStack(spacing: 4) {
                        if isCommitting {
                            ProgressView()
                                .controlSize(.mini)
                                .scaleEffect(0.6)
                        }
                        Text("Commit")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 5)
                    .background(
                        RoundedRectangle(cornerRadius: 5)
                            .fill(canCommit ? Color.accentColor : Color.secondary.opacity(0.2))
                    )
                    .foregroundColor(canCommit ? .white : .secondary)
                }
                .buttonStyle(.plain)
                .disabled(!canCommit || isCommitting)
            }
        }
    }

    private var canCommit: Bool {
        !gitService.stagedFiles.isEmpty && !commitMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Section Header

    @ViewBuilder
    private func sectionHeader(title: String, icon: String, count: Int, key: String, accentColor: Color) -> some View {
        let isCollapsed = collapsedSections.contains(key)

        Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                if isCollapsed {
                    collapsedSections.remove(key)
                } else {
                    collapsedSections.insert(key)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(accentColor)
                    .frame(width: 16)

                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.primary)

                if count > 0 {
                    Text("\(count)")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(accentColor.opacity(0.7)))
                }

                Spacer()

                Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func sectionEmpty(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 11))
            .foregroundStyle(.tertiary)
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
    }

    // MARK: - File Row

    private func fileRow(_ file: GitFileChange, isStaged: Bool) -> some View {
        HStack(spacing: 8) {
            // Status icon
            Image(systemName: file.status.icon)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(file.status.color)
                .frame(width: 20)

            // File name and directory
            VStack(alignment: .leading, spacing: 1) {
                Text(fileName(from: file.path))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.primary)
                    .lineLimit(1)

                let dir = directoryPath(from: file.path)
                if !dir.isEmpty {
                    Text(dir)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            Spacer()

            // Status badge
            Text(file.status.label)
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(file.status.color)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 3)
                        .fill(file.status.color.opacity(0.12))
                )

            // Stage/Unstage button
            if isStaged {
                Button {
                    gitService.unstageFile(file)
                } label: {
                    Image(systemName: "minus")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.orange)
                        .frame(width: 20, height: 20)
                        .background(
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Color.orange.opacity(0.12))
                        )
                }
                .buttonStyle(.plain)
                .help("Unstage")
            } else {
                Button {
                    gitService.stageFile(file)
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.green)
                        .frame(width: 20, height: 20)
                        .background(
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Color.green.opacity(0.12))
                        )
                }
                .buttonStyle(.plain)
                .help("Stage")
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.7))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
        )
    }

    // MARK: - Commit Row

    private func commitRow(_ entry: GitLogEntry) -> some View {
        HStack(spacing: 8) {
            Text(entry.sha)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(.accentColor)
                .frame(width: 60, alignment: .leading)

            Text(entry.message)
                .font(.system(size: 12))
                .foregroundColor(.primary)
                .lineLimit(1)

            Spacer()

            Text(entry.relativeDate)
                .font(.system(size: 10))
                .foregroundColor(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.5))
        )
    }

    // MARK: - Helpers

    private func scanProject() {
        guard let project = appState.currentProject else { return }
        gitService.scan(projectPath: project.path)
    }

    private func performCommit() {
        let message = commitMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        isCommitting = true
        Task {
            let success = await gitService.commit(message: message)
            isCommitting = false
            if success {
                commitMessage = ""
            }
        }
    }

    private func fileName(from path: String) -> String {
        (path as NSString).lastPathComponent
    }

    private func directoryPath(from path: String) -> String {
        let dir = (path as NSString).deletingLastPathComponent
        return dir == "." ? "" : dir
    }

    private func relativeTime(_ date: Date) -> String {
        let elapsed = Date().timeIntervalSince(date)
        if elapsed < 60 { return "just now" }
        let minutes = Int(elapsed / 60)
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 30 { return "\(days)d ago" }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    // MARK: - GitHub: PR Row

    private func prRow(_ pr: GitHubPR) -> some View {
        Button {
            if let repo = githubService.repo {
                let urlString = "https://github.com/\(repo.owner)/\(repo.name)/pull/\(pr.number)"
                if let url = URL(string: urlString) {
                    NSWorkspace.shared.open(url)
                }
            }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("#\(pr.number)")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(.accentColor)

                    Text(pr.title)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                        .truncationMode(.tail)

                    Spacer()

                    checksIcon(pr.checksStatus)
                    reviewIcon(pr.reviewDecision)
                }

                HStack(spacing: 8) {
                    Text(pr.author.login)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)

                    HStack(spacing: 3) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.system(size: 8))
                        Text(pr.headRefName)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)

                    if pr.isDraft {
                        Text("Draft")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(.orange)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.orange.opacity(0.15)))
                    }

                    Spacer()

                    HStack(spacing: 4) {
                        Text("+\(pr.additions)")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundColor(.green)
                        Text("-\(pr.deletions)")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundColor(.red)
                    }

                    Text(relativeTime(pr.updatedAt))
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(nsColor: .controlBackgroundColor).opacity(0.7))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - GitHub: Workflow Row

    private func workflowRow(_ workflow: GitHubWorkflow) -> some View {
        Button {
            if let url = URL(string: workflow.url) {
                NSWorkspace.shared.open(url)
            }
        } label: {
            HStack(spacing: 8) {
                workflowStatusIcon(status: workflow.status, conclusion: workflow.conclusion)

                VStack(alignment: .leading, spacing: 2) {
                    Text(workflow.name)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.primary)
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        HStack(spacing: 3) {
                            Image(systemName: "arrow.triangle.branch")
                                .font(.system(size: 8))
                            Text(workflow.headBranch)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)

                        Text(workflow.event)
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                Text(relativeTime(workflow.createdAt))
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(nsColor: .controlBackgroundColor).opacity(0.7))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - GitHub: Issue Row

    private func issueRow(_ issue: GitHubIssue) -> some View {
        Button {
            if let repo = githubService.repo {
                let urlString = "https://github.com/\(repo.owner)/\(repo.name)/issues/\(issue.number)"
                if let url = URL(string: urlString) {
                    NSWorkspace.shared.open(url)
                }
            }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("#\(issue.number)")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(.accentColor)

                    Text(issue.title)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                        .truncationMode(.tail)

                    Spacer()

                    Text(relativeTime(issue.updatedAt))
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }

                if !issue.labels.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(issue.labels, id: \.name) { label in
                            Text(label.name)
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(
                                    Capsule()
                                        .fill(Color(hex: label.color) ?? Color.secondary)
                                )
                        }
                    }
                }
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(nsColor: .controlBackgroundColor).opacity(0.7))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - GitHub: Status Icons

    @ViewBuilder
    private func checksIcon(_ status: GitHubPR.ChecksStatus) -> some View {
        switch status {
        case .passing:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 12))
                .foregroundColor(.green)
        case .failing:
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 12))
                .foregroundColor(.red)
        case .pending:
            Image(systemName: "clock.fill")
                .font(.system(size: 12))
                .foregroundColor(.orange)
        case .none:
            EmptyView()
        }
    }

    @ViewBuilder
    private func reviewIcon(_ decision: String?) -> some View {
        switch decision {
        case "APPROVED":
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 12))
                .foregroundColor(.green)
        case "CHANGES_REQUESTED":
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 12))
                .foregroundColor(.red)
        case "REVIEW_REQUIRED":
            Image(systemName: "clock.fill")
                .font(.system(size: 12))
                .foregroundColor(.orange)
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private func workflowStatusIcon(status: String, conclusion: String?) -> some View {
        switch conclusion ?? status {
        case "success":
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 14))
                .foregroundColor(.green)
        case "failure":
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 14))
                .foregroundColor(.red)
        case "cancelled", "skipped":
            Image(systemName: "slash.circle")
                .font(.system(size: 14))
                .foregroundColor(.secondary)
        case "in_progress", "queued", "requested", "waiting", "pending":
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 14))
                .foregroundColor(.orange)
        default:
            Image(systemName: "questionmark.circle")
                .font(.system(size: 14))
                .foregroundColor(.secondary)
        }
    }
}

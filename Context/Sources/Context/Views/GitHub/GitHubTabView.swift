import SwiftUI
import AppKit

struct GitHubTabView: View {
    @EnvironmentObject var githubService: GitHubService

    @State private var expandedSections: Set<String> = ["prs", "ci", "commits", "issues"]

    var body: some View {
        if !githubService.isAvailable {
            emptyState
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Header
                    header
                        .padding(.horizontal, 20)
                        .padding(.top, 16)
                        .padding(.bottom, 12)

                    Divider()

                    // PR Section
                    sectionHeader(title: "Pull Requests", icon: "arrow.triangle.pull", count: githubService.pullRequests.count, key: "prs")
                    if expandedSections.contains("prs") {
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

                    // CI Section
                    sectionHeader(title: "CI / Workflows", icon: "gearshape.2", count: githubService.workflows.count, key: "ci")
                    if expandedSections.contains("ci") {
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

                    // Commits Section
                    sectionHeader(title: "Recent Commits", icon: "circle.fill", count: githubService.commits.count, key: "commits")
                    if expandedSections.contains("commits") {
                        if githubService.commits.isEmpty {
                            sectionEmpty("No commits found")
                        } else {
                            LazyVStack(spacing: 4) {
                                ForEach(githubService.commits) { commit in
                                    commitRow(commit)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.bottom, 8)
                        }
                    }

                    Divider()

                    // Issues Section
                    sectionHeader(title: "My Issues", icon: "exclamationmark.circle", count: githubService.issues.count, key: "issues")
                    if expandedSections.contains("issues") {
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
                .padding(.bottom, 20)
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            if let repo = githubService.repo {
                Image(systemName: "arrow.triangle.branch")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                Text("\(repo.owner)/\(repo.name)")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.primary)
            }

            Spacer()

            if githubService.isLoading {
                ProgressView()
                    .controlSize(.mini)
                    .scaleEffect(0.7)
            }

            if let lastRefresh = githubService.lastRefresh {
                Text(relativeTime(lastRefresh))
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }

            Button {
                Task { await githubService.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
            .help("Refresh")
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 32))
                .foregroundStyle(.tertiary)

            Text("No GitHub Repository")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.secondary)

            Text("This project has no GitHub remote, or the gh CLI is not installed.")
                .font(.system(size: 12))
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 280)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Section Header

    @ViewBuilder
    private func sectionHeader(title: String, icon: String, count: Int, key: String) -> some View {
        let isExpanded = expandedSections.contains(key)

        Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                if isExpanded {
                    expandedSections.remove(key)
                } else {
                    expandedSections.insert(key)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.secondary)
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
                        .background(Capsule().fill(Color.secondary.opacity(0.5)))
                }

                Spacer()

                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
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

    // MARK: - PR Row

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

                    // Checks badge
                    checksIcon(pr.checksStatus)

                    // Review badge
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

    // MARK: - CI / Workflow Row

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

    // MARK: - Commit Row

    private func commitRow(_ commit: GitHubCommitResponse) -> some View {
        HStack(spacing: 8) {
            Text(String(commit.sha.prefix(7)))
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(.accentColor)

            VStack(alignment: .leading, spacing: 2) {
                Text(commit.commit.message.components(separatedBy: .newlines).first ?? commit.commit.message)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                    .truncationMode(.tail)

                Text(commit.commit.author.name)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }

            Spacer()

            Text(relativeTime(commit.commit.author.date))
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
    }

    // MARK: - Issue Row

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

    // MARK: - Status Icons

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

    // MARK: - Helpers

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
}

# GitHub Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a GitHub tab to the GUI panel showing open PRs, recent commits, CI status, and assigned issues for the current project's repo.

**Architecture:** A `GitHubService: ObservableObject` shells out to the `gh` CLI every 60s via `Process()`, decoding JSON output into Swift models. A `GitHubTabView` renders four collapsible sections. Follows the same `@StateObject` + `.environmentObject()` pattern as existing services.

**Tech Stack:** SwiftUI, `gh` CLI (JSON mode), `Process()`, `JSONDecoder`

---

### Task 1: GitHubService — Models and Shell Helper

**Files:**
- Create: `Context/Sources/Context/Services/GitHubService.swift`

**Step 1: Create the file with models and the `gh` runner**

The `gh` CLI outputs JSON when you pass `--json`. We need a generic helper to run `gh` commands in a project directory and decode the result. Also need all the data models.

Note: `gh` is installed via Homebrew at `/opt/homebrew/bin/gh`. Since `Process()` doesn't inherit the user's shell PATH, we need to locate it. Use `/usr/bin/env` to resolve `gh` from PATH, or search common locations.

```swift
import Foundation

// MARK: - GitHub Models

struct GitHubRepo {
    let owner: String
    let name: String
    let defaultBranch: String
}

struct GitHubPR: Identifiable, Decodable {
    let number: Int
    let title: String
    let author: GitHubAuthor
    let headRefName: String
    let isDraft: Bool
    let reviewDecision: String?
    let createdAt: Date
    let updatedAt: Date
    let additions: Int
    let deletions: Int
    let statusCheckRollup: [GitHubCheck]?

    var id: Int { number }

    struct GitHubAuthor: Decodable {
        let login: String
    }

    struct GitHubCheck: Decodable {
        let name: String?
        let status: String?
        let conclusion: String?
    }

    var checksStatus: ChecksStatus {
        guard let checks = statusCheckRollup, !checks.isEmpty else { return .none }
        if checks.contains(where: { $0.conclusion == "FAILURE" || $0.conclusion == "failure" }) { return .failing }
        if checks.contains(where: { $0.status == "IN_PROGRESS" || $0.status == "QUEUED" || $0.status == "PENDING" }) { return .running }
        if checks.allSatisfy({ $0.conclusion == "SUCCESS" || $0.conclusion == "success" || $0.conclusion == "NEUTRAL" || $0.conclusion == "SKIPPED" }) { return .passing }
        return .unknown
    }

    enum ChecksStatus {
        case none, passing, failing, running, unknown
    }
}

struct GitHubWorkflow: Identifiable, Decodable {
    let databaseId: Int
    let name: String
    let status: String
    let conclusion: String?
    let headBranch: String
    let event: String
    let createdAt: Date
    let url: String

    var id: Int { databaseId }
}

struct GitHubCommitResponse: Decodable {
    let sha: String
    let commit: CommitDetail

    struct CommitDetail: Decodable {
        let message: String
        let author: AuthorDetail

        struct AuthorDetail: Decodable {
            let name: String
            let date: Date
        }
    }
}

struct GitHubIssue: Identifiable, Decodable {
    let number: Int
    let title: String
    let assignees: [Assignee]
    let labels: [IssueLabel]
    let state: String
    let createdAt: Date
    let updatedAt: Date

    var id: Int { number }

    struct Assignee: Decodable {
        let login: String
    }

    struct IssueLabel: Decodable {
        let name: String
        let color: String
    }
}

// MARK: - GitHubService

@MainActor
class GitHubService: ObservableObject {
    @Published var repo: GitHubRepo?
    @Published var pullRequests: [GitHubPR] = []
    @Published var commits: [GitHubCommitResponse] = []
    @Published var workflows: [GitHubWorkflow] = []
    @Published var issues: [GitHubIssue] = []
    @Published var isAvailable = false
    @Published var isLoading = false
    @Published var lastRefresh: Date?

    private var pollTimer: Timer?
    private var projectPath: String?

    func startMonitoring(projectPath: String) {
        self.projectPath = projectPath
        detectRepo()
    }

    func stopMonitoring() {
        pollTimer?.invalidate()
        pollTimer = nil
        projectPath = nil
    }

    func refresh() {
        guard isAvailable, let path = projectPath else { return }
        isLoading = true
        let owner = repo!.owner
        let name = repo!.name
        let branch = repo!.defaultBranch

        Task.detached { [weak self] in
            let prs = Self.fetchPRs(at: path)
            let commits = Self.fetchCommits(owner: owner, repo: name, branch: branch, at: path)
            let workflows = Self.fetchWorkflows(at: path)
            let issues = Self.fetchIssues(at: path)

            await MainActor.run {
                self?.pullRequests = prs
                self?.commits = commits
                self?.workflows = workflows
                self?.issues = issues
                self?.isLoading = false
                self?.lastRefresh = Date()
            }
        }
    }

    // MARK: - Repo Detection

    private func detectRepo() {
        guard let path = projectPath else { return }

        Task.detached { [weak self] in
            guard let json = Self.runGH(["repo", "view", "--json", "owner,name,defaultBranchRef"], at: path),
                  let dict = json as? [String: Any],
                  let ownerDict = dict["owner"] as? [String: Any],
                  let owner = ownerDict["login"] as? String,
                  let name = dict["name"] as? String else {
                await MainActor.run {
                    self?.isAvailable = false
                }
                return
            }

            let defaultBranch = (dict["defaultBranchRef"] as? [String: Any])?["name"] as? String ?? "main"

            await MainActor.run {
                self?.repo = GitHubRepo(owner: owner, name: name, defaultBranch: defaultBranch)
                self?.isAvailable = true
                self?.refresh()
                self?.pollTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in
                    Task { @MainActor in self?.refresh() }
                }
            }
        }
    }

    // MARK: - Data Fetching

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    nonisolated static func fetchPRs(at path: String) -> [GitHubPR] {
        guard let data = runGHRaw(["pr", "list", "--state", "open", "--json",
            "number,title,author,headRefName,isDraft,reviewDecision,statusCheckRollup,createdAt,updatedAt,additions,deletions"
        ], at: path) else { return [] }
        return (try? decoder.decode([GitHubPR].self, from: data)) ?? []
    }

    nonisolated static func fetchCommits(owner: String, repo: String, branch: String, at path: String) -> [GitHubCommitResponse] {
        guard let data = runGHRaw(["api", "repos/\(owner)/\(repo)/commits",
            "-q", ".", "--paginate",
            "-f", "sha=\(branch)", "-f", "per_page=15"
        ], at: path) else { return [] }
        return (try? decoder.decode([GitHubCommitResponse].self, from: data)) ?? []
    }

    nonisolated static func fetchWorkflows(at path: String) -> [GitHubWorkflow] {
        guard let data = runGHRaw(["run", "list", "--limit", "10", "--json",
            "databaseId,name,status,conclusion,headBranch,event,createdAt,url"
        ], at: path) else { return [] }
        return (try? decoder.decode([GitHubWorkflow].self, from: data)) ?? []
    }

    nonisolated static func fetchIssues(at path: String) -> [GitHubIssue] {
        guard let data = runGHRaw(["issue", "list", "--assignee", "@me", "--state", "open", "--json",
            "number,title,assignees,labels,state,createdAt,updatedAt"
        ], at: path) else { return [] }
        return (try? decoder.decode([GitHubIssue].self, from: data)) ?? []
    }

    // MARK: - gh CLI Runner

    /// Runs `gh` and returns parsed JSON (Any).
    nonisolated static func runGH(_ arguments: [String], at path: String) -> Any? {
        guard let data = runGHRaw(arguments, at: path) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    /// Runs `gh` and returns raw Data.
    nonisolated static func runGHRaw(_ arguments: [String], at path: String) -> Data? {
        let process = Process()
        let pipe = Pipe()

        // Find gh — check common Homebrew locations, then fall back to PATH
        let ghPaths = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]
        let ghPath = ghPaths.first { FileManager.default.fileExists(atPath: $0) }

        if let ghPath {
            process.executableURL = URL(fileURLWithPath: ghPath)
        } else {
            // Fall back to /usr/bin/env to resolve from PATH
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["gh"] + arguments
        }

        if process.arguments == nil || process.arguments?.first != "gh" {
            process.arguments = arguments
        }

        process.currentDirectoryURL = URL(fileURLWithPath: path)
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        // Inherit minimal env so gh can find its config
        var env = ProcessInfo.processInfo.environment
        env.removeValue(forKey: "CLAUDECODE")
        process.environment = env

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return nil
        }

        guard process.terminationStatus == 0 else { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return data.isEmpty ? nil : data
    }
}
```

**Step 2: Verify it compiles**

Run: `cd Context && swift build 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add Context/Sources/Context/Services/GitHubService.swift
git commit -m "feat: add GitHubService with gh CLI integration and data models"
```

---

### Task 2: AppState — Add GitHub Tab Case

**Files:**
- Modify: `Context/Sources/Context/ViewModels/AppState.swift:15-36`

**Step 1: Add the tab case and icon**

Add `case github = "GitHub"` to the `GUITab` enum (after `browser`, before `visualize`), and add the icon case to the `icon` property:

```swift
case github = "GitHub"
```

Icon:
```swift
case .github: return "arrow.triangle.branch"
```

**Step 2: Verify it compiles**

Run: `cd Context && swift build 2>&1 | tail -5`

The build will fail because `GUIPanelView` has an exhaustive switch on `GUITab` — that's expected and gets fixed in Task 4.

**Step 3: Commit**

```bash
git add Context/Sources/Context/ViewModels/AppState.swift
git commit -m "feat: add GitHub tab case to GUITab enum"
```

---

### Task 3: GitHubTabView — The UI

**Files:**
- Create: `Context/Sources/Context/Views/GitHub/GitHubTabView.swift`

**Step 1: Create the view**

Four collapsible sections (PRs, CI, Commits, Issues). Each section has a header with count badge. Clicking items opens in browser via `NSWorkspace.shared.open()`.

```swift
import SwiftUI
import AppKit

struct GitHubTabView: View {
    @EnvironmentObject var githubService: GitHubService

    @State private var expandedSections: Set<String> = ["prs", "ci", "commits", "issues"]

    var body: some View {
        if !githubService.isAvailable {
            unavailableState
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Header with refresh
                    HStack {
                        if let repo = githubService.repo {
                            Label("\(repo.owner)/\(repo.name)", systemImage: "arrow.triangle.branch")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(.primary)
                        }
                        Spacer()
                        if githubService.isLoading {
                            ProgressView()
                                .controlSize(.mini)
                                .scaleEffect(0.7)
                        }
                        if let lastRefresh = githubService.lastRefresh {
                            Text(lastRefresh, style: .relative)
                                .font(.system(size: 10))
                                .foregroundColor(.tertiary)
                        }
                        Button {
                            githubService.refresh()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                        }
                        .buttonStyle(.plain)
                        .help("Refresh")
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)

                    Divider()

                    // Sections
                    prSection
                    Divider()
                    ciSection
                    Divider()
                    commitsSection
                    Divider()
                    issuesSection
                }
            }
        }
    }

    // MARK: - Unavailable State

    private var unavailableState: some View {
        VStack(spacing: 12) {
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)
            Text("No GitHub Repository")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.secondary)
            Text("This project doesn't have a GitHub remote,\nor the gh CLI is not installed.")
                .font(.system(size: 11))
                .foregroundColor(.tertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Section Header Helper

    @ViewBuilder
    private func sectionHeader(title: String, icon: String, count: Int, key: String) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                if expandedSections.contains(key) {
                    expandedSections.remove(key)
                } else {
                    expandedSections.insert(key)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.secondary)
                    .frame(width: 16)
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.primary)
                Text("\(count)")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundColor(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(Color.secondary.opacity(0.5)))
                Spacer()
                Image(systemName: expandedSections.contains(key) ? "chevron.down" : "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Pull Requests Section

    private var prSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader(title: "Pull Requests", icon: "arrow.triangle.pull", count: githubService.pullRequests.count, key: "prs")

            if expandedSections.contains("prs") {
                if githubService.pullRequests.isEmpty {
                    emptyRow("No open pull requests")
                } else {
                    ForEach(githubService.pullRequests) { pr in
                        prRow(pr)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func prRow(_ pr: GitHubPR) -> some View {
        Button {
            if let repo = githubService.repo {
                let url = URL(string: "https://github.com/\(repo.owner)/\(repo.name)/pull/\(pr.number)")!
                NSWorkspace.shared.open(url)
            }
        } label: {
            HStack(spacing: 8) {
                // PR number
                Text("#\(pr.number)")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(.accentColor)
                    .frame(width: 40, alignment: .leading)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text(pr.title)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.primary)
                            .lineLimit(1)
                        if pr.isDraft {
                            Text("Draft")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundColor(.secondary)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Capsule().fill(Color.secondary.opacity(0.15)))
                        }
                    }
                    HStack(spacing: 6) {
                        Text(pr.author.login)
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                        Text(pr.headRefName)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer()

                // Review status
                reviewBadge(pr.reviewDecision)

                // Checks status
                checksBadge(pr.checksStatus)

                // Diff stats
                HStack(spacing: 2) {
                    Text("+\(pr.additions)")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(.green)
                    Text("-\(pr.deletions)")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(.red)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func reviewBadge(_ decision: String?) -> some View {
        let (icon, color): (String, Color) = {
            switch decision {
            case "APPROVED": return ("checkmark.circle.fill", .green)
            case "CHANGES_REQUESTED": return ("xmark.circle.fill", .red)
            case "REVIEW_REQUIRED": return ("clock.fill", .orange)
            default: return ("circle", .secondary.opacity(0.3))
            }
        }()
        Image(systemName: icon)
            .font(.system(size: 12))
            .foregroundColor(color)
            .help(decision ?? "No reviews")
    }

    @ViewBuilder
    private func checksBadge(_ status: GitHubPR.ChecksStatus) -> some View {
        let (icon, color): (String, Color) = {
            switch status {
            case .passing: return ("checkmark.circle.fill", .green)
            case .failing: return ("xmark.circle.fill", .red)
            case .running: return ("arrow.triangle.2.circlepath", .orange)
            case .none, .unknown: return ("circle.dotted", .secondary.opacity(0.3))
            }
        }()
        Image(systemName: icon)
            .font(.system(size: 12))
            .foregroundColor(color)
            .help("CI: \(String(describing: status))")
    }

    // MARK: - CI / Actions Section

    private var ciSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader(title: "Actions", icon: "gearshape.2", count: githubService.workflows.count, key: "ci")

            if expandedSections.contains("ci") {
                if githubService.workflows.isEmpty {
                    emptyRow("No recent workflow runs")
                } else {
                    ForEach(githubService.workflows) { run in
                        workflowRow(run)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func workflowRow(_ run: GitHubWorkflow) -> some View {
        Button {
            if let url = URL(string: run.url) {
                NSWorkspace.shared.open(url)
            }
        } label: {
            HStack(spacing: 8) {
                workflowStatusIcon(status: run.status, conclusion: run.conclusion)
                    .frame(width: 16)

                VStack(alignment: .leading, spacing: 2) {
                    Text(run.name)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text(run.headBranch)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.secondary)
                        Text(run.event)
                            .font(.system(size: 10))
                            .foregroundColor(.tertiary)
                    }
                }

                Spacer()

                Text(run.createdAt, style: .relative)
                    .font(.system(size: 10))
                    .foregroundColor(.tertiary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func workflowStatusIcon(status: String, conclusion: String?) -> some View {
        let (icon, color): (String, Color) = {
            if status == "in_progress" || status == "queued" {
                return ("arrow.triangle.2.circlepath", .orange)
            }
            switch conclusion {
            case "success": return ("checkmark.circle.fill", .green)
            case "failure": return ("xmark.circle.fill", .red)
            case "cancelled": return ("slash.circle", .secondary)
            case "skipped": return ("forward.circle", .secondary)
            default: return ("questionmark.circle", .secondary)
            }
        }()
        Image(systemName: icon)
            .font(.system(size: 12))
            .foregroundColor(color)
    }

    // MARK: - Commits Section

    private var commitsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader(title: "Recent Commits", icon: "circle.fill", count: githubService.commits.count, key: "commits")

            if expandedSections.contains("commits") {
                if githubService.commits.isEmpty {
                    emptyRow("No recent commits")
                } else {
                    ForEach(githubService.commits, id: \.sha) { commit in
                        commitRow(commit)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func commitRow(_ commit: GitHubCommitResponse) -> some View {
        HStack(spacing: 8) {
            Text(String(commit.sha.prefix(7)))
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(.accentColor)
                .frame(width: 55, alignment: .leading)

            Text(commit.commit.message.components(separatedBy: .newlines).first ?? "")
                .font(.system(size: 12))
                .foregroundColor(.primary)
                .lineLimit(1)

            Spacer()

            Text(commit.commit.author.name)
                .font(.system(size: 10))
                .foregroundColor(.secondary)
                .lineLimit(1)

            Text(commit.commit.author.date, style: .relative)
                .font(.system(size: 10))
                .foregroundColor(.tertiary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 5)
    }

    // MARK: - Issues Section

    private var issuesSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader(title: "My Issues", icon: "exclamationmark.circle", count: githubService.issues.count, key: "issues")

            if expandedSections.contains("issues") {
                if githubService.issues.isEmpty {
                    emptyRow("No issues assigned to you")
                } else {
                    ForEach(githubService.issues) { issue in
                        issueRow(issue)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func issueRow(_ issue: GitHubIssue) -> some View {
        Button {
            if let repo = githubService.repo {
                let url = URL(string: "https://github.com/\(repo.owner)/\(repo.name)/issues/\(issue.number)")!
                NSWorkspace.shared.open(url)
            }
        } label: {
            HStack(spacing: 8) {
                Text("#\(issue.number)")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(.accentColor)
                    .frame(width: 40, alignment: .leading)

                Text(issue.title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.primary)
                    .lineLimit(1)

                // Labels
                ForEach(issue.labels.prefix(3), id: \.name) { label in
                    Text(label.name)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(Color(hex: label.color) ?? .secondary)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(
                            Capsule().fill((Color(hex: label.color) ?? .secondary).opacity(0.15))
                        )
                        .lineLimit(1)
                }

                Spacer()

                Text(issue.updatedAt, style: .relative)
                    .font(.system(size: 10))
                    .foregroundColor(.tertiary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Empty Row Helper

    private func emptyRow(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundColor(.tertiary)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
    }
}
```

**Step 2: Verify it compiles**

Run: `cd Context && swift build 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/GitHub/GitHubTabView.swift
git commit -m "feat: add GitHubTabView with PR, CI, commit, and issue sections"
```

---

### Task 4: Wire Everything Together

**Files:**
- Modify: `Context/Sources/Context/ViewModels/AppState.swift:15-36` (already done in Task 2)
- Modify: `Context/Sources/Context/Views/GUIPanelView.swift:146-165` (tab switch)
- Modify: `Context/Sources/Context/Views/GUIPanelView.swift:256` (hidden tabs — remove .visualize if desired, or add nothing)
- Modify: `Context/Sources/Context/ContextApp.swift` (add @StateObject + .environmentObject)
- Modify: `Context/Sources/Context/Views/ProjectWindowView.swift` (add @StateObject + .environmentObject)

**Step 1: Add GitHubService to ContextApp**

In `ContextApp.swift`, add a new `@StateObject`:

```swift
@StateObject private var githubService = GitHubService()
```

Add `.environmentObject(githubService)` to the `MainSplitView()` modifiers.

In the `.onChange(of: appState.currentProject)` block, add:

```swift
githubService.startMonitoring(projectPath: project.path)
```

**Step 2: Add GitHubService to ProjectWindowView**

In `ProjectWindowView.swift`, add:

```swift
@StateObject private var githubService = GitHubService()
```

Add `.environmentObject(githubService)` to the environment object chain.

In `loadProject()`, add:

```swift
githubService.startMonitoring(projectPath: loaded.path)
```

In `.onDisappear`, add:

```swift
githubService.stopMonitoring()
```

**Step 3: Add GitHubTabView to the tab content switch in GUIPanelView**

In the `switch appState.selectedTab` block (around line 148), add:

```swift
case .github:
    GitHubTabView()
```

**Step 4: Build and verify**

Run: `bash scripts/package-app.sh`

**Step 5: Commit**

```bash
git add Context/Sources/Context/ViewModels/AppState.swift \
    Context/Sources/Context/Views/GUIPanelView.swift \
    Context/Sources/Context/ContextApp.swift \
    Context/Sources/Context/Views/ProjectWindowView.swift
git commit -m "feat: wire GitHub tab into GUI panel and project windows"
```

---

### Task 5: Final Build and Smoke Test

**Step 1: Full build**

Run: `bash scripts/package-app.sh`

**Step 2: Install and test**

```bash
rm -rf /Applications/Context.app && cp -r build/Context.app /Applications/ && open /Applications/Context.app
```

**Verification checklist:**
1. Open a project that has a GitHub remote → GitHub tab appears with data
2. PRs section shows open PRs with review + CI badges
3. Actions section shows recent workflow runs with status icons
4. Commits section shows recent commits on default branch
5. Issues section shows your assigned issues
6. Clicking any PR/issue/workflow opens it in the browser
7. Refresh button triggers immediate poll
8. Open a project WITHOUT a GitHub remote → "No GitHub Repository" empty state
9. Multiple project windows show independent GitHub data

**Step 3: Commit any fixes, then final commit if needed**

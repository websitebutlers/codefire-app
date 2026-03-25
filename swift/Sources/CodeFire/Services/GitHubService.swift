import Foundation
import SwiftUI

// MARK: - GitHub Data Models

struct GitHubRepo {
    let owner: String
    let name: String
    let defaultBranch: String
}

struct GitHubAuthor: Codable {
    let login: String
}

struct GitHubCheck: Codable {
    let name: String?
    let status: String?
    let conclusion: String?
}

struct GitHubPR: Codable, Identifiable {
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

    enum ChecksStatus {
        case passing
        case failing
        case pending
        case none
    }

    var checksStatus: ChecksStatus {
        guard let checks = statusCheckRollup, !checks.isEmpty else { return .none }
        if checks.allSatisfy({ $0.conclusion == "SUCCESS" || $0.conclusion == "NEUTRAL" || $0.conclusion == "SKIPPED" }) {
            return .passing
        }
        if checks.contains(where: { $0.conclusion == "FAILURE" || $0.conclusion == "CANCELLED" || $0.conclusion == "TIMED_OUT" }) {
            return .failing
        }
        return .pending
    }
}

struct GitHubWorkflow: Codable, Identifiable {
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

struct GitHubCommitResponse: Codable, Identifiable {
    let sha: String
    let commit: CommitDetail

    var id: String { sha }

    struct CommitDetail: Codable {
        let message: String
        let author: CommitAuthor
    }

    struct CommitAuthor: Codable {
        let name: String
        let date: Date
    }
}

struct GitHubIssue: Codable, Identifiable {
    let number: Int
    let title: String
    let assignees: [Assignee]
    let labels: [IssueLabel]
    let state: String
    let createdAt: Date
    let updatedAt: Date

    var id: Int { number }

    struct Assignee: Codable {
        let login: String
    }

    struct IssueLabel: Codable {
        let name: String
        let color: String
    }
}

// MARK: - GitHubService

/// Fetches GitHub data for the current project by shelling out to the `gh` CLI.
/// Polls every 60 seconds when monitoring is active.
@MainActor
class GitHubService: ObservableObject {
    @Published var repo: GitHubRepo?
    @Published var pullRequests: [GitHubPR] = []
    @Published var workflows: [GitHubWorkflow] = []
    @Published var commits: [GitHubCommitResponse] = []
    @Published var issues: [GitHubIssue] = []
    @Published var isLoading = false
    @Published var isAvailable = false
    @Published var lastRefresh: Date?

    private var timer: Timer?
    private var projectPath: String?

    // MARK: - Lifecycle

    func startMonitoring(projectPath: String) {
        stopMonitoring()
        self.projectPath = projectPath

        Task {
            await refresh()
        }

        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.refresh()
            }
        }
    }

    func stopMonitoring() {
        timer?.invalidate()
        timer = nil
        projectPath = nil
        repo = nil
        pullRequests = []
        workflows = []
        commits = []
        issues = []
        isAvailable = false
        lastRefresh = nil
    }

    /// Pause polling without losing state. Used when the project window loses focus.
    func pauseMonitoring() {
        timer?.invalidate()
        timer = nil
    }

    /// Resume polling after a pause. Re-creates the timer if we have a project path.
    func resumeMonitoring() {
        guard timer == nil, projectPath != nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.refresh()
            }
        }
    }

    func refresh() async {
        guard let path = projectPath else { return }
        isLoading = true

        // Detect repo first
        let detectedRepo = await Task.detached {
            Self.detectRepo(at: path)
        }.value

        guard let detectedRepo else {
            isLoading = false
            isAvailable = false
            return
        }

        repo = detectedRepo
        isAvailable = true

        // Fetch all data in parallel
        let prs = await Task.detached { Self.fetchPRs(at: path) }.value
        let wfs = await Task.detached { Self.fetchWorkflows(at: path) }.value
        let cms = await Task.detached { Self.fetchCommits(at: path, owner: detectedRepo.owner, repo: detectedRepo.name, branch: detectedRepo.defaultBranch) }.value
        let iss = await Task.detached { Self.fetchIssues(at: path) }.value

        pullRequests = prs
        workflows = wfs
        commits = cms
        issues = iss
        isLoading = false
        lastRefresh = Date()
    }

    // MARK: - Detect Repo

    nonisolated static func detectRepo(at path: String) -> GitHubRepo? {
        guard let data = runGHRaw(["repo", "view", "--json", "owner,name,defaultBranchRef"], at: path) else {
            return nil
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let ownerDict = json["owner"] as? [String: Any],
              let ownerLogin = ownerDict["login"] as? String,
              let name = json["name"] as? String else {
            return nil
        }

        var defaultBranch = "main"
        if let branchRef = json["defaultBranchRef"] as? [String: Any],
           let branchName = branchRef["name"] as? String {
            defaultBranch = branchName
        }

        return GitHubRepo(owner: ownerLogin, name: name, defaultBranch: defaultBranch)
    }

    // MARK: - Fetch PRs

    nonisolated static func fetchPRs(at path: String) -> [GitHubPR] {
        guard let data = runGHRaw([
            "pr", "list", "--state", "open",
            "--json", "number,title,author,headRefName,isDraft,reviewDecision,statusCheckRollup,createdAt,updatedAt,additions,deletions"
        ], at: path) else {
            return []
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([GitHubPR].self, from: data)) ?? []
    }

    // MARK: - Fetch Commits

    nonisolated static func fetchCommits(at path: String, owner: String, repo: String, branch: String) -> [GitHubCommitResponse] {
        guard let data = runGHRaw([
            "api", "repos/\(owner)/\(repo)/commits",
            "-f", "sha=\(branch)",
            "-f", "per_page=15"
        ], at: path) else {
            return []
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([GitHubCommitResponse].self, from: data)) ?? []
    }

    // MARK: - Fetch Workflows

    nonisolated static func fetchWorkflows(at path: String) -> [GitHubWorkflow] {
        guard let data = runGHRaw([
            "run", "list", "--limit", "10",
            "--json", "databaseId,name,status,conclusion,headBranch,event,createdAt,url"
        ], at: path) else {
            return []
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([GitHubWorkflow].self, from: data)) ?? []
    }

    // MARK: - Fetch Issues

    nonisolated static func fetchIssues(at path: String) -> [GitHubIssue] {
        guard let data = runGHRaw([
            "issue", "list", "--assignee", "@me", "--state", "open",
            "--json", "number,title,assignees,labels,state,createdAt,updatedAt"
        ], at: path) else {
            return []
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([GitHubIssue].self, from: data)) ?? []
    }

    // MARK: - Process Helpers

    /// Run a `gh` command and return raw Data, or nil on failure.
    nonisolated static func runGHRaw(_ arguments: [String], at path: String) -> Data? {
        let process = Process()
        let pipe = Pipe()

        // Find gh binary — Process() doesn't inherit shell PATH
        let ghPaths = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]
        var ghURL: URL?
        for candidate in ghPaths {
            if FileManager.default.fileExists(atPath: candidate) {
                ghURL = URL(fileURLWithPath: candidate)
                break
            }
        }

        if ghURL == nil {
            // Fall back to /usr/bin/env to locate gh
            ghURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["gh"] + arguments
        } else {
            process.arguments = arguments
        }

        process.executableURL = ghURL
        process.currentDirectoryURL = URL(fileURLWithPath: path)
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        // Pass full environment minus CLAUDECODE to avoid nested session issues
        var env = ProcessInfo.processInfo.environment
        env.removeValue(forKey: "CLAUDECODE")
        process.environment = env

        do {
            try process.run()
        } catch {
            return nil
        }

        // Read pipe data BEFORE waitUntilExit() — if the 64KB kernel pipe buffer
        // fills, the child blocks on write and waitUntilExit() deadlocks both.
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        guard process.terminationStatus == 0 else { return nil }
        guard !data.isEmpty else { return nil }

        return data
    }
}

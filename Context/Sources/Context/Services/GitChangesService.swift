import Foundation
import SwiftUI

// MARK: - Models

enum GitFileStatus: String, CaseIterable {
    case modified = "M"
    case added = "A"
    case deleted = "D"
    case renamed = "R"
    case untracked = "?"
    case copied = "C"

    var icon: String {
        switch self {
        case .modified: return "pencil.circle.fill"
        case .added: return "plus.circle.fill"
        case .deleted: return "minus.circle.fill"
        case .renamed: return "arrow.right.circle.fill"
        case .untracked: return "questionmark.circle.fill"
        case .copied: return "doc.on.doc.fill"
        }
    }

    var color: Color {
        switch self {
        case .modified: return .orange
        case .added: return .green
        case .deleted: return .red
        case .renamed: return .blue
        case .untracked: return .secondary
        case .copied: return .purple
        }
    }

    var label: String {
        switch self {
        case .modified: return "Modified"
        case .added: return "Added"
        case .deleted: return "Deleted"
        case .renamed: return "Renamed"
        case .untracked: return "Untracked"
        case .copied: return "Copied"
        }
    }
}

struct GitFileChange: Identifiable {
    let id = UUID()
    let path: String
    let status: GitFileStatus
    let isStaged: Bool
}

struct GitLogEntry: Identifiable {
    let id = UUID()
    let sha: String
    let message: String
    let author: String
    let relativeDate: String
}

// MARK: - GitChangesService

@MainActor
class GitChangesService: ObservableObject {
    @Published var stagedFiles: [GitFileChange] = []
    @Published var unstagedFiles: [GitFileChange] = []
    @Published var untrackedFiles: [GitFileChange] = []
    @Published var recentCommits: [GitLogEntry] = []
    @Published var currentBranch: String = ""
    @Published var isLoading: Bool = false
    @Published var isGitRepo: Bool = false
    @Published var selectedFileDiff: (file: GitFileChange, lines: [DiffLine])?

    private var projectPath: String?

    func scan(projectPath: String) {
        self.projectPath = projectPath
        Task { await refresh() }
    }

    func refresh() async {
        guard let path = projectPath else { return }
        isLoading = true

        // Run git operations on detached tasks to avoid blocking the main actor
        let statusResult = await Task.detached {
            GitChangesService.parseGitStatus(at: path)
        }.value

        let logResult = await Task.detached {
            GitChangesService.parseGitLog(at: path)
        }.value

        let branchResult = await Task.detached {
            GitChangesService.getCurrentBranch(at: path)
        }.value

        // Check if this is a git repo based on whether branch detection succeeded
        let isRepo = branchResult != nil

        self.isGitRepo = isRepo
        if isRepo {
            self.stagedFiles = statusResult.staged
            self.unstagedFiles = statusResult.unstaged
            self.untrackedFiles = statusResult.untracked
            self.recentCommits = logResult
            self.currentBranch = branchResult ?? ""
        } else {
            self.stagedFiles = []
            self.unstagedFiles = []
            self.untrackedFiles = []
            self.recentCommits = []
            self.currentBranch = ""
        }
        self.isLoading = false
    }

    func stageFile(_ file: GitFileChange) {
        guard let path = projectPath else { return }
        _ = Self.runGit(["add", "--", file.path], at: path)
        Task { await refresh() }
    }

    func unstageFile(_ file: GitFileChange) {
        guard let path = projectPath else { return }
        _ = Self.runGit(["restore", "--staged", "--", file.path], at: path)
        Task { await refresh() }
    }

    func stageAll() {
        guard let path = projectPath else { return }
        _ = Self.runGit(["add", "-A"], at: path)
        Task { await refresh() }
    }

    func unstageAll() {
        guard let path = projectPath else { return }
        _ = Self.runGit(["restore", "--staged", "."], at: path)
        Task { await refresh() }
    }

    func commit(message: String) async -> Bool {
        guard let path = projectPath else { return false }
        let result = await Task.detached {
            GitChangesService.runGit(["commit", "-m", message], at: path)
        }.value
        let success = result != nil
        if success {
            await refresh()
        }
        return success
    }

    func loadDiff(for file: GitFileChange) {
        guard let path = projectPath else { return }
        Task {
            let diffOutput = await Task.detached {
                GitChangesService.diffFile(at: path, filePath: file.path, staged: file.isStaged)
            }.value
            let lines = DiffViewerView.parseDiffStatic(diffOutput)
            self.selectedFileDiff = (file: file, lines: lines)
        }
    }

    func clearDiff() {
        selectedFileDiff = nil
    }

    nonisolated static func diffFile(at repoPath: String, filePath: String, staged: Bool) -> String {
        var args = ["diff", "--no-color"]
        if staged { args.append("--staged") }
        args.append(contentsOf: ["--", filePath])
        return runGit(args, at: repoPath) ?? ""
    }

    // MARK: - Static Parsers

    nonisolated static func parseGitStatus(at path: String) -> (staged: [GitFileChange], unstaged: [GitFileChange], untracked: [GitFileChange]) {
        guard let output = runGit(["status", "--porcelain"], at: path) else {
            return ([], [], [])
        }

        var staged: [GitFileChange] = []
        var unstaged: [GitFileChange] = []
        var untracked: [GitFileChange] = []

        let lines = output.components(separatedBy: "\n")
        for line in lines {
            guard line.count >= 3 else { continue }

            let indexChar = line[line.startIndex]
            let workTreeChar = line[line.index(after: line.startIndex)]
            let rawPath = String(line.dropFirst(3))
            // Renamed/copied files show "old -> new"; use the new path for display and stage/unstage
            let filePath: String
            if rawPath.contains(" -> ") {
                filePath = String(rawPath.split(separator: " -> ", maxSplits: 1).last ?? Substring(rawPath))
            } else {
                filePath = rawPath
            }

            // Untracked files: "?? path"
            if indexChar == "?" && workTreeChar == "?" {
                untracked.append(GitFileChange(
                    path: filePath,
                    status: .untracked,
                    isStaged: false
                ))
                continue
            }

            // Staged changes (index column)
            if indexChar != " " && indexChar != "?" {
                if let status = parseStatusChar(indexChar) {
                    staged.append(GitFileChange(
                        path: filePath,
                        status: status,
                        isStaged: true
                    ))
                }
            }

            // Unstaged changes (work-tree column)
            if workTreeChar != " " && workTreeChar != "?" {
                if let status = parseStatusChar(workTreeChar) {
                    unstaged.append(GitFileChange(
                        path: filePath,
                        status: status,
                        isStaged: false
                    ))
                }
            }
        }

        return (staged, unstaged, untracked)
    }

    nonisolated static func parseGitLog(at path: String) -> [GitLogEntry] {
        guard let output = runGit(["log", "--format=%h|%s|%an|%ar", "-15"], at: path) else {
            return []
        }

        var entries: [GitLogEntry] = []
        let lines = output.components(separatedBy: "\n")
        for line in lines {
            guard !line.isEmpty else { continue }
            let parts = line.components(separatedBy: "|")
            guard parts.count >= 4 else { continue }

            entries.append(GitLogEntry(
                sha: parts[0],
                message: parts[1],
                author: parts[2],
                relativeDate: parts[3]
            ))
        }
        return entries
    }

    nonisolated static func getCurrentBranch(at path: String) -> String? {
        return runGit(["rev-parse", "--abbrev-ref", "HEAD"], at: path)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @discardableResult
    nonisolated static func runGit(_ arguments: [String], at path: String) -> String? {
        let process = Process()
        let pipe = Pipe()

        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = arguments
        process.currentDirectoryURL = URL(fileURLWithPath: path)
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()

            guard process.terminationStatus == 0 else { return nil }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8)
        } catch {
            return nil
        }
    }

    // MARK: - Private Helpers

    private nonisolated static func parseStatusChar(_ char: Character) -> GitFileStatus? {
        switch char {
        case "M": return .modified
        case "A": return .added
        case "D": return .deleted
        case "R": return .renamed
        case "C": return .copied
        default: return nil
        }
    }
}

import SwiftUI

/// Central registry of supported AI coding CLI tools.
/// Each case describes how to detect, display, and configure a specific CLI.
enum CLIProvider: String, CaseIterable, Codable, Identifiable, Hashable {
    case claude
    case gemini
    case codex
    case opencode

    var id: String { rawValue }

    // MARK: - Display

    var displayName: String {
        switch self {
        case .claude:   return "Claude Code"
        case .gemini:   return "Gemini CLI"
        case .codex:    return "Codex CLI"
        case .opencode: return "OpenCode"
        }
    }

    var iconName: String {
        switch self {
        case .claude:   return "c.circle.fill"
        case .gemini:   return "g.circle.fill"
        case .codex:    return "x.circle.fill"
        case .opencode: return "o.circle.fill"
        }
    }

    var color: Color {
        switch self {
        case .claude:   return .orange
        case .gemini:   return .blue
        case .codex:    return .green
        case .opencode: return .purple
        }
    }

    // MARK: - CLI Integration

    /// The shell command name used to invoke this CLI.
    var command: String {
        switch self {
        case .claude:   return "claude"
        case .gemini:   return "gemini"
        case .codex:    return "codex"
        case .opencode: return "opencode"
        }
    }

    /// The instruction file that this CLI reads from a project root.
    var instructionFileName: String {
        switch self {
        case .claude:   return "CLAUDE.md"
        case .gemini:   return "GEMINI.md"
        case .codex:    return "AGENTS.md"
        case .opencode: return "INSTRUCTIONS.md"
        }
    }

    /// Cached installation status. Call `CLIProvider.refreshInstallationStatus()` to update.
    private static var _installationCache: [CLIProvider: Bool] = [:]

    /// Whether the CLI binary is available on the system PATH (cached).
    /// Returns `false` until `refreshInstallationStatus()` has been called.
    var isInstalled: Bool {
        Self._installationCache[self] ?? false
    }

    /// Check installation status for all CLIs in the background.
    static func refreshInstallationStatus() async {
        await withTaskGroup(of: (CLIProvider, Bool).self) { group in
            for cli in CLIProvider.allCases {
                group.addTask {
                    let result = await Task.detached(priority: .utility) {
                        let process = Process()
                        let pipe = Pipe()
                        process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
                        process.arguments = [cli.command]
                        process.standardOutput = pipe
                        process.standardError = FileHandle.nullDevice
                        do {
                            try process.run()
                            process.waitUntilExit()
                            let data = pipe.fileHandleForReading.readDataToEndOfFile()
                            let path = String(data: data, encoding: .utf8)?
                                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                            return !path.isEmpty && process.terminationStatus == 0
                        } catch {
                            return false
                        }
                    }.value
                    return (cli, result)
                }
            }
            for await (cli, installed) in group {
                _installationCache[cli] = installed
            }
        }
    }

    // MARK: - MCP Configuration

    /// Describes where a CLI's MCP config file lives.
    enum ConfigScope {
        /// Relative to the project root directory (e.g. `.mcp.json`).
        case projectRoot(String)
        /// Relative to the user's home directory (e.g. `.gemini/settings.json`).
        case userHome(String)
    }

    /// The location of this CLI's MCP configuration file.
    var mcpConfigScope: ConfigScope {
        switch self {
        case .claude:   return .projectRoot(".mcp.json")
        case .gemini:   return .userHome(".gemini/settings.json")
        case .codex:    return .userHome(".codex/config.toml")
        case .opencode: return .projectRoot("opencode.json")
        }
    }

    /// Generates an MCP config snippet that registers the Context MCP server
    /// for this CLI, using the given binary path.
    ///
    /// - Parameter binaryPath: Absolute path to the ContextMCP binary.
    /// - Returns: A string in the CLI's native config format (JSON or TOML).
    func mcpConfigContent(binaryPath: String) -> String {
        switch self {
        case .claude:
            return """
            {
              "mcpServers": {
                "context-tasks": {
                  "command": "\(jsonEscaped(binaryPath))",
                  "args": []
                }
              }
            }
            """

        case .gemini:
            return """
            {
              "mcpServers": {
                "context-tasks": {
                  "command": "\(jsonEscaped(binaryPath))",
                  "args": []
                }
              }
            }
            """

        case .codex:
            return """
            [mcp_servers.context-tasks]
            command = "\(jsonEscaped(binaryPath))"
            args = []
            """

        case .opencode:
            return """
            {
              "mcp": {
                "context-tasks": {
                  "type": "local",
                  "command": ["\(jsonEscaped(binaryPath))"]
                }
              }
            }
            """
        }
    }

    /// Escape a string for safe embedding in JSON/TOML string literals.
    private func jsonEscaped(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
    }
}

import Foundation

// MARK: - Context Injector

/// Manages the integration surface between CodeFire and Claude Code.
/// Handles two responsibilities:
/// 1. Injecting/removing a managed section in a project's CLAUDE.md file
/// 2. Writing an MCP configuration file that Claude Code can reference
class ContextInjector {

    enum InjectorError: Error, LocalizedError {
        case projectPathMissing
        case fileOperationFailed(String)

        var errorDescription: String? {
            switch self {
            case .projectPathMissing: return "Project path is empty"
            case .fileOperationFailed(let msg): return "File operation failed: \(msg)"
            }
        }
    }

    /// Markers used to identify the CodeFire-managed section in CLAUDE.md
    static let sectionStart = "<!-- CodeFire managed section -->"
    static let sectionEnd = "<!-- End CodeFire section -->"

    /// The content injected between the markers
    private static let managedContent = """
    # CodeFire
    This project uses CodeFire for session memory.
    Use the `codefire` MCP tools to retrieve project history,
    active tasks, patterns, and codebase structure when needed.
    """

    private let db: DatabaseService
    private let fileManager: FileManager

    init(db: DatabaseService = .shared, fileManager: FileManager = .default) {
        self.db = db
        self.fileManager = fileManager
    }

    // MARK: - CLAUDE.md Management

    /// Add or update the CodeFire managed section in the project's CLAUDE.md.
    /// If CLAUDE.md exists, the managed section is found and replaced (or appended).
    /// If CLAUDE.md does not exist, a new file is created with just the managed section.
    func updateClaudeMD(for project: Project) throws {
        let projectPath = project.path
        guard !projectPath.isEmpty else {
            throw InjectorError.projectPathMissing
        }

        let claudeMDPath = (projectPath as NSString).appendingPathComponent("CLAUDE.md")
        let section = buildManagedSection()

        if fileManager.fileExists(atPath: claudeMDPath) {
            var content = try String(contentsOfFile: claudeMDPath, encoding: .utf8)

            if let range = findManagedSectionRange(in: content) {
                // Replace existing section
                content.replaceSubrange(range, with: section)
            } else {
                // Append section
                if !content.hasSuffix("\n") {
                    content += "\n"
                }
                content += "\n" + section + "\n"
            }

            try content.write(toFile: claudeMDPath, atomically: true, encoding: .utf8)
        } else {
            // Create new CLAUDE.md with just the managed section
            let content = section + "\n"
            try content.write(toFile: claudeMDPath, atomically: true, encoding: .utf8)
        }
    }

    /// Remove the CodeFire managed section from the project's CLAUDE.md.
    /// If the file becomes empty (or whitespace-only) after removal, delete it.
    func removeClaudeMDSection(for project: Project) throws {
        let projectPath = project.path
        guard !projectPath.isEmpty else {
            throw InjectorError.projectPathMissing
        }

        let claudeMDPath = (projectPath as NSString).appendingPathComponent("CLAUDE.md")

        guard fileManager.fileExists(atPath: claudeMDPath) else {
            return // Nothing to remove
        }

        var content = try String(contentsOfFile: claudeMDPath, encoding: .utf8)

        guard let range = findManagedSectionRange(in: content) else {
            return // Section not found, nothing to do
        }

        content.removeSubrange(range)

        // Clean up extra newlines left behind
        content = content
            .replacingOccurrences(of: "\n\n\n", with: "\n\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if content.isEmpty {
            try fileManager.removeItem(atPath: claudeMDPath)
        } else {
            try (content + "\n").write(toFile: claudeMDPath, atomically: true, encoding: .utf8)
        }
    }

    // MARK: - MCP Configuration

    /// Write the MCP configuration file that Claude Code can reference.
    /// Creates ~/Library/Application Support/CodeFire/mcp-config.json
    ///
    /// Note: The transport bridge (connecting this config to the in-process MCPServer)
    /// is a future enhancement. For now this writes the structural config.
    func configureMCPConnection() throws {
        let appSupportURL = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!.appendingPathComponent("CodeFire", isDirectory: true)

        try fileManager.createDirectory(
            at: appSupportURL,
            withIntermediateDirectories: true
        )

        let configPath = appSupportURL.appendingPathComponent("mcp-config.json")

        let config: [String: Any] = [
            "mcpServers": [
                "codefire": [
                    "command": "codefire-mcp-bridge",
                    "args": [] as [String],
                    "description": "CodeFire - Session memory and project intelligence for Claude Code"
                ]
            ]
        ]

        let data = try JSONSerialization.data(
            withJSONObject: config,
            options: [.prettyPrinted, .sortedKeys]
        )
        try data.write(to: configPath, options: .atomic)
    }

    // MARK: - Per-CLI MCP Installation

    /// The deployed CodeFireMCP binary path (space-free symlink for MCP clients).
    /// Falls back to the Application Support path if the symlink doesn't exist.
    static var mcpBinaryPath: String {
        let symlinkPath = (NSHomeDirectory() as NSString).appendingPathComponent(".local/bin/CodeFireMCP")
        if FileManager.default.fileExists(atPath: symlinkPath) {
            return symlinkPath
        }
        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask
        ).first!
        return appSupport
            .appendingPathComponent("CodeFire/bin/CodeFireMCP")
            .path
    }

    /// Install MCP config for a specific CLI provider.
    /// Merge-safe: parses existing config and only adds/updates the codefire entry.
    /// Returns the path where the config was written.
    func installMCP(for cli: CLIProvider, projectPath: String) throws -> String {
        let binaryPath = Self.mcpBinaryPath
        guard fileManager.fileExists(atPath: binaryPath) else {
            throw InjectorError.fileOperationFailed("CodeFireMCP binary not found at \(binaryPath)")
        }

        let configPath: String
        switch cli.mcpConfigScope {
        case .projectRoot(let filename):
            guard !projectPath.isEmpty else { throw InjectorError.projectPathMissing }
            configPath = (projectPath as NSString).appendingPathComponent(filename)
        case .userHome(let relativePath):
            configPath = (NSHomeDirectory() as NSString).appendingPathComponent(relativePath)
        }

        switch cli {
        case .claude:
            try installJSONMCP(at: configPath, topKey: "mcpServers", serverEntry: ["command": binaryPath])
        case .gemini:
            try installJSONMCP(at: configPath, topKey: "mcpServers", serverEntry: ["command": binaryPath])
        case .codex:
            try installCodexMCP(at: configPath, binaryPath: binaryPath)
        case .opencode:
            let entry: [String: Any] = ["type": "local", "command": [binaryPath]]
            try installJSONMCP(at: configPath, topKey: "mcp", serverEntry: entry)
        }

        return configPath
    }

    /// Install MCP config into a JSON file. Merges with existing content.
    private func installJSONMCP(at path: String, topKey: String, serverEntry: Any) throws {
        // Ensure parent directory exists
        let dir = (path as NSString).deletingLastPathComponent
        try fileManager.createDirectory(atPath: dir, withIntermediateDirectories: true)

        var config = readJSONDict(at: path)
        var servers = config[topKey] as? [String: Any] ?? [:]
        servers["codefire"] = serverEntry
        config[topKey] = servers
        try writeJSON(config, to: path)
    }

    /// Install MCP config into Codex's TOML config file. Merge-safe.
    private func installCodexMCP(at path: String, binaryPath: String) throws {
        let dir = (path as NSString).deletingLastPathComponent
        try fileManager.createDirectory(atPath: dir, withIntermediateDirectories: true)

        let escapedPath = binaryPath
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")

        let section = """

        [mcp_servers.codefire]
        command = "\(escapedPath)"
        args = []
        """

        if fileManager.fileExists(atPath: path) {
            var content = try String(contentsOfFile: path, encoding: .utf8)
            // Remove existing codefire section if present
            let pattern = #"\[mcp_servers\.codefire\][^\[]*"#
            if let regex = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]) {
                content = regex.stringByReplacingMatches(
                    in: content,
                    range: NSRange(content.startIndex..., in: content),
                    withTemplate: ""
                )
            }
            content = content.trimmingCharacters(in: .whitespacesAndNewlines)
            content += "\n" + section + "\n"
            try content.write(toFile: path, atomically: true, encoding: .utf8)
        } else {
            try (section.trimmingCharacters(in: .newlines) + "\n")
                .write(toFile: path, atomically: true, encoding: .utf8)
        }
    }

    // MARK: - MCP Config Detection

    /// Check if the codefire MCP server is configured for a given CLI.
    func isMCPConfigured(for cli: CLIProvider, projectPath: String) -> Bool {
        let configPath: String
        switch cli.mcpConfigScope {
        case .projectRoot(let filename):
            guard !projectPath.isEmpty else { return false }
            configPath = (projectPath as NSString).appendingPathComponent(filename)
        case .userHome(let relativePath):
            configPath = (NSHomeDirectory() as NSString).appendingPathComponent(relativePath)
        }

        switch cli {
        case .claude, .gemini:
            let dict = readJSONDict(at: configPath)
            let servers = dict["mcpServers"] as? [String: Any] ?? [:]
            return servers["codefire"] != nil
        case .opencode:
            let dict = readJSONDict(at: configPath)
            let servers = dict["mcp"] as? [String: Any] ?? [:]
            return servers["codefire"] != nil
        case .codex:
            guard fileManager.fileExists(atPath: configPath),
                  let content = try? String(contentsOfFile: configPath, encoding: .utf8)
            else { return false }
            return content.contains("[mcp_servers.codefire]")
        }
    }

    /// Returns the best CLI to suggest for MCP setup, or nil if all installed CLIs are already configured.
    /// Priority: preferred CLI (if set & installed) → first installed unconfigured CLI.
    func suggestedCLIForSetup(projectPath: String, preferred: CLIProvider) -> CLIProvider? {
        // Check preferred CLI first
        if preferred.isInstalled && !isMCPConfigured(for: preferred, projectPath: projectPath) {
            return preferred
        }
        // Fall back to first installed but unconfigured CLI
        let priority: [CLIProvider] = [.claude, .gemini, .codex, .opencode]
        return priority.first { cli in
            cli.isInstalled && !isMCPConfigured(for: cli, projectPath: projectPath)
        }
    }

    /// Returns all installed CLIs that don't have codefire configured.
    func unconfiguredCLIs(projectPath: String) -> [CLIProvider] {
        CLIProvider.allCases.filter { cli in
            cli.isInstalled && !isMCPConfigured(for: cli, projectPath: projectPath)
        }
    }

    // MARK: - JSON Helpers

    private func readJSONDict(at path: String) -> [String: Any] {
        guard fileManager.fileExists(atPath: path),
              let data = fileManager.contents(atPath: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return [:]
        }
        return json
    }

    private func writeJSON(_ dict: [String: Any], to path: String) throws {
        let data = try JSONSerialization.data(
            withJSONObject: dict,
            options: [.prettyPrinted, .sortedKeys]
        )
        try data.write(to: URL(fileURLWithPath: path), options: .atomic)
    }

    // MARK: - Per-CLI Instruction File Management

    /// Write the CodeFire managed section to the appropriate instruction file for this CLI.
    func updateInstructionFile(for cli: CLIProvider, projectPath: String) throws {
        guard !projectPath.isEmpty else { throw InjectorError.projectPathMissing }

        let filePath = (projectPath as NSString)
            .appendingPathComponent(cli.instructionFileName)
        let section = buildManagedSection()

        if fileManager.fileExists(atPath: filePath) {
            var content = try String(contentsOfFile: filePath, encoding: .utf8)
            if let range = findManagedSectionRange(in: content) {
                content.replaceSubrange(range, with: section)
            } else {
                if !content.hasSuffix("\n") { content += "\n" }
                content += "\n" + section + "\n"
            }
            try content.write(toFile: filePath, atomically: true, encoding: .utf8)
        } else {
            try (section + "\n").write(toFile: filePath, atomically: true, encoding: .utf8)
        }
    }

    /// Check if the managed section exists in this CLI's instruction file.
    func hasInstructionFile(for cli: CLIProvider, projectPath: String) -> Bool {
        guard !projectPath.isEmpty else { return false }
        let filePath = (projectPath as NSString)
            .appendingPathComponent(cli.instructionFileName)
        guard fileManager.fileExists(atPath: filePath),
              let content = try? String(contentsOfFile: filePath, encoding: .utf8)
        else { return false }
        return findManagedSectionRange(in: content) != nil
    }

    // MARK: - Helpers

    /// Build the full managed section string including markers.
    private func buildManagedSection() -> String {
        return [
            Self.sectionStart,
            Self.managedContent,
            Self.sectionEnd
        ].joined(separator: "\n")
    }

    /// Find the range of the managed section (including markers) within a string.
    /// Returns nil if the section markers are not found.
    private func findManagedSectionRange(in content: String) -> Range<String.Index>? {
        guard let startRange = content.range(of: Self.sectionStart),
              let endRange = content.range(of: Self.sectionEnd)
        else {
            return nil
        }

        // Include the full range from start of opening marker to end of closing marker
        return startRange.lowerBound ..< endRange.upperBound
    }
}

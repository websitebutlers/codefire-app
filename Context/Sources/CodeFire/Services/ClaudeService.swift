import Foundation

/// Shells out to the `claude` CLI in print mode (`-p`) to generate AI-powered
/// content using the user's existing Max plan authentication.
@MainActor
class ClaudeService: ObservableObject {
    @Published var isGenerating = false
    @Published var lastError: String?

    nonisolated(unsafe) private static var cachedClaudePath: String?

    // MARK: - Session Summary

    /// Generate an intelligent summary of a Claude Code session by reading
    /// its JSONL file and sending condensed conversation context to Claude.
    func generateSessionSummary(
        sessionId: String,
        claudeProjectPath: String
    ) async -> String? {
        let jsonlPath = (claudeProjectPath as NSString)
            .appendingPathComponent("\(sessionId).jsonl")

        guard let condensed = Self.extractConversation(from: jsonlPath) else {
            lastError = "Could not read session file"
            return nil
        }

        let prompt = """
        Summarize this Claude Code session concisely in 2-4 sentences. Include:
        - What was the main goal/task
        - What was accomplished
        - Key decisions made
        - Any unfinished work or follow-ups

        Be direct and specific. Don't use filler phrases.

        Session conversation:
        \(condensed)
        """

        return await generate(prompt: prompt)
    }

    // MARK: - CLAUDE.md Generation

    /// Generate a CLAUDE.md file from project analysis data (architecture,
    /// schema, file tree, project type).
    func generateClaudeMd(
        projectPath: String,
        projectType: String,
        fileTree: [String],
        archSummary: String,
        schemaSummary: String,
        scope: String
    ) async -> String? {
        var context = """
        Generate a CLAUDE.md file for a \(scope)-level scope.

        Project analysis:
        - Type: \(projectType)
        - Path: \(projectPath)

        """

        if !fileTree.isEmpty {
            context += "Key files and directories:\n"
            for file in fileTree.prefix(60) {
                context += "  \(file)\n"
            }
            context += "\n"
        }

        if !archSummary.isEmpty {
            context += "Architecture:\n\(archSummary)\n\n"
        }

        if !schemaSummary.isEmpty {
            context += "Database schema:\n\(schemaSummary)\n\n"
        }

        let scopeGuidance = scope == "project"
            ? "This file is committed to the repo and shared with the team."
            : scope == "local"
                ? "This file is local/personal and gitignored."
                : "This file applies to all projects globally."

        context += """
        Generate practical CLAUDE.md content covering:
        1. Project overview (what it is, key technologies)
        2. Architecture notes (how the code is organized)
        3. Key conventions detected (naming, patterns, file organization)
        4. Important file locations
        5. Build and test commands

        \(scopeGuidance)
        Use markdown format. Be concise and actionable.
        Don't include generic advice — be specific to THIS project based on the analysis above.
        Start with a # heading.
        """

        return await generate(prompt: context)
    }

    // MARK: - Task Enrichment

    /// Enrich a task's description using AI. Given a title and optional existing
    /// description, returns a richer description with approach, relevant files, steps.
    func enrichTask(title: String, currentDescription: String) async -> String? {
        var prompt = """
        You are helping enrich a development task. Given the task title and any existing description,
        generate a clear, actionable task description that includes:
        - A concise summary of what needs to be done
        - Suggested approach or implementation steps (numbered)
        - Potential edge cases or considerations

        Keep it practical and concise (under 300 words). Use plain text, no markdown headers.

        Task title: \(title)
        """

        if !currentDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            prompt += "\n\nExisting description:\n\(currentDescription)"
            prompt += "\n\nExpand and improve the existing description. Keep what's useful, add missing details."
        }

        return await generate(prompt: prompt)
    }

    // MARK: - Chat (OpenRouter)

    /// Multi-turn chat via OpenRouter API with assembled project context.
    func chat(
        messages: [(role: String, content: String)],
        context: String
    ) async -> String? {
        isGenerating = true
        lastError = nil
        defer { isGenerating = false }

        guard let apiKey = Self.openRouterAPIKey, !apiKey.isEmpty else {
            lastError = "OpenRouter API key not configured. Tap the gear icon to set it up."
            return nil
        }

        // Build chat messages array for OpenRouter
        var chatMessages: [[String: String]] = [
            [
                "role": "system",
                "content": """
                \(context)

                Respond helpfully and concisely. Reference specific tasks, sessions, files, or notes when relevant. Use markdown formatting.
                """
            ]
        ]

        // Add conversation history (cap at ~25K chars)
        var historyChars = 0
        let maxHistory = 25_000
        for msg in messages {
            if historyChars + msg.content.count > maxHistory { break }
            chatMessages.append(["role": msg.role, "content": msg.content])
            historyChars += msg.content.count
        }

        let model = Self.openRouterModel
        let result = await Task.detached {
            Self.callOpenRouter(apiKey: apiKey, messages: chatMessages, model: model)
        }.value

        if let error = result.error {
            lastError = error
            return nil
        }
        return result.response
    }

    // MARK: - OpenRouter Settings

    static var openRouterAPIKey: String? {
        get { UserDefaults.standard.string(forKey: "openRouterAPIKey") }
        set { UserDefaults.standard.set(newValue, forKey: "openRouterAPIKey") }
    }

    static var openRouterModel: String {
        get { UserDefaults.standard.string(forKey: "openRouterModel") ?? "google/gemini-3.1-pro-preview" }
        set { UserDefaults.standard.set(newValue, forKey: "openRouterModel") }
    }

    // MARK: - OpenRouter HTTP Call

    private nonisolated static func callOpenRouter(
        apiKey: String,
        messages: [[String: String]],
        model: String
    ) -> (response: String?, error: String?) {
        let url = URL(string: "https://openrouter.ai/api/v1/chat/completions")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("CodeFire", forHTTPHeaderField: "X-Title")
        request.timeoutInterval = 60

        let body: [String: Any] = [
            "model": model,
            "messages": messages,
            "max_tokens": 4096
        ]

        guard let bodyData = try? JSONSerialization.data(withJSONObject: body) else {
            return (nil, "Failed to encode request")
        }
        request.httpBody = bodyData

        var result: (String?, String?) = (nil, nil)
        let semaphore = DispatchSemaphore(value: 0)

        URLSession.shared.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }

            if let error = error {
                result = (nil, error.localizedDescription)
                return
            }

            guard let data = data else {
                result = (nil, "No data received")
                return
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                let raw = String(data: data, encoding: .utf8) ?? "Unknown"
                result = (nil, "Invalid response: \(String(raw.prefix(200)))")
                return
            }

            // Check for API errors
            if let error = json["error"] as? [String: Any],
               let message = error["message"] as? String {
                result = (nil, message)
                return
            }

            // Extract the assistant's response
            if let choices = json["choices"] as? [[String: Any]],
               let first = choices.first,
               let message = first["message"] as? [String: Any],
               let content = message["content"] as? String {
                result = (content.trimmingCharacters(in: .whitespacesAndNewlines), nil)
            } else {
                result = (nil, "Unexpected response format")
            }
        }.resume()

        semaphore.wait()
        return result
    }

    // MARK: - Extract Tasks from Session

    /// Read a session's JSONL conversation and extract actionable tasks using AI.
    /// Returns an array of (title, description, priority) tuples parsed from Claude's response.
    func extractTasksFromSession(
        sessionId: String,
        claudeProjectPath: String
    ) async -> [(title: String, description: String?, priority: Int)]? {
        let jsonlPath = (claudeProjectPath as NSString)
            .appendingPathComponent("\(sessionId).jsonl")

        guard let condensed = Self.extractConversation(from: jsonlPath) else {
            lastError = "Could not read session file"
            return nil
        }

        let prompt = """
        Analyze this Claude Code session and extract actionable follow-up tasks, TODOs,
        or unfinished work mentioned in the conversation. Look for:
        - Explicit TODOs or follow-ups mentioned
        - Bugs discovered but not fixed
        - Features discussed but not implemented
        - Improvements or refactors suggested
        - Tests that should be written

        Return ONLY a JSON array with no other text. Each item should have:
        - "title": short task title (under 80 chars)
        - "description": brief description of what to do
        - "priority": 0 (none), 1 (low), 2 (medium), 3 (high), 4 (urgent)

        If no tasks found, return an empty array: []

        Session conversation:
        \(condensed)
        """

        guard let raw = await generate(prompt: prompt) else { return nil }

        // Parse the JSON response
        // Strip markdown code fences if present
        var jsonStr = raw
        if jsonStr.hasPrefix("```") {
            let lines = jsonStr.components(separatedBy: "\n")
            let filtered = lines.filter { !$0.hasPrefix("```") }
            jsonStr = filtered.joined(separator: "\n")
        }

        guard let data = jsonStr.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else {
            lastError = "Could not parse AI response as JSON"
            return nil
        }

        return array.compactMap { item in
            guard let title = item["title"] as? String, !title.isEmpty else { return nil }
            let desc = item["description"] as? String
            let priority = item["priority"] as? Int ?? 0
            return (title: title, description: desc, priority: min(max(priority, 0), 4))
        }
    }

    // MARK: - Recording Task Extraction

    func extractTasksFromRecording(
        transcript: String
    ) async -> [(title: String, description: String?, priority: Int)]? {
        let prompt = """
        Analyze this meeting transcript and extract actionable tasks, decisions, and follow-ups.
        Look for:
        - Action items assigned to people
        - Decisions that require follow-up work
        - Problems discussed that need fixing
        - Ideas or features mentioned for implementation
        - Deadlines or time-sensitive items

        Return ONLY a JSON array with no other text. Each item should have:
        - "title": short task title (under 80 chars)
        - "description": brief description of what needs to be done
        - "priority": 0 (none), 1 (low), 2 (medium), 3 (high), 4 (urgent)

        If no tasks found, return an empty array: []

        Meeting transcript:
        \(transcript)
        """

        guard let raw = await generate(prompt: prompt) else { return nil }

        // Parse the JSON response — strip markdown code fences if present
        var jsonStr = raw
        if jsonStr.hasPrefix("```") {
            let lines = jsonStr.components(separatedBy: "\n")
            let filtered = lines.filter { !$0.hasPrefix("```") }
            jsonStr = filtered.joined(separator: "\n")
        }

        guard let data = jsonStr.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else {
            lastError = "Could not parse AI response as JSON"
            return nil
        }

        return array.compactMap { item in
            guard let title = item["title"] as? String, !title.isEmpty else { return nil }
            let desc = item["description"] as? String
            let priority = item["priority"] as? Int ?? 0
            return (title: title, description: desc, priority: min(max(priority, 0), 4))
        }
    }

    // MARK: - Core Execution

    private func generate(prompt: String) async -> String? {
        isGenerating = true
        lastError = nil
        defer { isGenerating = false }

        let result = await Task.detached {
            Self.callClaude(prompt: prompt)
        }.value

        if result == nil && lastError == nil {
            lastError = "Failed to generate. Is the Claude Code CLI installed?"
        }

        return result
    }

    // MARK: - Process (off main actor)

    private nonisolated static func callClaude(prompt: String) -> String? {
        guard let claudePath = findClaudeBinary() else { return nil }

        let process = Process()
        let outputPipe = Pipe()
        let inputPipe = Pipe()

        process.executableURL = URL(fileURLWithPath: claudePath)
        process.arguments = ["-p", "--output-format", "text"]
        process.standardOutput = outputPipe
        process.standardError = FileHandle.nullDevice
        process.standardInput = inputPipe

        // Inherit environment for Max plan auth
        process.environment = ProcessInfo.processInfo.environment

        guard let promptData = prompt.data(using: .utf8) else { return nil }
        inputPipe.fileHandleForWriting.write(promptData)
        inputPipe.fileHandleForWriting.closeFile()

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return nil
        }

        guard process.terminationStatus == 0 else { return nil }

        let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Binary Discovery

    private nonisolated static func findClaudeBinary() -> String? {
        if let cached = cachedClaudePath { return cached }

        let fm = FileManager.default
        let home = NSHomeDirectory()

        let candidates = [
            "/usr/local/bin/claude",
            "/opt/homebrew/bin/claude",
            "\(home)/.npm/bin/claude",
            "\(home)/.local/bin/claude",
            "\(home)/.nvm/current/bin/claude",
        ]

        for path in candidates {
            if fm.fileExists(atPath: path) {
                cachedClaudePath = path
                return path
            }
        }

        // Fallback: `which claude`
        let which = Process()
        let pipe = Pipe()
        which.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        which.arguments = ["claude"]
        which.standardOutput = pipe
        which.standardError = FileHandle.nullDevice
        which.environment = ProcessInfo.processInfo.environment

        do {
            try which.run()
            which.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            if let path = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               !path.isEmpty, fm.fileExists(atPath: path) {
                cachedClaudePath = path
                return path
            }
        } catch {}

        return nil
    }

    // MARK: - Conversation Extraction

    /// Extract a condensed version of a session's conversation from its JSONL file.
    /// Includes user messages, assistant text, and tool names — skipping tool results.
    /// Truncates individual messages and caps total output at ~30K characters.
    private nonisolated static func extractConversation(from jsonlPath: String) -> String? {
        guard let data = FileManager.default.contents(atPath: jsonlPath),
              let content = String(data: data, encoding: .utf8)
        else { return nil }

        let lines = content.components(separatedBy: .newlines)
        var parts: [String] = []
        var totalChars = 0
        let maxChars = 30_000

        for line in lines {
            guard totalChars < maxChars else { break }

            guard let lineData = line.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                  let type = json["type"] as? String
            else { continue }

            if type == "user" {
                if let message = json["message"] as? [String: Any] {
                    if let contentArray = message["content"] as? [[String: Any]] {
                        for block in contentArray {
                            if block["type"] as? String == "text",
                               let text = block["text"] as? String {
                                let truncated = String(text.prefix(500))
                                parts.append("[User]: \(truncated)")
                                totalChars += truncated.count + 8
                            }
                        }
                    } else if let text = message["content"] as? String {
                        let truncated = String(text.prefix(500))
                        parts.append("[User]: \(truncated)")
                        totalChars += truncated.count + 8
                    }
                }
            } else if type == "assistant" {
                if let message = json["message"] as? [String: Any],
                   let contentArray = message["content"] as? [[String: Any]] {
                    for block in contentArray {
                        if block["type"] as? String == "text",
                           let text = block["text"] as? String {
                            let truncated = String(text.prefix(800))
                            parts.append("[Assistant]: \(truncated)")
                            totalChars += truncated.count + 13
                        } else if block["type"] as? String == "tool_use",
                                  let name = block["name"] as? String {
                            parts.append("[Tool: \(name)]")
                            totalChars += name.count + 10
                        }
                    }
                }
            }
        }

        return parts.isEmpty ? nil : parts.joined(separator: "\n")
    }

    // MARK: - Save Summary

    /// Save an AI-generated summary back to the session record in the database.
    nonisolated static func saveSummary(_ summary: String, sessionId: String) {
        do {
            try DatabaseService.shared.dbQueue.write { db in
                try db.execute(
                    sql: "UPDATE sessions SET summary = ? WHERE id = ?",
                    arguments: [summary, sessionId]
                )
            }
        } catch {
            print("ClaudeService: failed to save summary: \(error)")
        }
    }
}

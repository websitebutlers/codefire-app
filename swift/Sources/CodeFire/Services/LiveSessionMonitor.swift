import Foundation
import SwiftUI

// MARK: - Data Models

struct ToolCount: Identifiable {
    let name: String
    var count: Int
    var id: String { name }
}

struct ActivityItem: Identifiable {
    let id = UUID()
    let timestamp: Date
    let type: ActivityType
    let detail: String

    enum ActivityType {
        case userMessage
        case assistantText
        case toolUse(String)
    }
}

struct LiveSessionState {
    var sessionId: String?
    var slug: String?
    var model: String?
    var gitBranch: String?
    var startedAt: Date?
    var lastActivity: Date?

    // Token tracking (cumulative across all assistant messages)
    var totalInputTokens: Int = 0
    var totalOutputTokens: Int = 0
    var cacheCreationTokens: Int = 0
    var cacheReadTokens: Int = 0

    // Latest context window usage (from most recent assistant message)
    var latestContextTokens: Int = 0

    // Activity
    var messageCount: Int = 0
    var userMessageCount: Int = 0
    var toolUseCount: Int = 0
    var filesChanged: [String] = []
    var toolCounts: [ToolCount] = []
    var recentActivity: [ActivityItem] = []

    var isActive: Bool { sessionId != nil }
    var contextLimit: Int { 200_000 }

    var contextUsagePercent: Double {
        guard contextLimit > 0 else { return 0 }
        return min(1.0, Double(latestContextTokens) / Double(contextLimit))
    }

    /// Estimated session cost in USD based on model pricing.
    var estimatedCost: Double {
        SessionCost.calculate(
            model: model,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            cacheCreationTokens: cacheCreationTokens,
            cacheReadTokens: cacheReadTokens
        )
    }

    var elapsedFormatted: String {
        guard let start = startedAt else { return "" }
        let elapsed = Date().timeIntervalSince(start)
        if elapsed < 60 { return "just now" }
        let minutes = Int(elapsed / 60)
        if minutes < 60 { return "\(minutes) min ago" }
        let hours = minutes / 60
        return "\(hours)h \(minutes % 60)m ago"
    }

    var contextFormatted: String {
        let k = Double(latestContextTokens) / 1000.0
        if k < 1 { return "\(latestContextTokens)" }
        return String(format: "%.0fk", k)
    }
}

// MARK: - Monitor

/// Watches the active Claude Code session JSONL file and publishes live state.
///
/// Polls the file every 2 seconds, reading only new bytes since the last read.
/// This makes monitoring lightweight even for large session files.
@MainActor
class LiveSessionMonitor: ObservableObject {
    @Published var state = LiveSessionState()

    private var pollTimer: Timer?
    private var activeFileURL: URL?
    private var lastReadOffset: UInt64 = 0
    private var claudeProjectPath: String?

    /// Seconds of inactivity before we consider a session ended.
    private let inactivityThreshold: TimeInterval = 120

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    func startMonitoring(claudeProjectPath: String) {
        stopMonitoring()
        self.claudeProjectPath = claudeProjectPath

        findActiveSession()

        pollTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.poll()
            }
        }
    }

    func stopMonitoring() {
        pollTimer?.invalidate()
        pollTimer = nil
        activeFileURL = nil
        lastReadOffset = 0
        claudeProjectPath = nil
        state = LiveSessionState()
    }

    /// Pause polling without losing state. Used when the project window loses focus.
    func pauseMonitoring() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    /// Resume polling after a pause. Re-creates the timer if we have a path to watch.
    func resumeMonitoring() {
        guard pollTimer == nil, claudeProjectPath != nil else { return }
        poll()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.poll()
            }
        }
    }

    // MARK: - Polling

    private func poll() {
        guard let url = activeFileURL else {
            findActiveSession()
            return
        }

        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path) else { return }
        let currentSize = (attrs[.size] as? UInt64) ?? 0

        // Check if file is still being written to
        if let modDate = attrs[.modificationDate] as? Date,
           Date().timeIntervalSince(modDate) > inactivityThreshold {
            // Session may have ended. Check for a newer file.
            findActiveSession()
            return
        }

        if currentSize > lastReadOffset {
            readNewContent(from: url)
        }
    }

    private func findActiveSession() {
        guard let path = claudeProjectPath else { return }
        let dir = URL(fileURLWithPath: path)

        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return }

        let candidates = contents
            .filter { $0.pathExtension == "jsonl" }
            .compactMap { url -> (URL, Date)? in
                guard let vals = try? url.resourceValues(forKeys: [.contentModificationDateKey]),
                      let date = vals.contentModificationDate else { return nil }
                return (url, date)
            }
            .sorted { $0.1 > $1.1 }

        guard let (mostRecent, modDate) = candidates.first else {
            if activeFileURL != nil {
                activeFileURL = nil
                state = LiveSessionState()
            }
            return
        }

        let isActive = Date().timeIntervalSince(modDate) < inactivityThreshold

        if isActive && mostRecent != activeFileURL {
            // Switch to a new active session.
            activeFileURL = mostRecent
            lastReadOffset = 0
            state = LiveSessionState()
            readNewContent(from: mostRecent)
        } else if !isActive && activeFileURL != nil {
            let endedState = state
            activeFileURL = nil
            state = LiveSessionState()

            // Post session-ended notification for auto-share prompt
            if let sessionId = endedState.sessionId {
                NotificationCenter.default.post(
                    name: .sessionDidEnd,
                    object: nil,
                    userInfo: [
                        "sessionId": sessionId,
                        "slug": endedState.slug as Any,
                        "model": endedState.model as Any,
                        "gitBranch": endedState.gitBranch as Any,
                        "filesChanged": endedState.filesChanged,
                        "startedAt": endedState.startedAt as Any,
                        "durationMins": endedState.startedAt.map { Int(Date().timeIntervalSince($0) / 60) } as Any,
                    ]
                )
            }
        }
    }

    // MARK: - Incremental Reading

    private func readNewContent(from url: URL) {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return }
        defer { try? handle.close() }

        handle.seek(toFileOffset: lastReadOffset)
        let newData = handle.readDataToEndOfFile()
        lastReadOffset = handle.offsetInFile

        guard !newData.isEmpty,
              let text = String(data: newData, encoding: .utf8) else { return }

        let lines = text.components(separatedBy: .newlines).filter { !$0.isEmpty }

        for line in lines {
            processLine(line)
        }
    }

    // MARK: - Line Processing

    private func processLine(_ line: String) {
        guard let data = line.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }

        // -- Metadata (can appear on any line type) --
        if let sid = json["sessionId"] as? String { state.sessionId = sid }
        if let s   = json["slug"]      as? String { state.slug = s }
        if let b   = json["gitBranch"] as? String { state.gitBranch = b }

        var timestamp: Date?
        if let ts = json["timestamp"] as? String {
            timestamp = Self.isoFormatter.date(from: ts)
            if state.startedAt == nil { state.startedAt = timestamp }
            state.lastActivity = timestamp
        }

        let type = json["type"] as? String

        // -- User message --
        if type == "user" {
            state.messageCount += 1
            state.userMessageCount += 1

            if let message = json["message"] as? [String: Any] {
                let text = extractText(from: message)
                if !text.isEmpty {
                    addActivity(timestamp: timestamp, type: .userMessage, detail: String(text.prefix(120)))
                }
            }
        }

        // -- Assistant message --
        if type == "assistant" {
            state.messageCount += 1

            guard let message = json["message"] as? [String: Any] else { return }

            // Model
            if let m = message["model"] as? String { state.model = m }

            // Token usage
            if let usage = message["usage"] as? [String: Any] {
                let input         = usage["input_tokens"]                  as? Int ?? 0
                let output        = usage["output_tokens"]                 as? Int ?? 0
                let cacheCreation = usage["cache_creation_input_tokens"]   as? Int ?? 0
                let cacheRead     = usage["cache_read_input_tokens"]       as? Int ?? 0

                state.totalInputTokens    += input
                state.totalOutputTokens   += output
                state.cacheCreationTokens += cacheCreation
                state.cacheReadTokens     += cacheRead
                state.latestContextTokens  = input + cacheCreation + cacheRead
            }

            // Content blocks (tool_use and text)
            guard let content = message["content"] as? [[String: Any]] else { return }

            for block in content {
                let blockType = block["type"] as? String

                if blockType == "tool_use" {
                    state.toolUseCount += 1
                    let toolName = block["name"] as? String ?? "unknown"
                    recordToolUse(toolName)

                    // File path extraction
                    var detail = toolName
                    if let input = block["input"] as? [String: Any],
                       let filePath = input["file_path"] as? String {
                        if state.filesChanged.count < 500, !state.filesChanged.contains(filePath) {
                            state.filesChanged.append(filePath)
                        }
                        let filename = (filePath as NSString).lastPathComponent
                        detail = "\(toolName)  \(filename)"
                    }
                    // Command extraction for Bash
                    if let input = block["input"] as? [String: Any],
                       let command = input["command"] as? String {
                        let short = String(command.prefix(60))
                        detail = "\(toolName)  \(short)"
                    }

                    addActivity(timestamp: timestamp, type: .toolUse(toolName), detail: detail)
                }

                if blockType == "text", let text = block["text"] as? String {
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty {
                        addActivity(timestamp: timestamp, type: .assistantText, detail: String(trimmed.prefix(120)))
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private func extractText(from message: [String: Any]) -> String {
        if let s = message["content"] as? String { return s }
        if let arr = message["content"] as? [[String: Any]] {
            for block in arr {
                if block["type"] as? String == "text",
                   let t = block["text"] as? String { return t }
            }
        }
        return ""
    }

    private func recordToolUse(_ name: String) {
        if let idx = state.toolCounts.firstIndex(where: { $0.name == name }) {
            state.toolCounts[idx].count += 1
        } else {
            state.toolCounts.append(ToolCount(name: name, count: 1))
        }
        state.toolCounts.sort { $0.count > $1.count }
    }

    private func addActivity(timestamp: Date?, type: ActivityItem.ActivityType, detail: String) {
        let item = ActivityItem(timestamp: timestamp ?? Date(), type: type, detail: detail)
        state.recentActivity.insert(item, at: 0)
        if state.recentActivity.count > 50 {
            state.recentActivity = Array(state.recentActivity.prefix(50))
        }
    }
}

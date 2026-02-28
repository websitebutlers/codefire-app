import Foundation
import GRDB
import SwiftUI

// Named TaskItem to avoid conflict with Swift's Task
struct TaskItem: Codable, Identifiable, FetchableRecord, MutablePersistableRecord {
    var id: Int64?
    var projectId: String
    var title: String
    var description: String?
    var status: String // "todo", "in_progress", "done"
    var priority: Int
    var sourceSession: String?
    var source: String // "claude", "manual", "ai-extracted"
    var createdAt: Date
    var completedAt: Date?
    var labels: String? // JSON array
    var attachments: String? // JSON array of file paths
    var isGlobal: Bool = false
    var gmailThreadId: String?
    var gmailMessageId: String?
    var recordingId: String?

    static let databaseTableName = "taskItems"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }

    // MARK: - Priority

    enum Priority: Int, CaseIterable {
        case none = 0
        case low = 1
        case medium = 2
        case high = 3
        case urgent = 4

        var label: String {
            switch self {
            case .none:   return "None"
            case .low:    return "Low"
            case .medium: return "Medium"
            case .high:   return "High"
            case .urgent: return "Urgent"
            }
        }

        var color: Color {
            switch self {
            case .none:   return .secondary
            case .low:    return .blue
            case .medium: return .yellow
            case .high:   return .orange
            case .urgent: return .red
            }
        }

        var icon: String {
            switch self {
            case .none:   return "minus"
            case .low:    return "arrow.down"
            case .medium: return "equal"
            case .high:   return "arrow.up"
            case .urgent: return "exclamationmark.2"
            }
        }
    }

    var priorityLevel: Priority {
        Priority(rawValue: priority) ?? .none
    }

    // MARK: - Labels

    static let predefinedLabels = ["bug", "feature", "refactor", "test", "docs", "performance", "security", "design", "email", "calendar"]

    var labelsArray: [String] {
        guard let json = labels,
              let data = json.data(using: .utf8),
              let array = try? JSONDecoder().decode([String].self, from: data)
        else { return [] }
        return array
    }

    mutating func setLabels(_ newLabels: [String]) {
        if newLabels.isEmpty {
            labels = nil
        } else if let data = try? JSONEncoder().encode(newLabels),
                  let str = String(data: data, encoding: .utf8) {
            labels = str
        }
    }

    // MARK: - Attachments

    var attachmentsArray: [String] {
        guard let json = attachments,
              let data = json.data(using: .utf8),
              let array = try? JSONDecoder().decode([String].self, from: data)
        else { return [] }
        return array
    }

    mutating func setAttachments(_ paths: [String]) {
        if paths.isEmpty {
            attachments = nil
        } else if let data = try? JSONEncoder().encode(paths),
                  let str = String(data: data, encoding: .utf8) {
            attachments = str
        }
    }

    mutating func addAttachment(_ path: String) {
        var current = attachmentsArray
        guard !current.contains(path) else { return }
        current.append(path)
        setAttachments(current)
    }

    mutating func removeAttachment(_ path: String) {
        var current = attachmentsArray
        current.removeAll { $0 == path }
        setAttachments(current)
    }

    // MARK: - Label Colors

    static func labelColor(for label: String) -> Color {
        switch label {
        case "bug":         return .red
        case "feature":     return .blue
        case "refactor":    return .purple
        case "test":        return .green
        case "docs":        return .mint
        case "performance": return .orange
        case "security":    return .pink
        case "design":      return .cyan
        case "email":       return .green
        case "calendar":    return .indigo
        default:            return .secondary
        }
    }
}

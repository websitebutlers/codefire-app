import Foundation

// MARK: - Premium User

struct PremiumUser: Codable, Identifiable, Sendable {
    let id: String
    let email: String
    let displayName: String
    let avatarUrl: String?

    enum CodingKeys: String, CodingKey {
        case id, email
        case displayName = "display_name"
        case avatarUrl = "avatar_url"
    }
}

// MARK: - Team

struct Team: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let slug: String
    let ownerId: String
    let stripeCustomerId: String?
    let stripeSubscriptionId: String?
    let plan: String  // "starter" | "agency"
    let seatLimit: Int
    let projectLimit: Int?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, slug, plan
        case ownerId = "owner_id"
        case stripeCustomerId = "stripe_customer_id"
        case stripeSubscriptionId = "stripe_subscription_id"
        case seatLimit = "seat_limit"
        case projectLimit = "project_limit"
        case createdAt = "created_at"
    }
}

// MARK: - Team Member

struct TeamMember: Codable, Sendable {
    let teamId: String
    let userId: String
    let role: String  // "owner" | "admin" | "member"
    let joinedAt: String
    let user: PremiumUser?

    enum CodingKeys: String, CodingKey {
        case user
        case teamId = "team_id"
        case userId = "user_id"
        case role
        case joinedAt = "joined_at"
    }
}

// MARK: - Team Invite

struct TeamInvite: Codable, Identifiable, Sendable {
    let id: String
    let teamId: String
    let email: String
    let role: String  // "admin" | "member"
    let invitedBy: String
    let status: String  // "pending" | "accepted" | "expired"
    let token: String
    let createdAt: String
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case id, email, role, status, token
        case teamId = "team_id"
        case invitedBy = "invited_by"
        case createdAt = "created_at"
        case expiresAt = "expires_at"
    }
}

/// TeamInvite enriched with the team name for display in the join flow.
struct TeamInviteWithName: Identifiable, Sendable {
    let id: String
    let teamId: String
    let email: String
    let role: String
    let status: String
    let createdAt: String
    let expiresAt: String
    let teamName: String
}

// MARK: - Team Grant

struct TeamGrant: Codable, Identifiable, Sendable {
    let id: String
    let teamId: String
    let grantType: String  // "oss_project" | "oss_contributor" | "custom"
    let planTier: String  // "starter" | "agency"
    let seatLimit: Int?
    let projectLimit: Int?
    let repoUrl: String?
    let note: String?
    let expiresAt: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, note
        case teamId = "team_id"
        case grantType = "grant_type"
        case planTier = "plan_tier"
        case seatLimit = "seat_limit"
        case projectLimit = "project_limit"
        case repoUrl = "repo_url"
        case expiresAt = "expires_at"
        case createdAt = "created_at"
    }
}

// MARK: - Notification (PremiumNotification to avoid Foundation conflict)

struct PremiumNotification: Codable, Identifiable, Sendable {
    let id: String
    let userId: String
    let projectId: String?
    let type: String  // "mention" | "assignment" | "review_request" | "review_resolved"
    let title: String
    let body: String?
    let entityType: String
    let entityId: String
    let isRead: Bool
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, type, title, body
        case userId = "user_id"
        case projectId = "project_id"
        case entityType = "entity_type"
        case entityId = "entity_id"
        case isRead = "is_read"
        case createdAt = "created_at"
    }
}

// MARK: - Activity Event

struct ActivityEvent: Codable, Identifiable, Sendable {
    let id: String
    let projectId: String
    let userId: String
    let eventType: String
    let entityType: String
    let entityId: String
    let metadata: String?  // Raw JSON string
    let createdAt: String
    let user: PremiumUser?

    enum CodingKeys: String, CodingKey {
        case id, metadata, user
        case projectId = "project_id"
        case userId = "user_id"
        case eventType = "event_type"
        case entityType = "entity_type"
        case entityId = "entity_id"
        case createdAt = "created_at"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        projectId = try container.decode(String.self, forKey: .projectId)
        userId = try container.decode(String.self, forKey: .userId)
        eventType = try container.decode(String.self, forKey: .eventType)
        entityType = try container.decode(String.self, forKey: .entityType)
        entityId = try container.decode(String.self, forKey: .entityId)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        user = try container.decodeIfPresent(PremiumUser.self, forKey: .user)

        // metadata can be a JSON object or a string; store as raw JSON string
        if let rawObj = try? container.decode([String: AnyCodableValue].self, forKey: .metadata) {
            let data = try JSONEncoder().encode(rawObj)
            metadata = String(data: data, encoding: .utf8)
        } else {
            metadata = try container.decodeIfPresent(String.self, forKey: .metadata)
        }
    }
}

/// Lightweight wrapper to decode arbitrary JSON values inside metadata.
enum AnyCodableValue: Codable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(Bool.self) { self = .bool(v) }
        else if let v = try? container.decode(Int.self) { self = .int(v) }
        else if let v = try? container.decode(Double.self) { self = .double(v) }
        else if let v = try? container.decode(String.self) { self = .string(v) }
        else if container.decodeNil() { self = .null }
        else { self = .null }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }
}

// MARK: - Session Summary

struct SessionSummary: Codable, Identifiable, Sendable {
    let id: String
    let projectId: String
    let userId: String
    let sessionSlug: String?
    let model: String?
    let gitBranch: String?
    let summary: String
    let filesChanged: [String]
    let durationMins: Int?
    let startedAt: String?
    let endedAt: String?
    let sharedAt: String
    let user: PremiumUser?

    enum CodingKeys: String, CodingKey {
        case id, summary, model, user
        case projectId = "project_id"
        case userId = "user_id"
        case sessionSlug = "session_slug"
        case gitBranch = "git_branch"
        case filesChanged = "files_changed"
        case durationMins = "duration_mins"
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case sharedAt = "shared_at"
    }
}

// MARK: - Project Doc

struct ProjectDoc: Codable, Identifiable, Sendable {
    let id: String
    let projectId: String
    let title: String
    let content: String
    let sortOrder: Int
    let createdBy: String
    let lastEditedBy: String?
    let createdAt: String
    let updatedAt: String
    let createdByUser: PremiumUser?
    let lastEditedByUser: PremiumUser?

    enum CodingKeys: String, CodingKey {
        case id, title, content
        case projectId = "project_id"
        case sortOrder = "sort_order"
        case createdBy = "created_by"
        case lastEditedBy = "last_edited_by"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case createdByUser = "created_by_user"
        case lastEditedByUser = "last_edited_by_user"
    }
}

// MARK: - Review Request

struct ReviewRequest: Codable, Identifiable, Sendable {
    let id: String
    let projectId: String
    let taskId: String
    let requestedBy: String
    let assignedTo: String
    let status: String  // "pending" | "approved" | "changes_requested" | "dismissed"
    let comment: String?
    let createdAt: String
    let resolvedAt: String?
    let requestedByUser: PremiumUser?
    let assignedToUser: PremiumUser?

    enum CodingKeys: String, CodingKey {
        case id, status, comment
        case projectId = "project_id"
        case taskId = "task_id"
        case requestedBy = "requested_by"
        case assignedTo = "assigned_to"
        case createdAt = "created_at"
        case resolvedAt = "resolved_at"
        case requestedByUser = "requested_by_user"
        case assignedToUser = "assigned_to_user"
    }
}

// MARK: - Presence State

struct PresenceState: Codable, Sendable {
    let userId: String
    let displayName: String
    let activeFile: String?
    let gitBranch: String?
    let onlineAt: String
    let status: String  // "active" | "idle" | "offline"

    enum CodingKeys: String, CodingKey {
        case status
        case userId = "user_id"
        case displayName = "display_name"
        case activeFile = "active_file"
        case gitBranch = "git_branch"
        case onlineAt = "online_at"
    }
}

// MARK: - Premium Status

struct PremiumStatus: Sendable {
    var enabled: Bool
    var authenticated: Bool
    var user: PremiumUser?
    var team: Team?
    var grant: TeamGrant?
    var subscriptionActive: Bool
    var syncEnabled: Bool
}

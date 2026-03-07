import Foundation

// MARK: - PremiumService

@MainActor
class PremiumService: ObservableObject {
    static let shared = PremiumService()

    @Published var status: PremiumStatus = PremiumStatus(
        enabled: false,
        authenticated: false,
        user: nil,
        team: nil,
        grant: nil,
        subscriptionActive: false,
        syncEnabled: false
    )
    @Published var notifications: [PremiumNotification] = []
    @Published var unreadCount: Int = 0

    // Auth tokens stored in KeychainHelper
    private var accessToken: String?
    private var refreshToken: String?

    /// Super admins bypass all paywalls and limits
    private static let superAdminEmails: Set<String> = ["nick@gridnpixel.com"]

    var isSuperAdmin: Bool {
        guard let email = status.user?.email else { return false }
        return Self.superAdminEmails.contains(email.lowercased())
    }

    private var baseURL: String { SharedServices.shared.appSettings.supabaseUrl }
    private var anonKey: String { SharedServices.shared.appSettings.supabaseAnonKey }

    /// Public accessors for SyncEngine/RealtimeClient
    var supabaseBaseURL: String { baseURL }
    var supabaseAnonKeyValue: String { anonKey }
    var currentAccessToken: String? { accessToken }

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    private init() {
        loadTokens()
    }

    // MARK: - Token Persistence

    private func loadTokens() {
        accessToken = KeychainHelper.read(key: "premium_access_token")
        refreshToken = KeychainHelper.read(key: "premium_refresh_token")
        if accessToken != nil {
            status.authenticated = true
            status.enabled = true
            // Restore user profile from token
            Task { await restoreUserProfile() }
        }
    }

    private func restoreUserProfile() async {
        guard let token = accessToken else {
            print("PremiumService: no access token, skipping restore")
            return
        }
        if baseURL.isEmpty || anonKey.isEmpty {
            print("PremiumService: baseURL or anonKey empty, retrying in 1s...")
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if baseURL.isEmpty || anonKey.isEmpty {
                print("PremiumService: still empty after retry, giving up")
                return
            }
        }
        var request = URLRequest(url: URL(string: baseURL + "/auth/v1/user")!)
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode == 401 {
                print("PremiumService: token expired (401), attempting refresh...")
                if let _ = try? await refreshSession() {
                    await restoreUserProfile()
                } else {
                    print("PremiumService: refresh failed, clearing tokens")
                    clearTokens()
                    status.authenticated = false
                }
                return
            }
            if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                print("PremiumService: unexpected status \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
                return
            }
            let user = try decoder.decode(AuthUser.self, from: data)
            status.user = PremiumUser(
                id: user.id,
                email: user.email ?? "",
                displayName: user.userMetadata?["display_name"] as? String ?? user.email ?? "",
                avatarUrl: user.userMetadata?["avatar_url"] as? String
            )
            print("PremiumService: restored user \(status.user?.email ?? "?")")
            await loadTeamMembership()
            print("PremiumService: team=\(status.team?.name ?? "none"), subscriptionActive=\(status.subscriptionActive)")
        } catch {
            print("PremiumService: failed to restore user profile: \(error)")
        }
    }

    private func saveTokens(access: String, refresh: String) {
        accessToken = access
        refreshToken = refresh
        try? KeychainHelper.save(key: "premium_access_token", value: access)
        try? KeychainHelper.save(key: "premium_refresh_token", value: refresh)
    }

    private func clearTokens() {
        accessToken = nil
        refreshToken = nil
        KeychainHelper.delete(key: "premium_access_token")
        KeychainHelper.delete(key: "premium_refresh_token")
    }

    // MARK: - Auth

    func signUp(email: String, password: String, displayName: String) async throws {
        let body: [String: Any] = [
            "email": email,
            "password": password,
            "data": ["display_name": displayName]
        ]
        let data = try await authRequest("/auth/v1/signup", body: body)
        let response = try decoder.decode(AuthResponse.self, from: data)
        if let session = response.session {
            saveTokens(access: session.accessToken, refresh: session.refreshToken)
        }
        if let user = response.user {
            status.user = PremiumUser(
                id: user.id,
                email: user.email ?? email,
                displayName: displayName,
                avatarUrl: nil
            )
        }

        // If sign-up didn't return a session (e.g. email confirmation was required),
        // automatically sign in to get a valid token.
        if accessToken == nil {
            try await signIn(email: email, password: password)
            return
        }

        status.authenticated = true
        status.enabled = true
    }

    func signIn(email: String, password: String) async throws {
        let body: [String: Any] = [
            "email": email,
            "password": password
        ]
        let data = try await authRequest("/auth/v1/token?grant_type=password", body: body)
        let response = try decoder.decode(AuthResponse.self, from: data)
        guard let session = response.session ?? extractSession(from: data) else {
            throw PremiumError.authFailed("No session returned")
        }
        saveTokens(access: session.accessToken, refresh: session.refreshToken)

        // The token endpoint returns user + tokens at top level
        if let user = response.user {
            status.user = PremiumUser(
                id: user.id,
                email: user.email ?? email,
                displayName: user.userMetadata?["display_name"] as? String ?? email,
                avatarUrl: user.userMetadata?["avatar_url"] as? String
            )
        }
        status.authenticated = true
        status.enabled = true

        // Fetch team membership
        await loadTeamMembership()
    }

    func signOut() {
        clearTokens()
        status = PremiumStatus(
            enabled: false,
            authenticated: false,
            user: nil,
            team: nil,
            grant: nil,
            subscriptionActive: false,
            syncEnabled: false
        )
        notifications = []
        unreadCount = 0
    }

    func getStatus() -> PremiumStatus {
        return status
    }

    /// Refresh the access token using the stored refresh token.
    func refreshSession() async throws {
        guard let refresh = refreshToken else {
            throw PremiumError.authFailed("No refresh token")
        }
        let body: [String: Any] = ["refresh_token": refresh]
        let data = try await authRequest("/auth/v1/token?grant_type=refresh_token", body: body)

        // The refresh endpoint returns access_token / refresh_token at top level
        if let session = extractSession(from: data) {
            saveTokens(access: session.accessToken, refresh: session.refreshToken)
        } else {
            throw PremiumError.authFailed("Failed to refresh session")
        }
    }

    // MARK: - Team

    func createTeam(name: String, slug: String? = nil) async throws -> Team {
        let slug = slug ?? name.lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .replacingOccurrences(of: "[^a-z0-9\\-]", with: "", options: .regularExpression)

        let debugLog = "/tmp/codefire-premium-debug.log"
        func dbg(_ msg: String) {
            let line = "\(Date()): \(msg)\n"
            print(line)
            if let data = line.data(using: .utf8) {
                if FileManager.default.fileExists(atPath: debugLog) {
                    let handle = FileHandle(forWritingAtPath: debugLog)!
                    handle.seekToEndOfFile()
                    handle.write(data)
                    handle.closeFile()
                } else {
                    FileManager.default.createFile(atPath: debugLog, contents: data)
                }
            }
        }

        dbg("createTeam: slug=\(slug), hasToken=\(accessToken != nil)")

        // Check if user has pre-team Stripe IDs to transfer
        var userStripeCustomerId: String?
        var userStripeSubscriptionId: String?
        if let userId = status.user?.id {
            do {
                let userData = try await supabaseRequest(
                    "users",
                    queryParams: [
                        ("select", "stripe_customer_id,stripe_subscription_id"),
                        ("id", "eq.\(userId)"),
                        ("limit", "1")
                    ]
                )
                struct UserStripe: Decodable {
                    let stripeCustomerId: String?
                    let stripeSubscriptionId: String?
                    enum CodingKeys: String, CodingKey {
                        case stripeCustomerId = "stripe_customer_id"
                        case stripeSubscriptionId = "stripe_subscription_id"
                    }
                }
                if let userStripe = try decoder.decode([UserStripe].self, from: userData).first {
                    userStripeCustomerId = userStripe.stripeCustomerId
                    userStripeSubscriptionId = userStripe.stripeSubscriptionId
                }
            } catch {
                dbg("createTeam: failed to check user Stripe IDs: \(error)")
            }
        }

        // owner_id is set server-side via DEFAULT auth.uid()
        var body: [String: Any] = [
            "name": name,
            "slug": slug,
            "plan": "starter",
            "seat_limit": 5
        ]
        // Transfer user's Stripe IDs to the team
        if let customerId = userStripeCustomerId {
            body["stripe_customer_id"] = customerId
        }
        if let subscriptionId = userStripeSubscriptionId {
            body["stripe_subscription_id"] = subscriptionId
        }

        let bodyData = try JSONSerialization.data(withJSONObject: body)
        dbg("createTeam body: \(String(data: bodyData, encoding: .utf8) ?? "nil")")
        let data = try await supabaseRequest(
            "teams",
            method: "POST",
            body: bodyData,
            headers: [("Prefer", "return=representation")]
        )
        let teams = try decoder.decode([Team].self, from: data)
        guard let team = teams.first else {
            throw PremiumError.unexpected("No team returned")
        }

        // Add the creator as team owner (use owner_id from the returned team, not status.user which may be nil on restore)
        let memberBody: [String: Any] = [
            "team_id": team.id,
            "user_id": team.ownerId,
            "role": "owner"
        ]
        let memberData = try JSONSerialization.data(withJSONObject: memberBody)
        _ = try await supabaseRequest(
            "team_members",
            method: "POST",
            body: memberData
        )

        // Clear user-level Stripe IDs (now owned by team)
        if userStripeSubscriptionId != nil, let userId = status.user?.id {
            let clearBody = try JSONSerialization.data(withJSONObject: [
                "stripe_customer_id": NSNull(),
                "stripe_subscription_id": NSNull()
            ] as [String: Any])
            _ = try? await supabaseRequest(
                "users",
                method: "PATCH",
                body: clearBody,
                queryParams: [("id", "eq.\(userId)")]
            )
        }

        status.team = team
        return team
    }

    func listMembers(teamId: String) async throws -> [TeamMember] {
        let data = try await supabaseRequest(
            "team_members",
            queryParams: [
                ("select", "*,user:users(id,email,display_name,avatar_url)"),
                ("team_id", "eq.\(teamId)")
            ]
        )
        return try decoder.decode([TeamMember].self, from: data)
    }

    func inviteMember(teamId: String, email: String, role: String) async throws -> TeamInvite {
        guard let userId = status.user?.id else {
            throw PremiumError.authFailed("Not authenticated")
        }
        let body: [String: Any] = [
            "team_id": teamId,
            "email": email,
            "role": role,
            "invited_by": userId,
            "status": "pending",
            "expires_at": ISO8601DateFormatter().string(from: Date().addingTimeInterval(7 * 24 * 3600))
        ]
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let data = try await supabaseRequest(
            "team_invites",
            method: "POST",
            body: bodyData,
            headers: [("Prefer", "return=representation")]
        )
        let invites = try decoder.decode([TeamInvite].self, from: data)
        guard let invite = invites.first else {
            throw PremiumError.unexpected("No invite returned")
        }
        return invite
    }

    func removeMember(teamId: String, userId: String) async throws {
        _ = try await supabaseRequest(
            "team_members",
            method: "DELETE",
            queryParams: [
                ("team_id", "eq.\(teamId)"),
                ("user_id", "eq.\(userId)")
            ]
        )
    }

    func acceptInvite(token: String) async throws {
        // Call an edge function that validates the token and adds the member
        _ = try await supabaseEdgeFunction("accept-invite", body: ["token": token])
        await loadTeamMembership()
    }

    /// Fetch pending invites for the currently authenticated user's email.
    func getMyInvites() async throws -> [TeamInviteWithName] {
        guard let email = status.user?.email else {
            throw PremiumError.authFailed("Not authenticated")
        }
        let data = try await supabaseRequest(
            "team_invites",
            queryParams: [
                ("select", "*,teams(name)"),
                ("email", "eq.\(email)"),
                ("status", "eq.pending")
            ]
        )

        struct InviteRow: Decodable {
            let id: String
            let teamId: String
            let email: String
            let role: String
            let status: String
            let createdAt: String
            let expiresAt: String
            let teams: TeamNameOnly?

            enum CodingKeys: String, CodingKey {
                case id, email, role, status
                case teamId = "team_id"
                case createdAt = "created_at"
                case expiresAt = "expires_at"
                case teams
            }
        }

        struct TeamNameOnly: Decodable {
            let name: String
        }

        let rows = try decoder.decode([InviteRow].self, from: data)
        return rows.map { row in
            TeamInviteWithName(
                id: row.id,
                teamId: row.teamId,
                email: row.email,
                role: row.role,
                status: row.status,
                createdAt: row.createdAt,
                expiresAt: row.expiresAt,
                teamName: row.teams?.name ?? "Unknown Team"
            )
        }
    }

    /// Accept a pending invite by its ID (for in-app join flow).
    func acceptInviteById(inviteId: String) async throws {
        guard let userId = status.user?.id else {
            throw PremiumError.authFailed("Not authenticated")
        }

        // Fetch the invite
        let inviteData = try await supabaseRequest(
            "team_invites",
            queryParams: [
                ("select", "*"),
                ("id", "eq.\(inviteId)"),
                ("status", "eq.pending"),
                ("limit", "1")
            ]
        )

        struct Invite: Decodable {
            let id: String
            let teamId: String
            let role: String
            enum CodingKeys: String, CodingKey {
                case id, role
                case teamId = "team_id"
            }
        }

        let invites = try decoder.decode([Invite].self, from: inviteData)
        guard let invite = invites.first else {
            throw PremiumError.unexpected("Invalid or expired invite")
        }

        // Add to team
        let memberBody = try JSONSerialization.data(withJSONObject: [
            "team_id": invite.teamId,
            "user_id": userId,
            "role": invite.role
        ])
        _ = try await supabaseRequest(
            "team_members",
            method: "POST",
            body: memberBody,
            headers: [("Prefer", "return=representation")]
        )

        // Mark invite accepted
        let updateBody = try JSONSerialization.data(withJSONObject: ["status": "accepted"])
        _ = try await supabaseRequest(
            "team_invites",
            method: "PATCH",
            body: updateBody,
            queryParams: [("id", "eq.\(inviteId)")]
        )

        await loadTeamMembership()
    }

    // MARK: - Project Sync

    func syncProject(teamId: String, projectId: String, name: String, repoUrl: String?) async throws {
        guard let userId = status.user?.id else {
            throw PremiumError.authFailed("Not authenticated")
        }
        var body: [String: Any] = [
            "id": projectId,
            "team_id": teamId,
            "name": name,
            "created_by": userId
        ]
        if let repoUrl = repoUrl {
            body["repo_url"] = repoUrl
        }
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        _ = try await supabaseRequest(
            "synced_projects",
            method: "POST",
            body: bodyData,
            headers: [("Prefer", "return=representation")]
        )

        // Also add the user as project lead
        let memberBody = try JSONSerialization.data(withJSONObject: [
            "project_id": projectId,
            "user_id": userId,
            "role": "lead"
        ] as [String: Any])
        _ = try? await supabaseRequest(
            "project_members",
            method: "POST",
            body: memberBody
        )

        status.syncEnabled = true
    }

    func unsyncProject(projectId: String) async throws {
        _ = try await supabaseRequest(
            "synced_projects",
            method: "DELETE",
            queryParams: [("id", "eq.\(projectId)")]
        )
    }

    // MARK: - Notifications

    func fetchNotifications(limit: Int = 50) async throws {
        guard let userId = status.user?.id else { return }
        let data = try await supabaseRequest(
            "notifications",
            queryParams: [
                ("select", "*"),
                ("user_id", "eq.\(userId)"),
                ("order", "created_at.desc"),
                ("limit", "\(limit)")
            ]
        )
        let fetched = try decoder.decode([PremiumNotification].self, from: data)
        notifications = fetched
        unreadCount = fetched.filter { !$0.isRead }.count
    }

    func markRead(notificationId: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["is_read": true])
        _ = try await supabaseRequest(
            "notifications",
            method: "PATCH",
            body: body,
            queryParams: [("id", "eq.\(notificationId)")]
        )
        if let idx = notifications.firstIndex(where: { $0.id == notificationId }) {
            // Re-decode with is_read = true
            let old = notifications[idx]
            let updated = PremiumNotification(
                id: old.id, userId: old.userId, projectId: old.projectId,
                type: old.type, title: old.title, body: old.body,
                entityType: old.entityType, entityId: old.entityId,
                isRead: true, createdAt: old.createdAt
            )
            notifications[idx] = updated
            unreadCount = notifications.filter { !$0.isRead }.count
        }
    }

    func markAllRead() async throws {
        guard let userId = status.user?.id else { return }
        let body = try JSONSerialization.data(withJSONObject: ["is_read": true])
        _ = try await supabaseRequest(
            "notifications",
            method: "PATCH",
            body: body,
            queryParams: [
                ("user_id", "eq.\(userId)"),
                ("is_read", "eq.false")
            ]
        )
        notifications = notifications.map { n in
            PremiumNotification(
                id: n.id, userId: n.userId, projectId: n.projectId,
                type: n.type, title: n.title, body: n.body,
                entityType: n.entityType, entityId: n.entityId,
                isRead: true, createdAt: n.createdAt
            )
        }
        unreadCount = 0
    }

    // MARK: - Activity

    func getActivityFeed(projectId: String, limit: Int = 50) async throws -> [ActivityEvent] {
        let data = try await supabaseRequest(
            "activity_events",
            queryParams: [
                ("select", "*,user:users(id,email,display_name,avatar_url)"),
                ("project_id", "eq.\(projectId)"),
                ("order", "created_at.desc"),
                ("limit", "\(limit)")
            ]
        )
        return try decoder.decode([ActivityEvent].self, from: data)
    }

    // MARK: - Session Summaries

    func listSessionSummaries(projectId: String) async throws -> [SessionSummary] {
        let data = try await supabaseRequest(
            "session_summaries",
            queryParams: [
                ("select", "*,user:users(id,email,display_name,avatar_url)"),
                ("project_id", "eq.\(projectId)"),
                ("order", "shared_at.desc"),
                ("limit", "50")
            ]
        )
        return try decoder.decode([SessionSummary].self, from: data)
    }

    func shareSessionSummary(_ summary: SessionSummary) async throws -> SessionSummary {
        guard let userId = status.user?.id else {
            throw PremiumError.authFailed("Not authenticated")
        }
        var body: [String: Any] = [
            "project_id": summary.projectId,
            "user_id": userId,
            "summary": summary.summary,
            "files_changed": summary.filesChanged
        ]
        if let v = summary.sessionSlug { body["session_slug"] = v }
        if let v = summary.model { body["model"] = v }
        if let v = summary.gitBranch { body["git_branch"] = v }
        if let v = summary.durationMins { body["duration_mins"] = v }
        if let v = summary.startedAt { body["started_at"] = v }
        if let v = summary.endedAt { body["ended_at"] = v }

        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let data = try await supabaseRequest(
            "session_summaries",
            method: "POST",
            body: bodyData,
            queryParams: [("select", "*,user:users(id,email,display_name,avatar_url)")],
            headers: [("Prefer", "return=representation")]
        )
        let results = try decoder.decode([SessionSummary].self, from: data)
        guard let result = results.first else {
            throw PremiumError.unexpected("No session summary returned")
        }
        return result
    }

    // MARK: - Project Docs

    func listProjectDocs(projectId: String) async throws -> [ProjectDoc] {
        let data = try await supabaseRequest(
            "project_docs",
            queryParams: [
                ("select", "*,created_by_user:users!project_docs_created_by_fkey(id,email,display_name,avatar_url),last_edited_by_user:users!project_docs_last_edited_by_fkey(id,email,display_name,avatar_url)"),
                ("project_id", "eq.\(projectId)"),
                ("order", "sort_order.asc")
            ]
        )
        return try decoder.decode([ProjectDoc].self, from: data)
    }

    func getProjectDoc(docId: String) async throws -> ProjectDoc {
        let data = try await supabaseRequest(
            "project_docs",
            queryParams: [
                ("select", "*,created_by_user:users!project_docs_created_by_fkey(id,email,display_name,avatar_url),last_edited_by_user:users!project_docs_last_edited_by_fkey(id,email,display_name,avatar_url)"),
                ("id", "eq.\(docId)")
            ],
            headers: [("Accept", "application/vnd.pgrst.object+json")]
        )
        return try decoder.decode(ProjectDoc.self, from: data)
    }

    func createProjectDoc(projectId: String, title: String, content: String) async throws -> ProjectDoc {
        guard let userId = status.user?.id else {
            throw PremiumError.authFailed("Not authenticated")
        }

        // Get max sort_order
        let existingData = try await supabaseRequest(
            "project_docs",
            queryParams: [
                ("select", "sort_order"),
                ("project_id", "eq.\(projectId)"),
                ("order", "sort_order.desc"),
                ("limit", "1")
            ]
        )
        let existing = try decoder.decode([[String: Int]].self, from: existingData)
        let nextOrder = (existing.first?["sort_order"] ?? -1) + 1

        let body: [String: Any] = [
            "project_id": projectId,
            "title": title,
            "content": content,
            "sort_order": nextOrder,
            "created_by": userId
        ]
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let data = try await supabaseRequest(
            "project_docs",
            method: "POST",
            body: bodyData,
            headers: [("Prefer", "return=representation")]
        )
        let docs = try decoder.decode([ProjectDoc].self, from: data)
        guard let doc = docs.first else {
            throw PremiumError.unexpected("No doc returned")
        }
        return doc
    }

    func updateProjectDoc(docId: String, title: String?, content: String?) async throws -> ProjectDoc {
        guard let userId = status.user?.id else {
            throw PremiumError.authFailed("Not authenticated")
        }
        var body: [String: Any] = ["last_edited_by": userId]
        if let title = title { body["title"] = title }
        if let content = content { body["content"] = content }

        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let data = try await supabaseRequest(
            "project_docs",
            method: "PATCH",
            body: bodyData,
            queryParams: [("id", "eq.\(docId)")],
            headers: [("Prefer", "return=representation")]
        )
        let docs = try decoder.decode([ProjectDoc].self, from: data)
        guard let doc = docs.first else {
            throw PremiumError.unexpected("No doc returned")
        }
        return doc
    }

    func deleteProjectDoc(docId: String) async throws {
        _ = try await supabaseRequest(
            "project_docs",
            method: "DELETE",
            queryParams: [("id", "eq.\(docId)")]
        )
    }

    // MARK: - Reviews

    func listReviewRequests(projectId: String) async throws -> [ReviewRequest] {
        let data = try await supabaseRequest(
            "review_requests",
            queryParams: [
                ("select", "*,requested_by_user:users!review_requests_requested_by_fkey(id,email,display_name,avatar_url),assigned_to_user:users!review_requests_assigned_to_fkey(id,email,display_name,avatar_url)"),
                ("project_id", "eq.\(projectId)"),
                ("order", "created_at.desc")
            ]
        )
        return try decoder.decode([ReviewRequest].self, from: data)
    }

    func requestReview(projectId: String, taskId: String, assignedTo: String, comment: String?) async throws -> ReviewRequest {
        guard let userId = status.user?.id else {
            throw PremiumError.authFailed("Not authenticated")
        }
        var body: [String: Any] = [
            "project_id": projectId,
            "task_id": taskId,
            "requested_by": userId,
            "assigned_to": assignedTo,
            "status": "pending"
        ]
        if let comment = comment { body["comment"] = comment }

        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let data = try await supabaseRequest(
            "review_requests",
            method: "POST",
            body: bodyData,
            queryParams: [("select", "*")],
            headers: [("Prefer", "return=representation")]
        )
        let reviews = try decoder.decode([ReviewRequest].self, from: data)
        guard let review = reviews.first else {
            throw PremiumError.unexpected("No review returned")
        }

        // Create a notification for the assigned reviewer
        let notifBody: [String: Any] = [
            "user_id": assignedTo,
            "project_id": projectId,
            "type": "review_request",
            "title": "Review requested",
            "body": "\(status.user?.displayName ?? "A team member") requested your review",
            "entity_type": "review_request",
            "entity_id": review.id
        ]
        let notifData = try JSONSerialization.data(withJSONObject: notifBody)
        _ = try? await supabaseRequest("notifications", method: "POST", body: notifData)

        return review
    }

    func resolveReview(reviewId: String, status resolveStatus: String) async throws -> ReviewRequest {
        let body: [String: Any] = [
            "status": resolveStatus,
            "resolved_at": ISO8601DateFormatter().string(from: Date())
        ]
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let data = try await supabaseRequest(
            "review_requests",
            method: "PATCH",
            body: bodyData,
            queryParams: [("id", "eq.\(reviewId)")],
            headers: [("Prefer", "return=representation")]
        )
        let reviews = try decoder.decode([ReviewRequest].self, from: data)
        guard let review = reviews.first else {
            throw PremiumError.unexpected("No review returned")
        }

        // Notify the requester
        let statusLabel: String
        switch resolveStatus {
        case "approved": statusLabel = "approved"
        case "changes_requested": statusLabel = "requested changes on"
        default: statusLabel = "dismissed"
        }

        let notifBody: [String: Any] = [
            "user_id": review.requestedBy,
            "project_id": review.projectId,
            "type": "review_resolved",
            "title": "Review \(statusLabel)",
            "body": "\(status.user?.displayName ?? "A team member") \(statusLabel) your review request",
            "entity_type": "review_request",
            "entity_id": review.id
        ]
        let notifData = try JSONSerialization.data(withJSONObject: notifBody)
        _ = try? await supabaseRequest("notifications", method: "POST", body: notifData)

        return review
    }

    // MARK: - OSS Grants

    func requestOSSGrant(teamId: String, grantType: String, repoUrl: String) async throws {
        guard let userId = status.user?.id else {
            throw PremiumError.authFailed("Not authenticated")
        }
        let body: [String: Any] = [
            "team_id": teamId,
            "grant_type": grantType,
            "plan_tier": "agency",
            "repo_url": repoUrl,
            "granted_by": userId,
            "note": "Self-service request — pending review"
        ]
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        _ = try await supabaseRequest(
            "team_grants",
            method: "POST",
            body: bodyData,
            headers: [("Prefer", "return=representation")]
        )
    }

    // MARK: - Billing

    func createCheckout(teamId: String?, plan: String, extraSeats: Int) async throws -> URL {
        var body: [String: Any] = [
            "plan": plan,
            "extraSeats": extraSeats
        ]
        if let teamId = teamId {
            body["teamId"] = teamId
        }
        let data = try await supabaseEdgeFunction("create-checkout", body: body)
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let urlStr = json["url"] as? String,
              let url = URL(string: urlStr)
        else {
            throw PremiumError.unexpected("Invalid checkout response")
        }
        return url
    }

    func getBillingPortal(teamId: String) async throws -> URL {
        let data = try await supabaseEdgeFunction("billing-portal", body: [
            "teamId": teamId
        ])
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let urlStr = json["url"] as? String,
              let url = URL(string: urlStr)
        else {
            throw PremiumError.unexpected("Invalid billing portal response")
        }
        return url
    }

    // MARK: - Public REST Helpers (used by SyncEngine)

    /// GET from a Supabase REST table.
    func supabaseGetPublic(_ table: String, queryParams: [(String, String)] = []) async throws -> Data {
        return try await supabaseRequest(table, queryParams: queryParams)
    }

    /// INSERT a row and return the created object as a dictionary.
    func supabaseInsertPublic(_ table: String, body: [String: Any]) async throws -> [String: Any] {
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let data = try await supabaseRequest(
            table,
            method: "POST",
            body: bodyData,
            headers: [("Prefer", "return=representation")]
        )
        guard let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              let first = arr.first else {
            throw PremiumError.unexpected("No row returned from INSERT")
        }
        return first
    }

    /// UPSERT (PATCH) a row by its UUID.
    func supabaseUpsertPublic(_ table: String, id: String, body: [String: Any]) async throws {
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        _ = try await supabaseRequest(
            table,
            method: "PATCH",
            body: bodyData,
            queryParams: [("id", "eq.\(id)")]
        )
    }

    /// DELETE a row by its UUID.
    func supabaseDeletePublic(_ table: String, id: String) async throws {
        _ = try await supabaseRequest(
            table,
            method: "DELETE",
            queryParams: [("id", "eq.\(id)")]
        )
    }

    // MARK: - Private Helpers

    /// Load the current user's team membership after sign-in.
    private func loadTeamMembership() async {
        guard let userId = status.user?.id else { return }
        do {
            let data = try await supabaseRequest(
                "team_members",
                queryParams: [
                    ("select", "team_id,role,team:teams(*)"),
                    ("user_id", "eq.\(userId)"),
                    ("limit", "1")
                ]
            )
            struct MemberWithTeam: Decodable {
                let teamId: String
                let role: String
                let team: Team?
                enum CodingKeys: String, CodingKey {
                    case teamId = "team_id"
                    case role, team
                }
            }
            let members = try decoder.decode([MemberWithTeam].self, from: data)
            if let member = members.first {
                status.team = member.team
            }

            // Check for grants
            if let teamId = status.team?.id {
                let grantData = try await supabaseRequest(
                    "team_grants",
                    queryParams: [
                        ("select", "*"),
                        ("team_id", "eq.\(teamId)"),
                        ("limit", "1")
                    ]
                )
                let grants = try decoder.decode([TeamGrant].self, from: grantData)
                status.grant = grants.first
                // If you're on a team, you have an active subscription
                // (teams require payment to create)
                status.subscriptionActive = true
            }
        } catch {
            // Non-fatal: user may not be on a team yet
        }

        // Check for user-level subscription (pre-team)
        if !status.subscriptionActive, let userId = status.user?.id {
            do {
                let userData = try await supabaseRequest(
                    "users",
                    queryParams: [
                        ("select", "stripe_subscription_id"),
                        ("id", "eq.\(userId)"),
                        ("limit", "1")
                    ]
                )
                struct UserSub: Decodable {
                    let stripeSubscriptionId: String?
                    enum CodingKeys: String, CodingKey {
                        case stripeSubscriptionId = "stripe_subscription_id"
                    }
                }
                let users = try decoder.decode([UserSub].self, from: userData)
                if let sub = users.first, sub.stripeSubscriptionId != nil {
                    status.subscriptionActive = true
                }
            } catch {
                // Non-fatal
            }
        }

        // Super admins always have active subscription
        if isSuperAdmin {
            status.subscriptionActive = true
        }
    }

    // MARK: - Supabase REST Helpers

    /// Make a request to the Supabase REST API (PostgREST).
    @discardableResult
    private func supabaseRequest(
        _ path: String,
        method: String = "GET",
        body: Data? = nil,
        queryParams: [(String, String)] = [],
        headers: [(String, String)] = []
    ) async throws -> Data {
        guard !baseURL.isEmpty, !anonKey.isEmpty else {
            throw PremiumError.notConfigured
        }

        var components = URLComponents(string: baseURL + "/rest/v1/" + path)!
        if !queryParams.isEmpty {
            components.queryItems = queryParams.map { URLQueryItem(name: $0.0, value: $0.1) }
        }
        guard let url = components.url else {
            throw PremiumError.unexpected("Invalid URL")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token = accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            if method == "POST" { print("DEBUG supabaseRequest \(path): auth=accessToken prefix=\(String(token.prefix(20)))") }
        } else {
            request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
            if method == "POST" { print("DEBUG supabaseRequest \(path): WARNING using anon key - no access token!") }
        }

        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        if let body = body {
            request.httpBody = body
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        if let httpResponse = response as? HTTPURLResponse {
            // Try to refresh token on 401
            if httpResponse.statusCode == 401 && refreshToken != nil {
                try await refreshSession()
                // Retry with new token
                request.setValue("Bearer \(accessToken ?? anonKey)", forHTTPHeaderField: "Authorization")
                let (retryData, retryResponse) = try await URLSession.shared.data(for: request)
                if let retryHttp = retryResponse as? HTTPURLResponse, retryHttp.statusCode >= 400 {
                    throw PremiumError.httpError(retryHttp.statusCode, String(data: retryData, encoding: .utf8) ?? "")
                }
                return retryData
            }

            if httpResponse.statusCode >= 400 {
                throw PremiumError.httpError(httpResponse.statusCode, String(data: data, encoding: .utf8) ?? "")
            }
        }

        return data
    }

    /// Make a request to a Supabase Auth endpoint.
    private func authRequest(_ path: String, body: [String: Any]) async throws -> Data {
        guard !baseURL.isEmpty, !anonKey.isEmpty else {
            throw PremiumError.notConfigured
        }

        let url = URL(string: baseURL + path)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode >= 400 {
            throw PremiumError.httpError(httpResponse.statusCode, String(data: data, encoding: .utf8) ?? "")
        }

        return data
    }

    /// Call a Supabase Edge Function.
    @discardableResult
    private func supabaseEdgeFunction(_ name: String, body: [String: Any]) async throws -> Data {
        guard !baseURL.isEmpty, !anonKey.isEmpty else {
            throw PremiumError.notConfigured
        }

        let url = URL(string: baseURL + "/functions/v1/" + name)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token = accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else {
            request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode >= 400 {
            throw PremiumError.httpError(httpResponse.statusCode, String(data: data, encoding: .utf8) ?? "")
        }

        return data
    }

    /// Try to extract session tokens from a raw JSON response (for the token endpoint
    /// which returns access_token/refresh_token at top level).
    private func extractSession(from data: Data) -> AuthSession? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = json["access_token"] as? String,
              let refresh = json["refresh_token"] as? String
        else { return nil }
        return AuthSession(accessToken: access, refreshToken: refresh)
    }
}

// MARK: - Auth Response Models

private struct AuthResponse: Decodable {
    let user: AuthUser?
    let session: AuthSession?

    enum CodingKeys: String, CodingKey {
        case user, session
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        user = try container.decodeIfPresent(AuthUser.self, forKey: .user)
        session = try container.decodeIfPresent(AuthSession.self, forKey: .session)
    }
}

private struct AuthSession: Decodable {
    let accessToken: String
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
    }
}

private struct AuthUser: Decodable {
    let id: String
    let email: String?
    let userMetadata: [String: Any]?

    enum CodingKeys: String, CodingKey {
        case id, email
        case userMetadata = "user_metadata"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        email = try container.decodeIfPresent(String.self, forKey: .email)
        // Decode user_metadata as raw dictionary
        if let rawData = try? container.decode([String: AnyCodableValue].self, forKey: .userMetadata) {
            var dict = [String: Any]()
            for (key, val) in rawData {
                switch val {
                case .string(let s): dict[key] = s
                case .int(let i): dict[key] = i
                case .double(let d): dict[key] = d
                case .bool(let b): dict[key] = b
                case .null: break
                }
            }
            userMetadata = dict
        } else {
            userMetadata = nil
        }
    }
}

// MARK: - Errors

enum PremiumError: LocalizedError {
    case notConfigured
    case authFailed(String)
    case httpError(Int, String)
    case unexpected(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Premium is not configured. Set Supabase URL and anon key in settings."
        case .authFailed(let msg): return "Authentication failed: \(msg)"
        case .httpError(let code, let body): return "HTTP \(code): \(body)"
        case .unexpected(let msg): return "Unexpected error: \(msg)"
        }
    }
}

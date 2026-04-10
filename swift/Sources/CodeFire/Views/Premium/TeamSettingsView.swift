import SwiftUI
import GRDB

struct TeamSettingsTab: View {
    @ObservedObject var settings: AppSettings
    @ObservedObject var premiumService = PremiumService.shared
    @ObservedObject var syncEngine = SyncEngine.shared

    // Auth form
    @State private var authEmail: String = ""
    @State private var authPassword: String = ""
    @State private var authDisplayName: String = ""
    @State private var isSignUp = false
    @State private var authError: String?
    @State private var isAuthLoading = false

    // Team management
    @State private var members: [TeamMember] = []
    @State private var inviteEmail: String = ""
    @State private var inviteRole: String = "member"
    @State private var newTeamName: String = ""
    @State private var isCreatingTeam = false
    @State private var createTeamError: String?
    @State private var isInviting = false
    @State private var inviteSuccess: String?
    @State private var inviteError: String?

    // Sync
    @State private var isSyncEnabled = false
    @State private var isSyncingProject = false
    @State private var syncError: String?

    // Plan enforcement
    @State private var planBlock: PlanEnforcer.BlockReason?
    private let enforcer = PlanEnforcer()

    // OSS grant
    @State private var ossRepoUrl: String = ""
    @State private var ossGrantType: String = "oss_project"
    @State private var ossSubmitting = false
    @State private var ossMessage: String?

    // Pending invites
    @State private var pendingInvites: [TeamInviteWithName] = []
    @State private var isJoining = false

    // Team projects
    @State private var localProjects: [(id: String, name: String, repoUrl: String?)] = []
    @State private var syncedProjectIds: Set<String> = []
    @State private var invitingProjectId: String?
    @State private var projectInviteMessage: String?

    // Billing
    @State private var selectedPlan: String = "starter"
    @State private var extraSeats: Int = 0
    @State private var isBillingLoading = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !premiumService.status.authenticated {
                    authSection
                } else {
                    authenticatedSection
                }
            }
            .padding(16)
        }
        .sheet(item: Binding(
            get: { planBlock.map { IdentifiableBlock(reason: $0) } },
            set: { planBlock = $0?.reason }
        )) { block in
            UpgradePromptView(reason: block.reason) {
                if let team = premiumService.status.team {
                    openCheckout(team)
                }
                planBlock = nil
            } onDismiss: {
                planBlock = nil
            }
        }
    }

    // MARK: - Not Authenticated

    private var authSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            GroupBox("Team Collaboration") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Share projects, tasks, and notes with your team in real-time. Sign in or create an account to get started.")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                }
                .padding(8)
            }

            GroupBox(isSignUp ? "Create Account" : "Sign In") {
                VStack(alignment: .leading, spacing: 10) {
                    if isSignUp {
                        TextField("Display Name", text: $authDisplayName)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12))
                    }

                    TextField("Email", text: $authEmail)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12))

                    SecureField("Password", text: $authPassword)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12))

                    if let error = authError {
                        Text(error)
                            .font(.system(size: 11))
                            .foregroundColor(.red)
                    }

                    HStack {
                        Button(isSignUp ? "Sign Up" : "Sign In") {
                            performAuth()
                        }
                        .disabled(authEmail.isEmpty || authPassword.isEmpty || isAuthLoading)

                        if isAuthLoading {
                            ProgressView()
                                .controlSize(.small)
                                .scaleEffect(0.7)
                        }

                        Spacer()

                        Button(isSignUp ? "Already have an account" : "Create an account") {
                            isSignUp.toggle()
                            authError = nil
                        }
                        .font(.system(size: 11))
                        .foregroundColor(.accentColor)
                        .buttonStyle(.plain)
                    }
                }
                .padding(8)
            }
        }
    }

    // MARK: - Authenticated

    private var authenticatedSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            // User info
            GroupBox("Account") {
                VStack(alignment: .leading, spacing: 8) {
                    if let user = premiumService.status.user {
                        HStack(spacing: 10) {
                            Text(user.displayName.prefix(2).uppercased())
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(.white)
                                .frame(width: 32, height: 32)
                                .background(Circle().fill(Color.accentColor))

                            VStack(alignment: .leading, spacing: 2) {
                                Text(user.displayName)
                                    .font(.system(size: 13, weight: .medium))
                                Text(user.email)
                                    .font(.system(size: 11))
                                    .foregroundColor(.secondary)
                            }

                            Spacer()

                            Button("Sign Out") {
                                premiumService.signOut()
                            }
                            .font(.system(size: 11))
                            .foregroundColor(.red)
                        }
                    } else if premiumService.isRestoringSession {
                        HStack(spacing: 8) {
                            ProgressView()
                                .controlSize(.small)
                                .scaleEffect(0.7)
                            Text("Loading profile...")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Could not load profile. Check your connection and retry.")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                            HStack {
                                Button {
                                    Task { await premiumService.ensureProfileLoaded() }
                                } label: {
                                    Label("Retry", systemImage: "arrow.clockwise")
                                }
                                .font(.system(size: 11))
                                .foregroundColor(.accentColor)
                                Spacer()
                                Button("Sign Out") {
                                    premiumService.signOut()
                                }
                                .font(.system(size: 10))
                                .foregroundColor(.secondary)
                            }
                        }
                    }
                }
                .padding(8)
            }

            // Pending invites — always show if available
            if premiumService.status.team == nil && !pendingInvites.isEmpty {
                invitesSection
            }

            // Team exists: full management
            if let team = premiumService.status.team {
                teamSection(team)
                cloudSyncSection(team)
                teamProjectsSection(team)
                ossGrantSection(team)
            }
            // No team + not paid: paywall
            else if !premiumService.status.subscriptionActive {
                paywallSection
            }
            // Paid + no team: create team
            else {
                createTeamSection
            }
        }
        .task {
            // Ensure profile is loaded when this view appears
            await premiumService.ensureProfileLoaded()
            if premiumService.status.team == nil {
                await loadPendingInvites()
            }
        }
    }

    // MARK: - Pending Invites

    private var invitesSection: some View {
        GroupBox("Team Invitations") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(pendingInvites) { invite in
                    HStack(spacing: 10) {
                        Image(systemName: "envelope.badge")
                            .font(.system(size: 14))
                            .foregroundColor(.orange)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(invite.teamName)
                                .font(.system(size: 12, weight: .medium))
                            Text("Invited as \(invite.role)")
                                .font(.system(size: 10))
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        Button("Join Team") {
                            joinTeam(inviteId: invite.id)
                        }
                        .disabled(isJoining)
                        .font(.system(size: 11))
                    }
                    .padding(.vertical, 4)
                }
            }
            .padding(8)
        }
    }

    // MARK: - Paywall

    private var paywallSection: some View {
        GroupBox("Subscribe to Teams") {
            VStack(alignment: .leading, spacing: 12) {
                Text("A subscription is required to create a team and enable collaboration features.")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)

                Picker("Plan", selection: $selectedPlan) {
                    Text("Starter — $9/mo").tag("starter")
                    Text("Agency — $40/mo").tag("agency")
                }
                .pickerStyle(.segmented)
                .font(.system(size: 11))

                HStack {
                    Text("Extra seats: \(extraSeats)")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                    Slider(value: Binding(
                        get: { Double(extraSeats) },
                        set: { extraSeats = Int($0) }
                    ), in: 0...20, step: 1)
                }

                Button {
                    openUserCheckout()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "creditcard")
                        Text(isBillingLoading ? "Opening..." : "Subscribe")
                    }
                }
                .disabled(isBillingLoading)
                .font(.system(size: 12))
            }
            .padding(8)
        }
    }

    // MARK: - Team Section

    private func teamSection(_ team: Team) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            GroupBox("Team: \(team.name)") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label(team.plan.capitalized, systemImage: "crown")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.orange)

                        Spacer()

                        Text("\(members.count)/\(team.seatLimit) seats")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }

                    Divider()

                    // Member list
                    ForEach(members, id: \.userId) { member in
                        HStack(spacing: 8) {
                            if let user = member.user {
                                Text(user.displayName.prefix(2).uppercased())
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(.white)
                                    .frame(width: 22, height: 22)
                                    .background(Circle().fill(Color.accentColor.opacity(0.8)))

                                VStack(alignment: .leading, spacing: 1) {
                                    Text(user.displayName)
                                        .font(.system(size: 12))
                                    Text(user.email)
                                        .font(.system(size: 10))
                                        .foregroundColor(.secondary)
                                }
                            } else {
                                Text("?")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(.white)
                                    .frame(width: 22, height: 22)
                                    .background(Circle().fill(Color.secondary))

                                Text(member.userId)
                                    .font(.system(size: 12))
                            }

                            Spacer()

                            Text(member.role)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(.secondary)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(
                                    Capsule()
                                        .fill(Color(nsColor: .separatorColor).opacity(0.2))
                                )

                            if member.role != "owner" && team.ownerId == premiumService.status.user?.id {
                                Button {
                                    removeMember(member)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundColor(.secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    Divider()

                    // Invite form
                    HStack(spacing: 6) {
                        TextField("Email to invite", text: $inviteEmail)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12))

                        Picker("Role", selection: $inviteRole) {
                            Text("Member").tag("member")
                            Text("Admin").tag("admin")
                        }
                        .frame(width: 100)
                        .font(.system(size: 11))

                        Button("Invite") {
                            inviteMember()
                        }
                        .disabled(inviteEmail.trimmingCharacters(in: .whitespaces).isEmpty || isInviting)
                        .font(.system(size: 11))
                    }

                    if let success = inviteSuccess {
                        Text(success)
                            .font(.system(size: 11))
                            .foregroundColor(.green)
                    }
                    if let error = inviteError {
                        Text(error)
                            .font(.system(size: 11))
                            .foregroundColor(.red)
                    }

                    // Billing
                    HStack(spacing: 12) {
                        Button("Subscribe") {
                            openCheckout(team)
                        }
                        .font(.system(size: 11))
                        .buttonStyle(.plain)
                        .foregroundColor(.orange)

                        Button("Manage Billing") {
                            // Opens web billing portal
                            if let url = URL(string: "https://codefire.app/billing?team=\(team.id)") {
                                NSWorkspace.shared.open(url)
                            }
                        }
                        .font(.system(size: 11))
                        .buttonStyle(.plain)
                        .foregroundColor(.accentColor)
                    }
                }
                .padding(8)
            }
        }
        .task {
            await loadMembers()
        }
    }

    // MARK: - Cloud Sync

    private func cloudSyncSection(_ team: Team) -> some View {
        GroupBox("Cloud Sync") {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Toggle("Enable Cloud Sync", isOn: Binding(
                        get: { premiumService.status.syncEnabled },
                        set: { enabled in
                            if enabled {
                                SyncEngine.shared.start()
                                premiumService.status.syncEnabled = true
                                SharedServices.shared.appSettings.cloudSyncEnabled = true
                            } else {
                                SyncEngine.shared.stop()
                                premiumService.status.syncEnabled = false
                                SharedServices.shared.appSettings.cloudSyncEnabled = false
                            }
                        }
                    ))
                    .toggleStyle(.switch)
                    .font(.system(size: 12))
                }

                if premiumService.status.syncEnabled {
                    // Status row
                    HStack(spacing: 8) {
                        syncStatusIndicator
                        Spacer()
                        if let lastSync = syncEngine.lastSyncedAt {
                            Text("Last sync: \(lastSync, style: .relative) ago")
                                .font(.system(size: 10))
                                .foregroundColor(.secondary)
                        }

                        Button {
                            Task { await syncEngine.syncAllProjects() }
                        } label: {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 11))
                        }
                        .buttonStyle(.plain)
                        .foregroundColor(.accentColor)
                        .disabled(syncEngine.status == .syncing)
                    }

                    Divider()

                    Text("Tasks and notes in synced projects are shared with your team in real time.")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)

                    if syncEngine.realtimeConnected {
                        Label("Realtime connected", systemImage: "bolt.fill")
                            .font(.system(size: 10))
                            .foregroundColor(.green)
                    }

                    if let error = syncError {
                        Text(error)
                            .font(.system(size: 11))
                            .foregroundColor(.red)
                    }
                }
            }
            .padding(8)
        }
    }

    @ViewBuilder
    private var syncStatusIndicator: some View {
        switch syncEngine.status {
        case .idle:
            Label("Synced", systemImage: "checkmark.circle.fill")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.green)
        case .syncing:
            HStack(spacing: 4) {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.6)
                Text("Syncing...")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
        case .error(let msg):
            Label("Error", systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.red)
                .help(msg)
        case .offline:
            Label("Offline", systemImage: "wifi.slash")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.orange)
        }
    }

    // MARK: - Team Projects

    private func teamProjectsSection(_ team: Team) -> some View {
        GroupBox("Team Projects") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Share projects with your team to sync tasks and notes. Invite team members to collaborate on any project.")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)

                if let msg = projectInviteMessage {
                    Text(msg)
                        .font(.system(size: 11))
                        .foregroundColor(msg.hasPrefix("Failed") ? .red : .green)
                }

                if localProjects.isEmpty {
                    Text("No projects discovered yet.")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .italic()
                } else {
                    ForEach(localProjects, id: \.id) { project in
                        HStack(spacing: 8) {
                            Image(systemName: syncedProjectIds.contains(project.id) ? "folder.badge.person.crop" : "folder")
                                .font(.system(size: 12))
                                .foregroundColor(syncedProjectIds.contains(project.id) ? .green : .secondary)
                                .frame(width: 16)

                            VStack(alignment: .leading, spacing: 1) {
                                Text(project.name)
                                    .font(.system(size: 12, weight: .medium))
                                if syncedProjectIds.contains(project.id) {
                                    Text("Synced with team")
                                        .font(.system(size: 9))
                                        .foregroundColor(.green)
                                }
                            }

                            Spacer()

                            Button {
                                Task { await inviteTeamToProject(team: team, project: project) }
                            } label: {
                                HStack(spacing: 4) {
                                    if invitingProjectId == project.id {
                                        ProgressView().controlSize(.small).scaleEffect(0.5)
                                    } else {
                                        Image(systemName: "person.badge.plus")
                                            .font(.system(size: 10))
                                    }
                                    Text(syncedProjectIds.contains(project.id) ? "Re-invite Team" : "Invite Team Members")
                                        .font(.system(size: 10, weight: .medium))
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.accentColor)
                            .controlSize(.small)
                            .disabled(invitingProjectId == project.id)
                        }
                        .padding(.vertical, 4)
                        .padding(.horizontal, 6)
                        .background(Color(nsColor: .controlBackgroundColor).opacity(0.3))
                        .cornerRadius(6)
                    }
                }
            }
            .padding(8)
        }
        .task {
            await loadLocalProjects(teamId: team.id)
        }
    }

    private func loadLocalProjects(teamId: String) async {
        do {
            let projects: [(id: String, name: String, repoUrl: String?)] = try await DatabaseService.shared.dbQueue.read { db in
                try Row.fetchAll(db, sql: "SELECT id, name, repoUrl FROM projects WHERE id != '__global__' ORDER BY name")
                    .map { (id: $0["id"], name: $0["name"], repoUrl: $0["repoUrl"]) }
            }
            localProjects = projects

            // Fetch synced project IDs from Supabase
            let data = try await premiumService.supabaseGetPublic(
                "synced_projects",
                queryParams: [
                    ("team_id", "eq.\(teamId)"),
                    ("select", "id"),
                ]
            )
            if let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                syncedProjectIds = Set(rows.compactMap { $0["id"] as? String })
            }
        } catch {
            // Non-fatal
        }
    }

    private func inviteTeamToProject(team: Team, project: (id: String, name: String, repoUrl: String?)) async {
        invitingProjectId = project.id
        projectInviteMessage = nil
        do {
            try await premiumService.syncProject(teamId: team.id, projectId: project.id, name: project.name, repoUrl: project.repoUrl)

            // Send notifications to other team members
            let otherMembers = members.filter { $0.userId != premiumService.status.user?.id }
            if !otherMembers.isEmpty {
                let senderName = premiumService.status.user?.displayName ?? "A team member"
                for member in otherMembers {
                    _ = try? await premiumService.supabaseInsertPublic("notifications", body: [
                        "user_id": member.userId,
                        "project_id": project.id,
                        "type": "project_invite",
                        "title": "Project invite: \(project.name)",
                        "body": "\(senderName) invited you to collaborate on \"\(project.name)\"",
                        "entity_type": "project",
                        "entity_id": project.id,
                        "is_read": false,
                    ])
                }
            }

            syncedProjectIds.insert(project.id)
            projectInviteMessage = "Invited \(otherMembers.count) team member\(otherMembers.count == 1 ? "" : "s") to \"\(project.name)\""
        } catch {
            projectInviteMessage = "Failed: \(error.localizedDescription)"
        }
        invitingProjectId = nil
    }

    // MARK: - OSS Grant

    private func ossGrantSection(_ team: Team) -> some View {
        GroupBox("Open Source Grant") {
            VStack(alignment: .leading, spacing: 10) {
                if let grant = premiumService.status.grant {
                    // Show existing grant
                    HStack {
                        Label(grant.grantType.replacingOccurrences(of: "_", with: " ").capitalized,
                              systemImage: "heart.fill")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.pink)

                        Spacer()

                        Text(grant.planTier.capitalized + " plan")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }

                    if let repo = grant.repoUrl {
                        Text(repo)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.secondary)
                    }

                    if let expires = grant.expiresAt {
                        Text("Expires: \(expires)")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                    }

                    if let note = grant.note {
                        Text(note)
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                            .italic()
                    }
                } else {
                    // Submit grant request
                    Text("Open source projects and contributors can apply for a free plan upgrade.")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)

                    Picker("Type", selection: $ossGrantType) {
                        Text("OSS Project").tag("oss_project")
                        Text("OSS Contributor").tag("oss_contributor")
                    }
                    .pickerStyle(.segmented)
                    .font(.system(size: 11))

                    TextField("Repository URL (e.g. github.com/org/repo)", text: $ossRepoUrl)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12))

                    if let msg = ossMessage {
                        Text(msg)
                            .font(.system(size: 11))
                            .foregroundColor(msg.contains("submitted") ? .green : .red)
                    }

                    HStack {
                        Button("Submit Request") {
                            submitOSSGrant(team)
                        }
                        .disabled(ossRepoUrl.trimmingCharacters(in: .whitespaces).isEmpty || ossSubmitting)
                        .font(.system(size: 11))

                        if ossSubmitting {
                            ProgressView()
                                .controlSize(.small)
                                .scaleEffect(0.7)
                        }
                    }
                }
            }
            .padding(8)
        }
    }

    // MARK: - Create Team

    private var createTeamSection: some View {
        GroupBox("Create a Team") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Create a team to collaborate with others on projects.")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)

                TextField("Team Name", text: $newTeamName)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))

                if let error = createTeamError {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(.red)
                }

                HStack {
                    Button("Create Team") {
                        createTeam()
                    }
                    .disabled(newTeamName.trimmingCharacters(in: .whitespaces).isEmpty || isCreatingTeam)

                    if isCreatingTeam {
                        ProgressView()
                            .controlSize(.small)
                            .scaleEffect(0.7)
                    }
                }
            }
            .padding(8)
        }
    }

    // MARK: - Actions

    private func performAuth() {
        isAuthLoading = true
        authError = nil
        Task {
            do {
                if isSignUp {
                    try await premiumService.signUp(email: authEmail, password: authPassword, displayName: authDisplayName)
                } else {
                    try await premiumService.signIn(email: authEmail, password: authPassword)
                }
            } catch {
                authError = error.localizedDescription
            }
            isAuthLoading = false
        }
    }

    private func loadMembers() async {
        guard let team = premiumService.status.team else { return }
        do {
            members = try await premiumService.listMembers(teamId: team.id)
        } catch {
            print("TeamSettings: failed to load members: \(error)")
        }
    }

    private func inviteMember() {
        guard let team = premiumService.status.team else { return }

        // Check seat limit (super admins bypass)
        if !premiumService.isSuperAdmin,
           case .blocked(let reason) = enforcer.canAddMember(currentCount: members.count) {
            planBlock = reason
            return
        }

        inviteSuccess = nil
        inviteError = nil
        isInviting = true
        let emailToInvite = inviteEmail.trimmingCharacters(in: .whitespaces)
        Task {
            do {
                try await premiumService.inviteMember(teamId: team.id, email: emailToInvite, role: inviteRole)
                inviteEmail = ""
                inviteSuccess = "Invite sent to \(emailToInvite)"
                await loadMembers()
            } catch {
                inviteError = "Failed to send invite: \(error.localizedDescription)"
                print("TeamSettings: failed to invite: \(error)")
            }
            isInviting = false
        }
    }

    private func removeMember(_ member: TeamMember) {
        guard let team = premiumService.status.team else { return }
        Task {
            do {
                try await premiumService.removeMember(teamId: team.id, userId: member.userId)
                await loadMembers()
            } catch {
                print("TeamSettings: failed to remove member: \(error)")
            }
        }
    }

    private func createTeam() {
        isCreatingTeam = true
        Task {
            do {
                let slug = newTeamName.lowercased()
                    .replacingOccurrences(of: " ", with: "-")
                    .filter { $0.isLetter || $0.isNumber || $0 == "-" }
                try await premiumService.createTeam(name: newTeamName, slug: slug)
                newTeamName = ""
            } catch {
                createTeamError = "\(error)"
                print("TeamSettings: failed to create team: \(error)")
            }
            isCreatingTeam = false
        }
    }

    private func submitOSSGrant(_ team: Team) {
        ossSubmitting = true
        ossMessage = nil
        Task {
            do {
                try await premiumService.requestOSSGrant(
                    teamId: team.id,
                    grantType: ossGrantType,
                    repoUrl: ossRepoUrl.trimmingCharacters(in: .whitespaces)
                )
                ossMessage = "Request submitted! We'll review it shortly."
                ossRepoUrl = ""
            } catch {
                ossMessage = error.localizedDescription
            }
            ossSubmitting = false
        }
    }

    private func openCheckout(_ team: Team) {
        Task {
            do {
                let url = try await premiumService.createCheckout(teamId: team.id, plan: "starter", extraSeats: 0)
                NSWorkspace.shared.open(url)
            } catch {
                print("TeamSettings: failed to open checkout: \(error)")
            }
        }
    }

    private func openUserCheckout() {
        isBillingLoading = true
        Task {
            do {
                let url = try await premiumService.createCheckout(teamId: nil, plan: selectedPlan, extraSeats: extraSeats)
                NSWorkspace.shared.open(url)
            } catch {
                print("TeamSettings: failed to open checkout: \(error)")
            }
            isBillingLoading = false
        }
    }

    private func openBilling(_ team: Team) {
        Task {
            do {
                let url = try await premiumService.getBillingPortal(teamId: team.id)
                NSWorkspace.shared.open(url)
            } catch {
                print("TeamSettings: failed to open billing: \(error)")
            }
        }
    }

    private func loadPendingInvites() async {
        do {
            pendingInvites = try await premiumService.getMyInvites()
        } catch {
            print("TeamSettings: failed to load invites: \(error)")
        }
    }

    private func joinTeam(inviteId: String) {
        isJoining = true
        Task {
            do {
                try await premiumService.acceptInviteById(inviteId: inviteId)
                pendingInvites = []
                settings.premiumEnabled = true
            } catch {
                print("TeamSettings: failed to join team: \(error)")
            }
            isJoining = false
        }
    }
}

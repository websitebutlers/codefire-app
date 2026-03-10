import Foundation
import GRDB
import Network

/// Syncs local tasks/notes to Supabase for team collaboration.
/// Uses push-then-pull with last-write-wins conflict resolution.
@MainActor
class SyncEngine: ObservableObject {
    static let shared = SyncEngine()

    enum Status: Equatable {
        case idle
        case syncing
        case error(String)
        case offline
    }

    @Published var status: Status = .idle
    @Published var lastSyncedAt: Date?
    @Published var realtimeConnected: Bool = false
    @Published var isOnline: Bool = true

    private var syncTimer: Timer?
    private var isSyncing = false
    private var realtimeClient: RealtimeClient?
    private var currentMappings: [(localId: String, remoteId: String)] = []
    private var networkMonitor: NWPathMonitor?
    private let networkQueue = DispatchQueue(label: "com.codefire.sync.network")
    private var wasOffline = false

    private var premium: PremiumService { PremiumService.shared }
    private var db: DatabaseQueue { DatabaseService.shared.dbQueue }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private init() {}

    // MARK: - Lifecycle

    /// Start periodic sync + realtime subscriptions + network monitoring.
    func start(interval: TimeInterval = 30) {
        stop()
        startNetworkMonitoring()
        syncTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                await self.syncAllProjects()
            }
        }
        Task {
            await syncAllProjects()
            await connectRealtime()
        }
    }

    func stop() {
        syncTimer?.invalidate()
        syncTimer = nil
        disconnectRealtime()
        stopNetworkMonitoring()
    }

    // MARK: - Network Monitoring

    private func startNetworkMonitoring() {
        let monitor = NWPathMonitor()
        self.networkMonitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let online = path.status == .satisfied
                let previouslyOnline = self.isOnline
                self.isOnline = online

                if online && !previouslyOnline {
                    // Came back online — flush dirty records and reconnect realtime
                    print("SyncEngine: back online — flushing dirty records")
                    self.status = .syncing
                    self.wasOffline = true
                    await self.syncAllProjects()
                    await self.connectRealtime()
                } else if !online && previouslyOnline {
                    // Went offline
                    print("SyncEngine: offline — pausing sync, changes will accumulate locally")
                    self.status = .offline
                    self.disconnectRealtime()
                }
            }
        }
        monitor.start(queue: networkQueue)
    }

    private func stopNetworkMonitoring() {
        networkMonitor?.cancel()
        networkMonitor = nil
    }

    // MARK: - Realtime

    /// Connect to Supabase Realtime and subscribe to synced table changes.
    private func connectRealtime() async {
        let baseURL = premium.supabaseBaseURL
        let anonKey = premium.supabaseAnonKeyValue
        guard !baseURL.isEmpty, !anonKey.isEmpty else { return }

        let client = RealtimeClient(supabaseUrl: baseURL, anonKey: anonKey)
        self.realtimeClient = client

        client.onStateChange = { [weak self] state in
            Task { @MainActor in
                self?.realtimeConnected = (state == .connected)
            }
        }

        // Subscribe to changes on synced tables
        client.subscribe(table: "synced_tasks") { [weak self] change in
            Task { @MainActor in
                await self?.handleRealtimeChange(change, entityType: .task)
            }
        }
        client.subscribe(table: "synced_notes") { [weak self] change in
            Task { @MainActor in
                await self?.handleRealtimeChange(change, entityType: .note)
            }
        }
        client.subscribe(table: "synced_task_notes") { [weak self] change in
            Task { @MainActor in
                await self?.handleRealtimeChange(change, entityType: .taskNote)
            }
        }

        client.connect(accessToken: premium.currentAccessToken)
    }

    private func disconnectRealtime() {
        realtimeClient?.disconnect()
        realtimeClient = nil
        realtimeConnected = false
    }

    /// Handle an incoming realtime change by triggering a targeted pull.
    private func handleRealtimeChange(_ change: RealtimeClient.Change, entityType: SyncState.EntityType) async {
        // Find which project mapping this change belongs to
        guard let record = change.record ?? change.oldRecord,
              let remoteProjectId = record["project_id"] as? String else { return }

        // Refresh mappings if empty
        if currentMappings.isEmpty {
            currentMappings = (try? await fetchSyncedProjectMappings()) ?? []
        }

        guard let mapping = currentMappings.first(where: { $0.remoteId == remoteProjectId }) else { return }

        do {
            switch entityType {
            case .task:
                try await pullRemoteTasks(projectId: mapping.localId, remoteProjectId: mapping.remoteId)
            case .note:
                try await pullRemoteNotes(projectId: mapping.localId, remoteProjectId: mapping.remoteId)
            case .taskNote:
                break // Task notes are pulled with their parent tasks
            }
        } catch {
            print("SyncEngine: realtime pull failed: \(error)")
        }
    }

    /// Sync all projects that have cloud sync enabled.
    func syncAllProjects() async {
        guard premium.status.authenticated,
              premium.status.team != nil,
              !isSyncing,
              isOnline else { return }

        isSyncing = true
        status = .syncing

        do {
            currentMappings = try await fetchSyncedProjectMappings()
            let projectMappings = currentMappings
            for (localProjectId, remoteProjectId) in projectMappings {
                try await syncProject(localId: localProjectId, remoteId: remoteProjectId)
            }
            status = .idle
            lastSyncedAt = Date()
        } catch {
            status = .error(error.localizedDescription)
            print("SyncEngine: sync failed: \(error)")
        }

        isSyncing = false
    }

    func syncProject(localId: String, remoteId: String) async throws {
        try await pushDirtyTasks(projectId: localId, remoteProjectId: remoteId)
        try await pushDirtyNotes(projectId: localId, remoteProjectId: remoteId)
        try await pushDirtyTaskNotes(projectId: localId, remoteProjectId: remoteId)
        try await pullRemoteTasks(projectId: localId, remoteProjectId: remoteId)
        try await pullRemoteNotes(projectId: localId, remoteProjectId: remoteId)
    }

    // MARK: - Push: Tasks

    private func pushDirtyTasks(projectId: String, remoteProjectId: String) async throws {
        let dirtyRecords = try await db.read { db in
            try SyncState.dirtyRecords(projectId: projectId, entityType: .task, in: db)
        }

        guard let userId = premium.status.user?.id else { return }

        for record in dirtyRecords {
            if record.isDeleted == 1 {
                if let remoteId = record.remoteId {
                    try await premium.supabaseDeletePublic("synced_tasks", id: remoteId)
                }
                guard let localIdInt = Int64(record.localId) else { continue }
                try await db.write { db in
                    try SyncState.purgeDeleted(entityType: .task, localId: localIdInt, in: db)
                }
            } else {
                guard let localIdInt = Int64(record.localId) else { continue }
                let task = try await db.read { db in
                    try TaskItem.fetchOne(db, key: localIdInt)
                }
                guard let task else { continue }

                var body: [String: Any] = [
                    "project_id": remoteProjectId,
                    "local_id": task.id!,
                    "title": task.title,
                    "status": task.status,
                    "priority": task.priority,
                    "source": task.source,
                    "created_by": userId,
                    "created_at": Self.iso.string(from: task.createdAt),
                    "updated_at": Self.iso.string(from: task.updatedAt ?? task.createdAt),
                ]
                if let desc = task.description { body["description"] = desc }
                if let completedAt = task.completedAt {
                    body["completed_at"] = Self.iso.string(from: completedAt)
                }
                if let labels = task.labels,
                   let data = labels.data(using: .utf8),
                   let arr = try? JSONSerialization.jsonObject(with: data) {
                    body["labels"] = arr
                }

                let remoteId: String
                if let existingRemoteId = record.remoteId {
                    remoteId = existingRemoteId
                    try await premium.supabaseUpsertPublic("synced_tasks", id: remoteId, body: body)
                } else {
                    let result = try await premium.supabaseInsertPublic("synced_tasks", body: body)
                    guard let id = result["id"] as? String else { continue }
                    remoteId = id
                }

                try await db.write { db in
                    try SyncState.markSynced(entityType: .task, localId: localIdInt, remoteId: remoteId, in: db)
                }
            }
        }
    }

    // MARK: - Push: Notes

    private func pushDirtyNotes(projectId: String, remoteProjectId: String) async throws {
        let dirtyRecords = try await db.read { db in
            try SyncState.dirtyRecords(projectId: projectId, entityType: .note, in: db)
        }

        guard let userId = premium.status.user?.id else { return }

        for record in dirtyRecords {
            if record.isDeleted == 1 {
                if let remoteId = record.remoteId {
                    try await premium.supabaseDeletePublic("synced_notes", id: remoteId)
                }
                guard let localIdInt = Int64(record.localId) else { continue }
                try await db.write { db in
                    try SyncState.purgeDeleted(entityType: .note, localId: localIdInt, in: db)
                }
            } else {
                guard let localIdInt = Int64(record.localId) else { continue }
                let note = try await db.read { db in
                    try Note.fetchOne(db, key: localIdInt)
                }
                guard let note else { continue }

                let body: [String: Any] = [
                    "project_id": remoteProjectId,
                    "title": note.title,
                    "content": note.content,
                    "pinned": note.pinned,
                    "created_by": userId,
                    "created_at": Self.iso.string(from: note.createdAt),
                    "updated_at": Self.iso.string(from: note.updatedAt),
                ]

                let remoteId: String
                if let existingRemoteId = record.remoteId {
                    remoteId = existingRemoteId
                    try await premium.supabaseUpsertPublic("synced_notes", id: remoteId, body: body)
                } else {
                    let result = try await premium.supabaseInsertPublic("synced_notes", body: body)
                    guard let id = result["id"] as? String else { continue }
                    remoteId = id
                }

                try await db.write { db in
                    try SyncState.markSynced(entityType: .note, localId: localIdInt, remoteId: remoteId, in: db)
                }
            }
        }
    }

    // MARK: - Push: Task Notes

    private func pushDirtyTaskNotes(projectId: String, remoteProjectId: String) async throws {
        let dirtyRecords = try await db.read { db in
            try SyncState.dirtyRecords(projectId: projectId, entityType: .taskNote, in: db)
        }

        guard let userId = premium.status.user?.id else { return }

        for record in dirtyRecords {
            if record.isDeleted == 1 {
                if let remoteId = record.remoteId {
                    try await premium.supabaseDeletePublic("synced_task_notes", id: remoteId)
                }
                guard let localIdInt = Int64(record.localId) else { continue }
                try await db.write { db in
                    try SyncState.purgeDeleted(entityType: .taskNote, localId: localIdInt, in: db)
                }
            } else {
                guard let localIdInt = Int64(record.localId) else { continue }
                let taskNote = try await db.read { db in
                    try TaskNote.fetchOne(db, key: localIdInt)
                }
                guard let taskNote else { continue }

                let remoteTaskId = try await db.read { db in
                    try SyncState.remoteId(forLocalId: taskNote.taskId, entityType: .task, in: db)
                }
                guard let remoteTaskId else { continue }

                var body: [String: Any] = [
                    "task_id": remoteTaskId,
                    "content": taskNote.content,
                    "source": taskNote.source,
                    "created_by": userId,
                    "created_at": Self.iso.string(from: taskNote.createdAt),
                ]
                let mentionIds = taskNote.mentionIds
                if !mentionIds.isEmpty {
                    body["mentions"] = mentionIds
                }

                let remoteId: String
                if let existingRemoteId = record.remoteId {
                    remoteId = existingRemoteId
                    try await premium.supabaseUpsertPublic("synced_task_notes", id: remoteId, body: body)
                } else {
                    let result = try await premium.supabaseInsertPublic("synced_task_notes", body: body)
                    guard let id = result["id"] as? String else { continue }
                    remoteId = id
                }

                try await db.write { db in
                    try SyncState.markSynced(entityType: .taskNote, localId: localIdInt, remoteId: remoteId, in: db)
                }
            }
        }
    }

    // MARK: - Pull: Tasks

    private func pullRemoteTasks(projectId: String, remoteProjectId: String) async throws {
        let data = try await premium.supabaseGetPublic(
            "synced_tasks",
            queryParams: [
                ("project_id", "eq.\(remoteProjectId)"),
                ("order", "updated_at.desc"),
            ]
        )

        guard let remoteTasks = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }

        try await db.write { db in
            for remote in remoteTasks {
                guard let remoteId = remote["id"] as? String else { continue }

                if let localId = try SyncState.localId(forRemoteId: remoteId, entityType: .task, in: db) {
                    let syncState = try SyncState.fetchOne(db, sql:
                        "SELECT * FROM syncState WHERE entityType = 'task' AND localId = CAST(? AS TEXT)",
                        arguments: [localId]
                    )

                    if let syncState, syncState.dirty == 1 {
                        let localTask = try TaskItem.fetchOne(db, key: localId)
                        let localUpdated = localTask?.updatedAt ?? localTask?.createdAt ?? Date.distantPast
                        let remoteUpdated = Self.parseDate(remote["updated_at"]) ?? Date.distantPast

                        if remoteUpdated > localUpdated {
                            try Self.applyRemoteTask(remote, localId: localId, in: db)
                            try db.execute(sql: "UPDATE syncState SET dirty = 0, lastSyncedAt = CURRENT_TIMESTAMP WHERE entityType = 'task' AND localId = CAST(? AS TEXT)", arguments: [localId])
                        }
                    } else {
                        try Self.applyRemoteTask(remote, localId: localId, in: db)
                        // Must reset dirty = 0 because applyRemoteTask triggers sync_task_dirty_update
                        try db.execute(sql: "UPDATE syncState SET dirty = 0, lastSyncedAt = CURRENT_TIMESTAMP WHERE entityType = 'task' AND localId = CAST(? AS TEXT)", arguments: [localId])
                    }
                } else {
                    let localId = try Self.createLocalTask(from: remote, projectId: projectId, in: db)
                    try SyncState.register(entityType: .task, localId: localId, projectId: projectId, in: db)
                    try SyncState.markSynced(entityType: .task, localId: localId, remoteId: remoteId, in: db)
                }
            }
        }
    }

    // MARK: - Pull: Notes

    private func pullRemoteNotes(projectId: String, remoteProjectId: String) async throws {
        let data = try await premium.supabaseGetPublic(
            "synced_notes",
            queryParams: [
                ("project_id", "eq.\(remoteProjectId)"),
                ("order", "updated_at.desc"),
            ]
        )

        guard let remoteNotes = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }

        try await db.write { db in
            for remote in remoteNotes {
                guard let remoteId = remote["id"] as? String else { continue }

                if let localId = try SyncState.localId(forRemoteId: remoteId, entityType: .note, in: db) {
                    let syncState = try SyncState.fetchOne(db, sql:
                        "SELECT * FROM syncState WHERE entityType = 'note' AND localId = CAST(? AS TEXT)",
                        arguments: [localId]
                    )

                    if let syncState, syncState.dirty == 1 {
                        let localNote = try Note.fetchOne(db, key: localId)
                        let localUpdated = localNote?.updatedAt ?? Date.distantPast
                        let remoteUpdated = Self.parseDate(remote["updated_at"]) ?? Date.distantPast

                        if remoteUpdated > localUpdated {
                            try Self.applyRemoteNote(remote, localId: localId, in: db)
                            try db.execute(sql: "UPDATE syncState SET dirty = 0, lastSyncedAt = CURRENT_TIMESTAMP WHERE entityType = 'note' AND localId = CAST(? AS TEXT)", arguments: [localId])
                        }
                    } else {
                        try Self.applyRemoteNote(remote, localId: localId, in: db)
                        // Must reset dirty = 0 because applyRemoteNote triggers sync_note_dirty_update
                        try db.execute(sql: "UPDATE syncState SET dirty = 0, lastSyncedAt = CURRENT_TIMESTAMP WHERE entityType = 'note' AND localId = CAST(? AS TEXT)", arguments: [localId])
                    }
                } else {
                    let localId = try Self.createLocalNote(from: remote, projectId: projectId, in: db)
                    try SyncState.register(entityType: .note, localId: localId, projectId: projectId, in: db)
                    try SyncState.markSynced(entityType: .note, localId: localId, remoteId: remoteId, in: db)
                }
            }
        }
    }

    // MARK: - Apply Remote → Local (static to avoid actor isolation in db closures)

    nonisolated private static func applyRemoteTask(_ remote: [String: Any], localId: Int64, in db: Database) throws {
        guard var task = try TaskItem.fetchOne(db, key: localId) else { return }
        task.title = remote["title"] as? String ?? task.title
        task.description = remote["description"] as? String
        task.status = remote["status"] as? String ?? task.status
        task.priority = remote["priority"] as? Int ?? task.priority
        if let labelsArr = remote["labels"] {
            if let data = try? JSONSerialization.data(withJSONObject: labelsArr),
               let str = String(data: data, encoding: .utf8) {
                task.labels = str
            }
        }
        if let completedStr = remote["completed_at"] as? String {
            task.completedAt = parseDate(completedStr)
        }
        task.updatedAt = parseDate(remote["updated_at"]) ?? Date()
        try task.update(db)
    }

    nonisolated private static func createLocalTask(from remote: [String: Any], projectId: String, in db: Database) throws -> Int64 {
        var task = TaskItem(
            projectId: projectId,
            title: remote["title"] as? String ?? "",
            description: remote["description"] as? String,
            status: remote["status"] as? String ?? "todo",
            priority: remote["priority"] as? Int ?? 0,
            source: remote["source"] as? String ?? "synced",
            createdAt: parseDate(remote["created_at"]) ?? Date(),
            completedAt: parseDate(remote["completed_at"])
        )
        task.updatedAt = parseDate(remote["updated_at"]) ?? Date()
        if let labelsArr = remote["labels"] {
            if let data = try? JSONSerialization.data(withJSONObject: labelsArr),
               let str = String(data: data, encoding: .utf8) {
                task.labels = str
            }
        }
        try task.insert(db)
        return task.id!
    }

    nonisolated private static func applyRemoteNote(_ remote: [String: Any], localId: Int64, in db: Database) throws {
        guard var note = try Note.fetchOne(db, key: localId) else { return }
        note.title = remote["title"] as? String ?? note.title
        note.content = remote["content"] as? String ?? note.content
        note.pinned = remote["pinned"] as? Bool ?? note.pinned
        note.updatedAt = parseDate(remote["updated_at"]) ?? Date()
        try note.update(db)
    }

    nonisolated private static func createLocalNote(from remote: [String: Any], projectId: String, in db: Database) throws -> Int64 {
        var note = Note(
            projectId: projectId,
            title: remote["title"] as? String ?? "",
            content: remote["content"] as? String ?? "",
            pinned: remote["pinned"] as? Bool ?? false,
            createdAt: parseDate(remote["created_at"]) ?? Date(),
            updatedAt: parseDate(remote["updated_at"]) ?? Date()
        )
        try note.insert(db)
        return note.id!
    }

    // MARK: - Project Mappings

    private func fetchSyncedProjectMappings() async throws -> [(localId: String, remoteId: String)] {
        guard let teamId = premium.status.team?.id else { return [] }

        let data = try await premium.supabaseGetPublic(
            "synced_projects",
            queryParams: [
                ("team_id", "eq.\(teamId)"),
                ("select", "id,name,repo_url"),
            ]
        )

        guard let projects = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }

        struct LocalProject {
            let id: String
            let name: String
            let repoUrl: String?
        }

        let localProjects: [LocalProject] = try await db.read { db in
            try Row.fetchAll(db, sql: "SELECT id, name, repoUrl FROM projects WHERE id != '__global__'")
                .map { LocalProject(id: $0["id"], name: $0["name"], repoUrl: $0["repoUrl"]) }
        }

        var mappings: [(String, String)] = []
        for remote in projects {
            guard let remoteId = remote["id"] as? String else { continue }
            let remoteRepoUrl = remote["repo_url"] as? String
            let remoteName = remote["name"] as? String

            // Match by normalized repo URL first (canonical team identifier),
            // then fall back to name match for projects without a repo.
            let match: LocalProject?
            if let remoteRepo = remoteRepoUrl, !remoteRepo.isEmpty {
                let normalizedRemote = ProjectDiscovery.normalizeGitUrl(remoteRepo)
                match = localProjects.first(where: {
                    guard let localRepo = $0.repoUrl else { return false }
                    return ProjectDiscovery.normalizeGitUrl(localRepo) == normalizedRemote
                })
            } else if let remoteName {
                match = localProjects.first(where: { $0.name == remoteName })
            } else {
                match = nil
            }

            if let local = match {
                mappings.append((local.id, remoteId))
            }
        }
        return mappings
    }

    // MARK: - Helpers

    nonisolated private static func parseDate(_ value: Any?) -> Date? {
        guard let str = value as? String else { return nil }
        return iso.date(from: str)
    }
}

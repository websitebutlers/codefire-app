import Foundation
import GRDB
import Combine

@MainActor
class GmailPoller: ObservableObject {
    @Published var isSyncing = false
    @Published var lastSyncDate: Date?
    @Published var lastError: String?
    @Published var newTaskCount: Int = 0
    @Published var syncLog: String = ""

    private var timer: Timer?
    private let oauthManager: GoogleOAuthManager
    private let apiService: GmailAPIService
    private var syncInterval: TimeInterval = 300

    init(oauthManager: GoogleOAuthManager) {
        self.oauthManager = oauthManager
        self.apiService = GmailAPIService(oauthManager: oauthManager)
    }

    func startPolling(interval: TimeInterval = 300) {
        syncInterval = interval
        timer?.invalidate()
        Task { await syncAllAccounts() }
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.syncAllAccounts()
            }
        }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    func syncNow() async {
        await syncAllAccounts()
    }

    /// Manual sync with a specific lookback duration. Ignores lastSyncAt.
    func syncWithLookback(hours: Int) async {
        guard !isSyncing else { return }
        isSyncing = true
        lastError = nil
        syncLog = ""
        var totalNew = 0

        do {
            let accounts = try await DatabaseService.shared.dbQueue.read { db in
                try GmailAccount.filter(Column("isActive") == true).fetchAll(db)
            }

            log("Found \(accounts.count) active account(s)")

            let lookback = Date().addingTimeInterval(-Double(hours * 3600))

            for account in accounts {
                let count = await syncAccount(account, after: lookback)
                totalNew += count
            }

            newTaskCount = totalNew
            lastSyncDate = Date()

            if totalNew > 0 {
                NotificationCenter.default.post(name: .tasksDidChange, object: nil)
            }
            NotificationCenter.default.post(name: .gmailDidSync, object: nil)

            log("Done — \(totalNew) new task(s) created")
        } catch {
            lastError = "Sync failed: \(error.localizedDescription)"
            log("ERROR: \(error.localizedDescription)")
        }

        isSyncing = false
    }

    // MARK: - Core Sync Loop

    private func syncAllAccounts() async {
        guard !isSyncing else { return }
        isSyncing = true
        lastError = nil
        syncLog = ""
        var totalNew = 0

        do {
            let accounts = try await DatabaseService.shared.dbQueue.read { db in
                try GmailAccount.filter(Column("isActive") == true).fetchAll(db)
            }

            for account in accounts {
                let after = account.lastSyncAt ?? Date().addingTimeInterval(-172800)
                let count = await syncAccount(account, after: after)
                totalNew += count
            }

            newTaskCount = totalNew
            lastSyncDate = Date()

            if totalNew > 0 {
                NotificationCenter.default.post(name: .tasksDidChange, object: nil)
            }
            NotificationCenter.default.post(name: .gmailDidSync, object: nil)
        } catch {
            lastError = "Sync failed: \(error.localizedDescription)"
            log("ERROR: \(error.localizedDescription)")
        }

        isSyncing = false
    }

    private func syncAccount(_ account: GmailAccount, after: Date) async -> Int {
        // Build query from whitelist rules so Gmail pre-filters to relevant senders
        let whitelistQuery = buildWhitelistQuery()
        guard !whitelistQuery.isEmpty else {
            log("[\(account.email)] No whitelist rules — skipping")
            updateLastSync(accountId: account.id)
            return 0
        }

        let query = "(\(whitelistQuery)) -from:me -in:sent -in:spam -in:trash"
        log("[\(account.email)] Query: \(query)")
        log("[\(account.email)] Looking back to \(after.formatted(.dateTime.month(.abbreviated).day().hour().minute()))")

        guard let listResponse = await apiService.listMessages(
            accountId: account.id,
            query: query,
            after: after,
            maxResults: 100
        ) else {
            log("[\(account.email)] Failed to list messages (API error or no token)")
            return 0
        }

        log("[\(account.email)] Gmail returned \(listResponse.messageIds.count) message(s)")

        let existingIds = getExistingMessageIds(for: account.id)
        let newMessageIds = listResponse.messageIds.filter { !existingIds.contains($0.id) }

        log("[\(account.email)] \(newMessageIds.count) new (not previously processed)")

        guard !newMessageIds.isEmpty else {
            updateLastSync(accountId: account.id)
            return 0
        }

        // Fetch full details for ALL matching messages (they're pre-filtered by whitelist)
        var messages: [GmailAPIService.GmailMessage] = []
        for (msgId, _) in newMessageIds {
            if let msg = await apiService.getMessage(id: msgId, accountId: account.id) {
                messages.append(msg)
            }
        }

        log("[\(account.email)] Fetched \(messages.count) full message(s)")

        // Double-check whitelist match (safety net — Gmail from: query is fuzzy)
        var whitelistedMessages: [(GmailAPIService.GmailMessage, WhitelistMatch)] = []
        for msg in messages {
            let senderEmail = WhitelistFilter.extractEmail(from: msg.from)
            if let match = WhitelistFilter.check(senderEmail: senderEmail) {
                whitelistedMessages.append((msg, match))
            } else {
                log("[\(account.email)] Skipped (no exact whitelist match): \(senderEmail)")
                // Save as skipped for dedup
                saveSkippedEmail(message: msg, accountId: account.id)
            }
        }

        log("[\(account.email)] \(whitelistedMessages.count) passed whitelist check")

        guard !whitelistedMessages.isEmpty else {
            updateLastSync(accountId: account.id)
            return 0
        }

        let triageInput = whitelistedMessages.map {
            (subject: $0.0.subject, from: $0.0.from, body: $0.0.body, isCalendar: $0.0.isCalendarInvite)
        }

        log("[\(account.email)] Triaging \(triageInput.count) email(s) with Claude…")

        let triageResults = await Task.detached {
            EmailTriageService.triageEmails(triageInput)
        }.value

        let actionableCount = triageResults.compactMap { $0 }.count
        if actionableCount == 0 && !triageResults.isEmpty {
            log("[\(account.email)] ⚠️ Triage returned no actionable emails — Claude CLI may not be reachable from app context")
        } else {
            log("[\(account.email)] Triage: \(actionableCount) actionable, \(triageResults.count - actionableCount) FYI")
        }

        var newTasks = 0
        for (i, (msg, match)) in whitelistedMessages.enumerated() {
            guard i < triageResults.count, let triage = triageResults[i] else {
                // Triage returned nil (not actionable) — still save the email
                saveProcessedEmail(
                    message: msg,
                    accountId: account.id,
                    taskId: nil,
                    triageType: "fyi"
                )
                log("[\(account.email)] FYI (not actionable): \(msg.subject)")
                continue
            }

            let taskId = await createTaskFromEmail(
                message: msg,
                triage: triage,
                match: match,
                accountId: account.id
            )

            saveProcessedEmail(
                message: msg,
                accountId: account.id,
                taskId: taskId,
                triageType: triage.type
            )

            log("[\(account.email)] Task created [\(triage.type)]: \(triage.title)")
            newTasks += 1
        }

        updateLastSync(accountId: account.id)
        return newTasks
    }

    // MARK: - Whitelist Query Builder

    /// Builds a Gmail `from:` query from whitelist rules.
    /// Example: "from:@10kadvertising.com OR from:nick@example.com"
    private func buildWhitelistQuery() -> String {
        do {
            let rules = try DatabaseService.shared.dbQueue.read { db in
                try WhitelistRule
                    .filter(Column("isActive") == true)
                    .fetchAll(db)
            }

            guard !rules.isEmpty else { return "" }

            let fromClauses = rules.map { rule -> String in
                let pattern = rule.pattern
                // @domain.com → from:domain.com  |  user@email.com → from:user@email.com
                if pattern.hasPrefix("@") {
                    return "from:\(String(pattern.dropFirst()))"
                }
                return "from:\(pattern)"
            }

            return fromClauses.joined(separator: " OR ")
        } catch {
            print("GmailPoller: failed to build whitelist query: \(error)")
            return ""
        }
    }

    // MARK: - Logging

    private func log(_ message: String) {
        let timestamp = Date().formatted(.dateTime.hour().minute().second())
        let line = "[\(timestamp)] \(message)"
        syncLog += line + "\n"
        print("GmailPoller: \(message)")
    }

    // MARK: - Database Helpers

    private func getExistingMessageIds(for accountId: String) -> Set<String> {
        do {
            let ids = try DatabaseService.shared.dbQueue.read { db in
                try String.fetchAll(db, sql:
                    "SELECT gmailMessageId FROM processedEmails WHERE gmailAccountId = ?",
                    arguments: [accountId]
                )
            }
            return Set(ids)
        } catch { return [] }
    }

    private func createTaskFromEmail(
        message: GmailAPIService.GmailMessage,
        triage: EmailTriageResult,
        match: WhitelistMatch,
        accountId: String
    ) async -> Int64? {
        let senderName = WhitelistFilter.extractName(from: message.from)
            ?? WhitelistFilter.extractEmail(from: message.from)

        var description = "From: \(senderName)\n"
        description += "Subject: \(message.subject)\n\n"
        if let triageDesc = triage.description {
            description += triageDesc
        }

        // Append full email body for complete context
        if !message.body.isEmpty {
            description += "\n\n---\n\n**Original Email:**\n\n"
            // Strip Gmail quoted replies (lines starting with ">")
            let lines = message.body.components(separatedBy: "\n")
            var originalLines: [String] = []
            for line in lines {
                if line.hasPrefix(">") { break }
                originalLines.append(line)
            }
            while originalLines.last?.trimmingCharacters(in: .whitespaces).isEmpty == true {
                originalLines.removeLast()
            }
            description += originalLines.joined(separator: "\n")
        }

        // Download attachments
        var savedPaths: [String] = []
        if !message.attachments.isEmpty {
            let attachDir = Self.attachmentsDirectory(for: message.id)
            for attachment in message.attachments {
                if let data = await apiService.getAttachment(
                    messageId: message.id,
                    attachmentId: attachment.attachmentId,
                    accountId: accountId
                ) {
                    let filePath = attachDir.appendingPathComponent(attachment.filename)
                    do {
                        try FileManager.default.createDirectory(at: attachDir, withIntermediateDirectories: true)
                        try data.write(to: filePath)
                        savedPaths.append(filePath.path)
                        log("  Saved attachment: \(attachment.filename) (\(data.count) bytes)")
                    } catch {
                        print("GmailPoller: failed to save attachment \(attachment.filename): \(error)")
                    }
                }
            }
        }

        var task = TaskItem(
            id: nil,
            projectId: "__global__",
            title: triage.title,
            description: description,
            status: "todo",
            priority: max(triage.priority, match.priority),
            sourceSession: nil,
            source: "email",
            createdAt: Date(),
            completedAt: nil,
            labels: nil,
            attachments: nil,
            isGlobal: true,
            gmailThreadId: message.threadId,
            gmailMessageId: message.id
        )

        var labels = [triage.type]
        if message.isCalendarInvite { labels.append("calendar") }
        task.setLabels(labels)
        if !savedPaths.isEmpty {
            task.setAttachments(savedPaths)
        }

        do {
            try await DatabaseService.shared.dbQueue.write { db in
                try task.insert(db)
            }
            return task.id
        } catch {
            print("GmailPoller: failed to create task: \(error)")
            return nil
        }
    }

    // MARK: - Attachments Directory

    nonisolated private static func attachmentsDirectory(for messageId: String) -> URL {
        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
        return appSupport
            .appendingPathComponent("Context/email-attachments", isDirectory: true)
            .appendingPathComponent(messageId, isDirectory: true)
    }

    private func saveProcessedEmail(
        message: GmailAPIService.GmailMessage,
        accountId: String,
        taskId: Int64?,
        triageType: String
    ) {
        var email = ProcessedEmail(
            id: nil,
            gmailMessageId: message.id,
            gmailThreadId: message.threadId,
            gmailAccountId: accountId,
            fromAddress: WhitelistFilter.extractEmail(from: message.from),
            fromName: WhitelistFilter.extractName(from: message.from),
            subject: message.subject,
            snippet: message.snippet,
            body: message.body,
            receivedAt: message.date,
            taskId: taskId,
            triageType: triageType,
            isRead: false,
            repliedAt: nil,
            importedAt: Date()
        )
        do {
            try DatabaseService.shared.dbQueue.write { db in
                try email.insert(db)
            }
        } catch {
            print("GmailPoller: failed to save processed email: \(error)")
        }
    }

    private func saveSkippedEmail(message: GmailAPIService.GmailMessage, accountId: String) {
        var email = ProcessedEmail(
            id: nil,
            gmailMessageId: message.id,
            gmailThreadId: message.threadId,
            gmailAccountId: accountId,
            fromAddress: WhitelistFilter.extractEmail(from: message.from),
            fromName: WhitelistFilter.extractName(from: message.from),
            subject: message.subject,
            snippet: message.snippet,
            body: nil,
            receivedAt: message.date,
            taskId: nil,
            triageType: "skipped",
            isRead: false,
            repliedAt: nil,
            importedAt: Date()
        )
        try? DatabaseService.shared.dbQueue.write { db in
            try email.insert(db)
        }
    }

    private func updateLastSync(accountId: String) {
        try? DatabaseService.shared.dbQueue.write { db in
            try db.execute(
                sql: "UPDATE gmailAccounts SET lastSyncAt = ? WHERE id = ?",
                arguments: [Date(), accountId]
            )
        }
    }
}

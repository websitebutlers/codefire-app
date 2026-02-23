import SwiftUI
import GRDB

struct RecentEmailsView: View {
    @EnvironmentObject var gmailPoller: GmailPoller
    @State private var emails: [ProcessedEmail] = []
    @State private var accounts: [GmailAccount] = []
    @State private var clientMap: [String: Client] = [:] // clientId → Client
    @State private var ruleMap: [String: WhitelistRule] = [:] // email-domain → rule (for client lookup)
    @State private var lookbackHours: Int = 48
    @State private var showLog = false
    @State private var selectedEmail: ProcessedEmail? = nil
    @State private var now = Date()
    private let clockTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    private let lookbackOptions: [(label: String, hours: Int)] = [
        ("6h", 6), ("12h", 12), ("24h", 24), ("48h", 48), ("7d", 168),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            header

            Divider()

            // Sync status bar
            if gmailPoller.isSyncing {
                syncStatusBar
            } else if let last = gmailPoller.lastSyncDate {
                lastSyncBar(last)
            }

            // Sync log (collapsible)
            if showLog && !gmailPoller.syncLog.isEmpty {
                syncLogView
                Divider()
            }

            // Content
            if let email = selectedEmail {
                EmailDetailView(
                    email: email,
                    client: clientForEmail(email),
                    onBack: { selectedEmail = nil },
                    onTaskCreated: { loadData() }
                )
            } else if accounts.isEmpty {
                noAccountsPlaceholder
            } else if emails.isEmpty && !gmailPoller.isSyncing {
                emptyPlaceholder
            } else if emails.isEmpty && gmailPoller.isSyncing {
                syncingPlaceholder
            } else {
                emailList
            }

            // Error banner
            if let error = gmailPoller.lastError {
                errorBanner(error)
            }
        }
        .background(Color(nsColor: .underPageBackgroundColor).opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onAppear { loadData() }
        .onReceive(NotificationCenter.default.publisher(for: .gmailDidSync)) { _ in
            loadData()
        }
        .onReceive(clockTimer) { _ in
            now = Date()
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "envelope.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.green)
            Text("Recent Emails")
                .font(.system(size: 12, weight: .semibold))

            Spacer()

            HStack(spacing: 2) {
                ForEach(lookbackOptions, id: \.hours) { option in
                    Button(option.label) {
                        lookbackHours = option.hours
                    }
                    .font(.system(size: 9, weight: lookbackHours == option.hours ? .bold : .regular))
                    .foregroundColor(lookbackHours == option.hours ? .accentColor : .secondary)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(
                        lookbackHours == option.hours
                            ? Color.accentColor.opacity(0.12)
                            : Color.clear,
                        in: RoundedRectangle(cornerRadius: 4)
                    )
                    .buttonStyle(.plain)
                }
            }

            Button {
                Task { await gmailPoller.syncWithLookback(hours: lookbackHours) }
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 10, weight: .medium))
                        .rotationEffect(.degrees(gmailPoller.isSyncing ? 360 : 0))
                        .animation(
                            gmailPoller.isSyncing
                                ? .linear(duration: 1).repeatForever(autoreverses: false)
                                : .default,
                            value: gmailPoller.isSyncing
                        )
                    Text("Sync")
                        .font(.system(size: 10, weight: .medium))
                }
                .foregroundColor(gmailPoller.isSyncing ? .secondary : .accentColor)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Color.accentColor.opacity(0.1), in: RoundedRectangle(cornerRadius: 5))
            }
            .buttonStyle(.plain)
            .disabled(gmailPoller.isSyncing)

            Text("\(emails.count)")
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundColor(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.secondary.opacity(0.12), in: Capsule())
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    // MARK: - Status Bars

    private var syncStatusBar: some View {
        HStack(spacing: 6) {
            ProgressView()
                .controlSize(.small)
                .scaleEffect(0.6)
            Text("Syncing\u{2026}")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.secondary)
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .background(Color.accentColor.opacity(0.04))
    }

    private func lastSyncBar(_ date: Date) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 9))
                .foregroundColor(.green)
            Text("Last sync: \(relativeTime(date))")
                .font(.system(size: 10))
                .foregroundColor(.secondary)
            Spacer()
            Button(showLog ? "Hide log" : "Show log") {
                showLog.toggle()
            }
            .font(.system(size: 9))
            .buttonStyle(.plain)
            .foregroundColor(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .background(Color.green.opacity(0.04))
    }

    private var syncLogView: some View {
        ScrollView {
            Text(gmailPoller.syncLog)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .frame(maxHeight: 120)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
    }

    private func errorBanner(_ error: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 9))
                .foregroundColor(.orange)
            Text(error)
                .font(.system(size: 10))
                .foregroundColor(.orange)
                .lineLimit(2)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.08))
    }

    // MARK: - Placeholders

    private var noAccountsPlaceholder: some View {
        VStack(spacing: 6) {
            Image(systemName: "envelope.badge.person.crop")
                .font(.system(size: 20))
                .foregroundColor(.secondary.opacity(0.4))
            Text("No Gmail accounts")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.secondary)
            Text("Add one in Settings \u{2192} Gmail")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyPlaceholder: some View {
        VStack(spacing: 6) {
            Image(systemName: "tray")
                .font(.system(size: 20))
                .foregroundColor(.secondary.opacity(0.4))
            Text("No emails yet")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.secondary)
            Text("Select a lookback and tap Sync")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var syncingPlaceholder: some View {
        VStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text("Syncing emails\u{2026}")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Email List

    private var emailList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(emails) { email in
                    emailRow(email)
                    if email.id != emails.last?.id {
                        Divider().padding(.leading, 12)
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    @ViewBuilder
    private func emailRow(_ email: ProcessedEmail) -> some View {
        Button {
            selectedEmail = email
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(email.fromName ?? email.fromAddress)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.primary)
                        .lineLimit(1)

                    // Client badge
                    if let client = clientForEmail(email) {
                        Text(client.name)
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(Color(hex: client.color) ?? .accentColor)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(
                                (Color(hex: client.color) ?? .accentColor).opacity(0.12),
                                in: Capsule()
                            )
                    }

                    Spacer()

                    if let triage = email.triageType, triage != "skipped" && triage != "fyi" {
                        Text(triage.uppercased())
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(triageColor(triage))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(triageColor(triage).opacity(0.12), in: Capsule())
                    }

                    if email.taskId != nil {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 9))
                            .foregroundColor(.green.opacity(0.7))
                    }

                    Text(relativeTime(email.receivedAt))
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundColor(.secondary.opacity(0.4))
                }

                Text(email.subject)
                    .font(.system(size: 11))
                    .foregroundColor(.primary.opacity(0.85))
                    .lineLimit(1)

                if let snippet = email.snippet, !snippet.isEmpty {
                    Text(snippet)
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            if hovering { NSCursor.pointingHand.push() } else { NSCursor.pop() }
        }
    }

    // MARK: - Helpers

    private func clientForEmail(_ email: ProcessedEmail) -> Client? {
        let addr = email.fromAddress.lowercased()
        // Check exact email match first, then domain
        for (pattern, rule) in ruleMap {
            if let clientId = rule.clientId {
                let pat = pattern.lowercased()
                if pat.hasPrefix("@") {
                    if addr.hasSuffix(pat), let client = clientMap[clientId] { return client }
                } else {
                    if addr == pat, let client = clientMap[clientId] { return client }
                }
            }
        }
        return nil
    }

    private func triageColor(_ type: String) -> Color {
        switch type {
        case "action", "task": return .orange
        case "reply", "question": return .blue
        case "review": return .purple
        case "calendar": return .indigo
        default: return .secondary
        }
    }

    private func relativeTime(_ date: Date) -> String {
        let interval = now.timeIntervalSince(date)
        if interval < 60 { return "just now" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86400 { return "\(Int(interval / 3600))h ago" }
        return "\(Int(interval / 86400))d ago"
    }

    private func loadData() {
        do {
            emails = try DatabaseService.shared.dbQueue.read { db in
                try ProcessedEmail
                    .filter(Column("triageType") != "skipped")
                    .order(Column("receivedAt").desc)
                    .limit(100)
                    .fetchAll(db)
            }
            accounts = try DatabaseService.shared.dbQueue.read { db in
                try GmailAccount.fetchAll(db)
            }
            let clients = try DatabaseService.shared.dbQueue.read { db in
                try Client.fetchAll(db)
            }
            clientMap = Dictionary(uniqueKeysWithValues: clients.map { ($0.id, $0) })
            let rules = try DatabaseService.shared.dbQueue.read { db in
                try WhitelistRule.fetchAll(db)
            }
            ruleMap = Dictionary(uniqueKeysWithValues: rules.map { ($0.pattern, $0) })
        } catch {
            print("RecentEmailsView: failed to load: \(error)")
        }
    }
}

// MARK: - Email Detail View

private struct EmailDetailView: View {
    let email: ProcessedEmail
    let client: Client?
    let onBack: () -> Void
    let onTaskCreated: () -> Void

    @State private var taskCreated = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Back button
            Button(action: onBack) {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 10, weight: .semibold))
                    Text("Back")
                        .font(.system(size: 11, weight: .medium))
                }
                .foregroundColor(.accentColor)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // Sender + client
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(email.fromName ?? email.fromAddress)
                                .font(.system(size: 13, weight: .semibold))
                            Text(email.fromAddress)
                                .font(.system(size: 10))
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        if let client {
                            Text(client.name)
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(Color(hex: client.color) ?? .accentColor)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(
                                    (Color(hex: client.color) ?? .accentColor).opacity(0.12),
                                    in: Capsule()
                                )
                        }
                    }

                    // Subject
                    Text(email.subject)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.primary)

                    // Date
                    Text(email.receivedAt.formatted(.dateTime.weekday(.wide).month(.abbreviated).day().hour().minute()))
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)

                    Divider()

                    // Body
                    if let body = email.body, !body.isEmpty {
                        Text(body)
                            .font(.system(size: 11))
                            .foregroundColor(.primary.opacity(0.9))
                            .textSelection(.enabled)
                    } else if let snippet = email.snippet, !snippet.isEmpty {
                        Text(snippet)
                            .font(.system(size: 11))
                            .foregroundColor(.primary.opacity(0.9))
                            .textSelection(.enabled)
                    } else {
                        Text("No body content available")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                }
                .padding(12)
            }

            Divider()

            // Action bar
            HStack(spacing: 12) {
                if email.taskId != nil || taskCreated {
                    Label("Task created", systemImage: "checkmark.circle.fill")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.green)
                } else {
                    Button(action: createTask) {
                        Label("Create Task", systemImage: "plus.circle.fill")
                            .font(.system(size: 11, weight: .medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.accentColor)
                }

                if let err = errorMessage {
                    Text(err)
                        .font(.system(size: 9))
                        .foregroundColor(.red)
                        .lineLimit(1)
                }

                Spacer()

                if let threadId = email.gmailThreadId.nilIfEmpty {
                    Button {
                        let url = URL(string: "https://mail.google.com/mail/u/0/#inbox/\(threadId)")!
                        NSWorkspace.shared.open(url)
                    } label: {
                        Label("Open in Gmail", systemImage: "arrow.up.right.square")
                            .font(.system(size: 11, weight: .medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }

    private func createTask() {
        print("EmailDetail: createTask() called for: \(email.subject)")
        let senderName = email.fromName ?? email.fromAddress
        var desc = "From: \(senderName)\n"
        desc += "Subject: \(email.subject)\n\n"
        // Use full body, stripping Gmail quoted reply (lines starting with ">")
        if let body = email.body {
            let lines = body.components(separatedBy: "\n")
            var currentMessage: [String] = []
            for line in lines {
                if line.hasPrefix(">") { break }
                currentMessage.append(line)
            }
            // Trim trailing blank lines
            while currentMessage.last?.trimmingCharacters(in: .whitespaces).isEmpty == true {
                currentMessage.removeLast()
            }
            desc += currentMessage.joined(separator: "\n")
        } else if let snippet = email.snippet {
            desc += snippet
        }

        var task = TaskItem(
            id: nil,
            projectId: "__global__",
            title: email.subject,
            description: desc,
            status: "todo",
            priority: 1,
            sourceSession: nil,
            source: "email",
            createdAt: Date(),
            completedAt: nil,
            labels: nil,
            attachments: nil,
            isGlobal: true,
            gmailThreadId: email.gmailThreadId,
            gmailMessageId: email.gmailMessageId
        )
        task.setLabels(["email"])

        do {
            try DatabaseService.shared.dbQueue.write { db in
                try task.insert(db)
            }
            print("EmailDetail: task inserted with id=\(task.id as Any)")
            // Link the task back to the email
            if let taskId = task.id {
                try? DatabaseService.shared.dbQueue.write { db in
                    try db.execute(
                        sql: "UPDATE processedEmails SET taskId = ? WHERE id = ?",
                        arguments: [taskId, email.id]
                    )
                }
            }
            taskCreated = true
            errorMessage = nil
            NotificationCenter.default.post(name: .tasksDidChange, object: nil)
            onTaskCreated()
        } catch {
            print("EmailDetail: FAILED to create task: \(error)")
            errorMessage = "Failed: \(error.localizedDescription)"
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

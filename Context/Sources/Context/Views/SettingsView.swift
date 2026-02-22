import SwiftUI
import GRDB

struct SettingsView: View {
    @ObservedObject var settings: AppSettings

    var body: some View {
        TabView {
            GeneralSettingsTab()
                .tabItem {
                    Label("General", systemImage: "gear")
                }

            TerminalSettingsTab(settings: settings)
                .tabItem {
                    Label("Terminal", systemImage: "terminal")
                }

            ContextEngineSettingsTab(settings: settings)
                .tabItem {
                    Label("Context Engine", systemImage: "brain")
                }

            GmailSettingsTab(settings: settings)
                .tabItem {
                    Label("Gmail", systemImage: "envelope")
                }
        }
        .frame(width: 500, height: 550)
    }
}

// MARK: - General Tab

private struct GeneralSettingsTab: View {
    var body: some View {
        Form {
            Text("General settings")
                .foregroundStyle(.secondary)
        }
        .formStyle(.grouped)
        .padding()
    }
}

// MARK: - Terminal Tab

private struct TerminalSettingsTab: View {
    @ObservedObject var settings: AppSettings

    var body: some View {
        Form {
            Section("Font") {
                HStack {
                    Text("Font Size: \(Int(settings.terminalFontSize))pt")
                    Slider(
                        value: $settings.terminalFontSize,
                        in: 10...24,
                        step: 1
                    )
                }
            }

            Section("Scrollback") {
                Stepper(
                    "Scrollback Lines: \(settings.scrollbackLines)",
                    value: $settings.scrollbackLines,
                    in: 1000...100000,
                    step: 1000
                )
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

// MARK: - Context Engine Tab

private struct ContextEngineSettingsTab: View {
    @ObservedObject var settings: AppSettings
    @EnvironmentObject var contextEngine: ContextEngine
    @State private var apiKey: String = ClaudeService.openRouterAPIKey ?? ""

    var body: some View {
        Form {
            Section("OpenRouter API") {
                SecureField("API Key (sk-or-...)", text: $apiKey)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: apiKey) { _, val in
                        ClaudeService.openRouterAPIKey = val.isEmpty ? nil : val
                    }
                HStack {
                    Circle()
                        .fill(apiKey.isEmpty ? Color.red : Color.green)
                        .frame(width: 8, height: 8)
                    Text(apiKey.isEmpty ? "No API key set" : "API key configured")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            }

            Section("Code Search") {
                Toggle("Enable context search", isOn: $settings.contextSearchEnabled)

                Picker("Embedding Model", selection: $settings.embeddingModel) {
                    Text("text-embedding-3-small").tag("openai/text-embedding-3-small")
                    Text("text-embedding-3-large").tag("openai/text-embedding-3-large")
                }

                HStack {
                    Text("Index Status:")
                        .font(.system(size: 12))
                    Text(contextEngine.indexStatus.capitalized)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(statusColor)
                    if contextEngine.isIndexing {
                        ProgressView()
                            .controlSize(.small)
                            .scaleEffect(0.7)
                    }
                }

                if contextEngine.totalChunks > 0 {
                    Text("\(contextEngine.totalChunks) chunks indexed")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }

                if let error = contextEngine.lastError {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(.red)
                }

                HStack {
                    Button("Rebuild Index") { contextEngine.rebuildIndex() }
                        .disabled(contextEngine.isIndexing)
                    Button("Clear Index") { Task { await contextEngine.clearIndex() } }
                        .disabled(contextEngine.isIndexing)
                }
            }

            Section("Automation") {
                Toggle("Auto-snapshot sessions", isOn: $settings.autoSnapshotSessions)
                Toggle("Auto-update codebase tree", isOn: $settings.autoUpdateCodebaseTree)
                Toggle("MCP server auto-start", isOn: $settings.mcpServerAutoStart)
                Toggle("CLAUDE.md injection", isOn: $settings.claudeMDInjection)

                HStack {
                    Text("Snapshot debounce: \(Int(settings.snapshotDebounce))s")
                    Slider(
                        value: $settings.snapshotDebounce,
                        in: 5...120,
                        step: 5
                    )
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    private var statusColor: Color {
        switch contextEngine.indexStatus {
        case "ready": return .green
        case "indexing": return .orange
        case "error": return .red
        default: return .secondary
        }
    }
}

// MARK: - Gmail Tab

private struct GmailSettingsTab: View {
    @ObservedObject var settings: AppSettings
    @State private var clientId: String = UserDefaults.standard.string(forKey: "gmailClientId") ?? ""
    @State private var clientSecret: String = KeychainHelper.read(key: "gmailClientSecret") ?? ""
    @State private var accounts: [GmailAccount] = []
    @State private var rules: [WhitelistRule] = []
    @State private var clients: [Client] = []
    @State private var isAddingAccount = false

    // New rule fields
    @State private var newPattern = ""
    @State private var newClientId: String? = nil
    @State private var newPriority = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // API Credentials
                GroupBox("Google API Credentials") {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Client ID", text: $clientId)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12))
                            .onChange(of: clientId) { _, val in
                                UserDefaults.standard.set(val, forKey: "gmailClientId")
                            }
                        SecureField("Client Secret", text: $clientSecret)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12))
                            .onChange(of: clientSecret) { _, val in
                                try? KeychainHelper.save(key: "gmailClientSecret", value: val)
                            }
                        Text("Get these from Google Cloud Console \u{2192} APIs & Services \u{2192} Credentials")
                            .font(.system(size: 10))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(8)
                }

                // Connected Accounts
                GroupBox("Connected Accounts") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(accounts) { account in
                            HStack {
                                Circle()
                                    .fill(account.isActive ? Color.green : Color.secondary)
                                    .frame(width: 8, height: 8)
                                Text(account.email)
                                    .font(.system(size: 12))
                                Spacer()
                                if let lastSync = account.lastSyncAt {
                                    Text(lastSync.formatted(.dateTime.month(.abbreviated).day().hour().minute()))
                                        .font(.system(size: 10))
                                        .foregroundStyle(.tertiary)
                                }
                                Button("Remove") {
                                    removeAccount(account)
                                }
                                .font(.system(size: 11))
                                .foregroundColor(.red)
                            }
                        }
                        if accounts.isEmpty {
                            Text("No accounts connected")
                                .font(.system(size: 11))
                                .foregroundStyle(.tertiary)
                        }
                        Button("Add Gmail Account") {
                            addAccount()
                        }
                        .font(.system(size: 11))
                        .disabled(clientId.isEmpty || clientSecret.isEmpty)
                    }
                    .padding(8)
                }

                // Sync Settings
                GroupBox("Sync Settings") {
                    VStack(alignment: .leading, spacing: 8) {
                        Toggle("Enable Gmail sync", isOn: $settings.gmailSyncEnabled)
                            .font(.system(size: 12))
                        HStack {
                            Text("Check every \(Int(settings.gmailSyncInterval / 60)) min")
                                .font(.system(size: 12))
                            Slider(
                                value: $settings.gmailSyncInterval,
                                in: 60...1800,
                                step: 60
                            )
                        }
                    }
                    .padding(8)
                }

                // Whitelist Rules
                GroupBox("Whitelist Rules") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(rules) { rule in
                            HStack(spacing: 8) {
                                Text(rule.pattern)
                                    .font(.system(size: 12, design: .monospaced))
                                    .frame(minWidth: 120, alignment: .leading)
                                if let cId = rule.clientId,
                                   let client = clients.first(where: { $0.id == cId }) {
                                    Text("\u{2192} \(client.name)")
                                        .font(.system(size: 11))
                                        .foregroundColor(.secondary)
                                }
                                if rule.priority > 0 {
                                    Text("HIGH")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundColor(.orange)
                                }
                                Spacer()
                                Button {
                                    deleteRule(rule)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundStyle(.tertiary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        if rules.isEmpty {
                            Text("No whitelist rules. Emails from unlisted senders will be ignored.")
                                .font(.system(size: 11))
                                .foregroundStyle(.tertiary)
                        }

                        Divider()

                        // Add new rule
                        HStack(spacing: 6) {
                            TextField("@domain.com or user@email.com", text: $newPattern)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 11))
                                .frame(minWidth: 160)

                            Picker("Client", selection: $newClientId) {
                                Text("None").tag(nil as String?)
                                ForEach(clients) { client in
                                    Text(client.name).tag(client.id as String?)
                                }
                            }
                            .font(.system(size: 11))
                            .frame(width: 120)

                            Toggle("Priority", isOn: Binding(
                                get: { newPriority > 0 },
                                set: { newPriority = $0 ? 1 : 0 }
                            ))
                            .font(.system(size: 11))

                            Button("Add") {
                                addRule()
                            }
                            .font(.system(size: 11))
                            .disabled(newPattern.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    .padding(8)
                }
            }
            .padding(16)
        }
        .onAppear {
            loadData()
        }
    }

    // MARK: - Data Loading

    private func loadData() {
        do {
            accounts = try DatabaseService.shared.dbQueue.read { db in
                try GmailAccount.fetchAll(db)
            }
            rules = try DatabaseService.shared.dbQueue.read { db in
                try WhitelistRule.order(Column("createdAt").asc).fetchAll(db)
            }
            clients = try DatabaseService.shared.dbQueue.read { db in
                try Client.order(Column("name").asc).fetchAll(db)
            }
        } catch {
            print("GmailSettings: failed to load data: \(error)")
        }
    }

    // MARK: - Account Management

    private func addAccount() {
        Task {
            let oauth = GoogleOAuthManager()
            guard let tokens = await oauth.startOAuthFlow() else { return }

            let accountId = UUID().uuidString
            oauth.saveTokens(tokens, accountId: accountId)

            // Fetch the email address
            let api = GmailAPIService(oauthManager: oauth)
            let email = await api.fetchProfile(accountId: accountId) ?? "unknown"

            var account = GmailAccount(
                id: accountId,
                email: email,
                createdAt: Date()
            )

            do {
                try await DatabaseService.shared.dbQueue.write { db in
                    try account.insert(db)
                }
                loadData()
            } catch {
                print("GmailSettings: failed to save account: \(error)")
            }
        }
    }

    private func removeAccount(_ account: GmailAccount) {
        let oauth = GoogleOAuthManager()
        oauth.deleteTokens(accountId: account.id)
        do {
            _ = try DatabaseService.shared.dbQueue.write { db in
                try account.delete(db)
            }
            loadData()
        } catch {
            print("GmailSettings: failed to remove account: \(error)")
        }
    }

    // MARK: - Whitelist Rules

    private func addRule() {
        let pattern = newPattern.trimmingCharacters(in: .whitespaces)
        guard !pattern.isEmpty else { return }

        var rule = WhitelistRule(
            id: UUID().uuidString,
            pattern: pattern,
            clientId: newClientId,
            priority: newPriority,
            createdAt: Date()
        )

        do {
            try DatabaseService.shared.dbQueue.write { db in
                try rule.insert(db)
            }
            newPattern = ""
            newClientId = nil
            newPriority = 0
            loadData()
        } catch {
            print("GmailSettings: failed to add rule: \(error)")
        }
    }

    private func deleteRule(_ rule: WhitelistRule) {
        do {
            _ = try DatabaseService.shared.dbQueue.write { db in
                try rule.delete(db)
            }
            loadData()
        } catch {
            print("GmailSettings: failed to delete rule: \(error)")
        }
    }
}

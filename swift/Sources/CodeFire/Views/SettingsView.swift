import SwiftUI
import GRDB

struct SettingsView: View {
    @ObservedObject var settings: AppSettings

    var body: some View {
        TabView {
            GeneralSettingsTab(settings: settings)
                .tabItem {
                    Label("General", systemImage: "gear")
                }

            TerminalSettingsTab(settings: settings)
                .tabItem {
                    Label("Terminal", systemImage: "terminal")
                }

            ContextEngineSettingsTab(settings: settings)
                .tabItem {
                    Label("CodeFire Engine", systemImage: "brain")
                }

            GmailSettingsTab(settings: settings)
                .tabItem {
                    Label("Gmail", systemImage: "envelope")
                }

            BrowserSettingsTab(settings: settings)
                .tabItem {
                    Label("Browser", systemImage: "globe")
                }

            TeamSettingsTab(settings: settings)
                .tabItem {
                    Label("Team", systemImage: "person.3")
                }
        }
        .frame(width: 500, height: 600)
    }
}

// MARK: - General Tab

private struct GeneralSettingsTab: View {
    @ObservedObject var settings: AppSettings
    @StateObject private var updateService = UpdateService.shared

    var body: some View {
        Form {
            Section("Updates") {
                Toggle("Check for updates automatically", isOn: $settings.checkForUpdates)
                TextField("GitHub repo (owner/repo)", text: $settings.githubRepo)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))
                Text("e.g. nicknorris/codefire")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)

                HStack {
                    Button("Check Now") {
                        let parts = settings.githubRepo.split(separator: "/")
                        guard parts.count == 2 else { return }
                        Task {
                            await updateService.checkForUpdate(
                                owner: String(parts[0]),
                                repo: String(parts[1])
                            )
                        }
                    }
                    .disabled(settings.githubRepo.split(separator: "/").count != 2)

                    if updateService.updateAvailable, let version = updateService.latestVersion {
                        Text("v\(version) available")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.green)
                    }
                }

                if updateService.updateAvailable {
                    Button("Download & Install") {
                        let parts = settings.githubRepo.split(separator: "/")
                        guard parts.count == 2 else { return }
                        Task {
                            await updateService.downloadAndInstall(
                                owner: String(parts[0]),
                                repo: String(parts[1])
                            )
                        }
                    }
                    .disabled(updateService.isDownloading)

                    if updateService.isDownloading {
                        ProgressView(value: updateService.downloadProgress)
                            .progressViewStyle(.linear)
                    }
                }

                if let error = updateService.error {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(.red)
                }
            }

            Section("Notifications") {
                Toggle("Notify when new emails arrive", isOn: $settings.notifyOnNewEmail)
                Toggle("Notify when Claude finishes", isOn: $settings.notifyOnClaudeDone)
            }

            Section("Demo Mode") {
                Toggle("Enable demo mode", isOn: $settings.demoMode)
                Text("Replaces all client names, project names, and task titles with dummy data for clean screenshots. The database is never modified.")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }

            Section("Preferred CLI") {
                Picker("Default coding CLI", selection: $settings.preferredCLI) {
                    ForEach(CLIProvider.allCases) { cli in
                        HStack(spacing: 8) {
                            Image(systemName: cli.iconName)
                                .foregroundColor(cli.color)
                            Text(cli.displayName)
                            if !cli.isInstalled {
                                Text("Not installed")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .tag(cli)
                    }
                }
                .pickerStyle(.radioGroup)

                Text("Used for task launcher and quick-launch buttons")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)

                TextField("Extra arguments", text: Binding(
                    get: { settings.cliExtraArgs[settings.preferredCLI.rawValue] ?? "" },
                    set: { settings.cliExtraArgs[settings.preferredCLI.rawValue] = $0 }
                ))
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12, design: .monospaced))

                Text("e.g. --dangerously-skip-permissions — added to all launch commands for \(settings.preferredCLI.displayName)")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
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

// MARK: - CodeFire Engine Tab

private struct ContextEngineSettingsTab: View {
    @ObservedObject var settings: AppSettings
    @EnvironmentObject var contextEngine: ContextEngine
    @StateObject private var modelsService = OpenRouterModelsService.shared
    @State private var apiKey: String = ClaudeService.openRouterAPIKey ?? ""
    @State private var selectedChatModel: String = ClaudeService.openRouterModel
    @State private var modelSearchText: String = ""
    @State private var isEditingModel: Bool = false

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

            Section("Chat Model") {
                // Current selection
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(modelsService.displayName(for: selectedChatModel))
                            .font(.system(size: 12, weight: .medium))
                        Text(selectedChatModel)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(isEditingModel ? "Done" : "Change") {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            isEditingModel.toggle()
                            if !isEditingModel { modelSearchText = "" }
                        }
                    }
                    .font(.system(size: 11))
                }

                if isEditingModel {
                    TextField("Type model ID or search (e.g. qwen/qwen3-coder)", text: $modelSearchText)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12))
                        .onSubmit {
                            if modelSearchText.contains("/") {
                                selectedChatModel = modelSearchText
                                ClaudeService.openRouterModel = modelSearchText
                                isEditingModel = false
                                modelSearchText = ""
                            }
                        }

                    // Model list
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 1) {
                            ForEach(filteredModels) { model in
                                modelRow(model)
                            }
                        }
                    }
                    .frame(maxHeight: 220)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 6))

                    HStack {
                        if modelsService.isLoading {
                            ProgressView()
                                .controlSize(.small)
                                .scaleEffect(0.7)
                            Text("Loading models...")
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                        } else if let error = modelsService.lastError {
                            Text(error)
                                .font(.system(size: 10))
                                .foregroundColor(.red)
                        }
                        Spacer()
                        Button("Refresh") {
                            Task { await modelsService.refreshModels() }
                        }
                        .font(.system(size: 10))
                        .disabled(modelsService.isLoading)
                    }
                }

                Text("Used for the built-in chat. Same API key as above.")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            }
            .task { await modelsService.loadModels() }

            Section("Automation") {
                Toggle("Auto-snapshot sessions", isOn: $settings.autoSnapshotSessions)
                Toggle("Auto-update codebase tree", isOn: $settings.autoUpdateCodebaseTree)
                Toggle("MCP server auto-start", isOn: $settings.mcpServerAutoStart)
                Toggle("Instruction file injection", isOn: $settings.instructionInjection)

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

    // MARK: - Model Picker Helpers

    private var filteredModels: [OpenRouterModel] {
        if modelSearchText.isEmpty { return modelsService.models }
        let query = modelSearchText.lowercased()
        return modelsService.models.filter {
            $0.id.lowercased().contains(query) || $0.name.lowercased().contains(query)
        }
    }

    private func modelRow(_ model: OpenRouterModel) -> some View {
        let isSelected = model.id == selectedChatModel
        return Button {
            selectedChatModel = model.id
            ClaudeService.openRouterModel = model.id
            isEditingModel = false
            modelSearchText = ""
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.name)
                        .font(.system(size: 12, weight: isSelected ? .semibold : .regular))
                        .foregroundColor(isSelected ? .accentColor : .primary)
                    HStack(spacing: 8) {
                        Text(model.id)
                            .font(.system(size: 10, design: .monospaced))
                        if model.contextLength > 0 {
                            Text(formatContext(model.contextLength))
                                .font(.system(size: 10))
                        }
                        if model.promptPrice > 0 {
                            Text("$\(String(format: "%.1f", model.promptPrice))/M in")
                                .font(.system(size: 10))
                        }
                    }
                    .foregroundStyle(.secondary)
                }
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.accentColor)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func formatContext(_ tokens: Int) -> String {
        if tokens >= 1_000_000 {
            let m = Double(tokens) / 1_000_000
            return m.truncatingRemainder(dividingBy: 1) == 0
                ? "\(Int(m))M ctx"
                : String(format: "%.1fM ctx", m)
        } else {
            return "\(tokens / 1000)K ctx"
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

                            Picker("Group", selection: $newClientId) {
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

// MARK: - Browser Tab

private struct BrowserSettingsTab: View {
    @ObservedObject var settings: AppSettings
    @State private var newDomain: String = ""

    var body: some View {
        Form {
            Section("Domain Allowlist") {
                Text("When non-empty, the browser MCP tools can only navigate to these domains. Localhost and 127.0.0.1 are always allowed.")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)

                ForEach(Array(settings.browserAllowedDomains.enumerated()), id: \.offset) { index, domain in
                    HStack {
                        Text(domain)
                            .font(.system(size: 12, design: .monospaced))
                        Spacer()
                        Button {
                            settings.browserAllowedDomains.remove(at: index)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }

                HStack(spacing: 6) {
                    TextField("example.com or *.example.com", text: $newDomain)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12))
                        .onSubmit { addDomain() }

                    Button("Add") { addDomain() }
                        .font(.system(size: 11))
                        .disabled(newDomain.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                if settings.browserAllowedDomains.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "info.circle")
                            .font(.system(size: 10))
                        Text("Empty list = all domains allowed")
                            .font(.system(size: 11))
                    }
                    .foregroundStyle(.tertiary)
                }
            }

            Section("Network Capture") {
                Picker("Response body limit", selection: $settings.networkBodyLimit) {
                    Text("2 KB").tag(2048)
                    Text("10 KB").tag(10240)
                    Text("50 KB (default)").tag(51200)
                    Text("100 KB").tag(102400)
                }
                Text("Larger limits capture more of each response body in the Network tab but use more memory.")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    private func addDomain() {
        let domain = newDomain.trimmingCharacters(in: .whitespaces).lowercased()
        guard !domain.isEmpty, !settings.browserAllowedDomains.contains(domain) else { return }
        settings.browserAllowedDomains.append(domain)
        newDomain = ""
    }
}

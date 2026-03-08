import Foundation

class AppSettings: ObservableObject {
    @Published var autoSnapshotSessions: Bool {
        didSet { UserDefaults.standard.set(autoSnapshotSessions, forKey: "autoSnapshotSessions") }
    }
    @Published var autoUpdateCodebaseTree: Bool {
        didSet { UserDefaults.standard.set(autoUpdateCodebaseTree, forKey: "autoUpdateCodebaseTree") }
    }
    @Published var mcpServerAutoStart: Bool {
        didSet { UserDefaults.standard.set(mcpServerAutoStart, forKey: "mcpServerAutoStart") }
    }
    @Published var instructionInjection: Bool {
        didSet { UserDefaults.standard.set(instructionInjection, forKey: "claudeMDInjection") }
    }
    @Published var snapshotDebounce: Double {
        didSet { UserDefaults.standard.set(snapshotDebounce, forKey: "snapshotDebounce") }
    }
    @Published var terminalFontSize: Double {
        didSet { UserDefaults.standard.set(terminalFontSize, forKey: "terminalFontSize") }
    }
    @Published var scrollbackLines: Int {
        didSet { UserDefaults.standard.set(scrollbackLines, forKey: "scrollbackLines") }
    }
    @Published var gmailSyncEnabled: Bool {
        didSet { UserDefaults.standard.set(gmailSyncEnabled, forKey: "gmailSyncEnabled") }
    }
    @Published var gmailSyncInterval: Double {
        didSet { UserDefaults.standard.set(gmailSyncInterval, forKey: "gmailSyncInterval") }
    }
    @Published var contextSearchEnabled: Bool {
        didSet { UserDefaults.standard.set(contextSearchEnabled, forKey: "contextSearchEnabled") }
    }
    @Published var embeddingModel: String {
        didSet { UserDefaults.standard.set(embeddingModel, forKey: "embeddingModel") }
    }
    @Published var preferredCLI: CLIProvider {
        didSet { UserDefaults.standard.set(preferredCLI.rawValue, forKey: "preferredCLI") }
    }

    // Notifications
    @Published var notifyOnNewEmail: Bool {
        didSet { UserDefaults.standard.set(notifyOnNewEmail, forKey: "notifyOnNewEmail") }
    }
    @Published var notifyOnClaudeDone: Bool {
        didSet { UserDefaults.standard.set(notifyOnClaudeDone, forKey: "notifyOnClaudeDone") }
    }

    // Browser
    @Published var browserAllowedDomains: [String] {
        didSet { UserDefaults.standard.set(browserAllowedDomains, forKey: "browserAllowedDomains") }
    }
    @Published var networkBodyLimit: Int {
        didSet { UserDefaults.standard.set(networkBodyLimit, forKey: "networkBodyLimit") }
    }

    // Teams (opt-in cloud sync for team collaboration)
    @Published var premiumEnabled: Bool {
        didSet { UserDefaults.standard.set(premiumEnabled, forKey: "premiumEnabled") }
    }
    @Published var supabaseUrl: String {
        didSet { UserDefaults.standard.set(supabaseUrl, forKey: "supabaseUrl") }
    }
    @Published var supabaseAnonKey: String {
        didSet { UserDefaults.standard.set(supabaseAnonKey, forKey: "supabaseAnonKey") }
    }

    // Demo Mode
    @Published var demoMode: Bool {
        didSet {
            UserDefaults.standard.set(demoMode, forKey: "demoMode")
            DemoContent.shared.clearCache()
        }
    }

    // Updates
    @Published var checkForUpdates: Bool {
        didSet { UserDefaults.standard.set(checkForUpdates, forKey: "checkForUpdates") }
    }
    @Published var githubRepo: String {
        didSet { UserDefaults.standard.set(githubRepo, forKey: "githubRepo") }
    }

    // CLI Extra Args (per-CLI, keyed by CLIProvider.rawValue)
    @Published var cliExtraArgs: [String: String] {
        didSet {
            if let data = try? JSONEncoder().encode(cliExtraArgs) {
                UserDefaults.standard.set(data, forKey: "cliExtraArgs")
            }
        }
    }

    /// Returns the CLI command with any user-configured extra arguments appended.
    func commandWithArgs(for cli: CLIProvider) -> String {
        let args = cliExtraArgs[cli.rawValue]?.trimmingCharacters(in: .whitespaces) ?? ""
        if args.isEmpty { return cli.command }
        return "\(cli.command) \(args)"
    }

    // Briefing
    @Published var briefingStalenessHours: Double {
        didSet { UserDefaults.standard.set(briefingStalenessHours, forKey: "briefingStalenessHours") }
    }
    @Published var briefingRSSFeeds: [String] {
        didSet {
            if let data = try? JSONEncoder().encode(briefingRSSFeeds) {
                UserDefaults.standard.set(data, forKey: "briefingRSSFeeds")
            }
        }
    }
    @Published var briefingSubreddits: [String] {
        didSet {
            if let data = try? JSONEncoder().encode(briefingSubreddits) {
                UserDefaults.standard.set(data, forKey: "briefingSubreddits")
            }
        }
    }

    init() {
        let defaults = UserDefaults.standard
        self.autoSnapshotSessions = defaults.object(forKey: "autoSnapshotSessions") as? Bool ?? true
        self.autoUpdateCodebaseTree = defaults.object(forKey: "autoUpdateCodebaseTree") as? Bool ?? true
        self.mcpServerAutoStart = defaults.object(forKey: "mcpServerAutoStart") as? Bool ?? true
        self.instructionInjection = defaults.object(forKey: "claudeMDInjection") as? Bool ?? true
        self.snapshotDebounce = defaults.object(forKey: "snapshotDebounce") as? Double ?? 30.0
        self.terminalFontSize = defaults.object(forKey: "terminalFontSize") as? Double ?? 13.0
        self.scrollbackLines = defaults.object(forKey: "scrollbackLines") as? Int ?? 10000
        self.gmailSyncEnabled = defaults.object(forKey: "gmailSyncEnabled") as? Bool ?? false
        self.gmailSyncInterval = defaults.object(forKey: "gmailSyncInterval") as? Double ?? 300
        self.contextSearchEnabled = defaults.object(forKey: "contextSearchEnabled") as? Bool ?? true
        self.embeddingModel = defaults.string(forKey: "embeddingModel") ?? "openai/text-embedding-3-small"
        self.preferredCLI = CLIProvider(rawValue: defaults.string(forKey: "preferredCLI") ?? "") ?? .claude

        self.notifyOnNewEmail = defaults.object(forKey: "notifyOnNewEmail") as? Bool ?? true
        self.notifyOnClaudeDone = defaults.object(forKey: "notifyOnClaudeDone") as? Bool ?? true

        self.browserAllowedDomains = defaults.stringArray(forKey: "browserAllowedDomains") ?? []
        self.networkBodyLimit = defaults.object(forKey: "networkBodyLimit") as? Int ?? 51200

        self.premiumEnabled = defaults.object(forKey: "premiumEnabled") as? Bool ?? false
        self.supabaseUrl = defaults.string(forKey: "supabaseUrl") ?? "https://hofreldxofygaerodowt.supabase.co"
        self.supabaseAnonKey = defaults.string(forKey: "supabaseAnonKey") ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvZnJlbGR4b2Z5Z2Flcm9kb3d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4Mjc2NjksImV4cCI6MjA4ODQwMzY2OX0.MBwqQBeDfu9uxb99tYTZD54P_U3tjuh2zddMUjTlCuA"

        self.demoMode = defaults.object(forKey: "demoMode") as? Bool ?? false
        self.checkForUpdates = defaults.object(forKey: "checkForUpdates") as? Bool ?? true
        self.githubRepo = defaults.string(forKey: "githubRepo") ?? "websitebutlers/codefire-app"

        self.cliExtraArgs = defaults.data(forKey: "cliExtraArgs")
            .flatMap { try? JSONDecoder().decode([String: String].self, from: $0) }
            ?? [:]

        self.briefingStalenessHours = defaults.object(forKey: "briefingStalenessHours") as? Double ?? 6.0

        let defaultFeeds = [
            "https://www.anthropic.com/feed",
            "https://openai.com/blog/rss.xml",
            "https://blog.google/technology/ai/rss/",
            "https://simonwillison.net/atom/everything/",
            "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
            "https://techcrunch.com/category/artificial-intelligence/feed/",
            "https://blog.langchain.dev/rss/",
            "https://huggingface.co/blog/feed.xml",
        ]
        self.briefingRSSFeeds = defaults.data(forKey: "briefingRSSFeeds")
            .flatMap { try? JSONDecoder().decode([String].self, from: $0) }
            ?? defaultFeeds

        let defaultSubs = ["programming", "MachineLearning", "LocalLLaMA"]
        self.briefingSubreddits = defaults.data(forKey: "briefingSubreddits")
            .flatMap { try? JSONDecoder().decode([String].self, from: $0) }
            ?? defaultSubs
    }
}

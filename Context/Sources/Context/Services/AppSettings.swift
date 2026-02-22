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
    @Published var claudeMDInjection: Bool {
        didSet { UserDefaults.standard.set(claudeMDInjection, forKey: "claudeMDInjection") }
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

    init() {
        let defaults = UserDefaults.standard
        self.autoSnapshotSessions = defaults.object(forKey: "autoSnapshotSessions") as? Bool ?? true
        self.autoUpdateCodebaseTree = defaults.object(forKey: "autoUpdateCodebaseTree") as? Bool ?? true
        self.mcpServerAutoStart = defaults.object(forKey: "mcpServerAutoStart") as? Bool ?? true
        self.claudeMDInjection = defaults.object(forKey: "claudeMDInjection") as? Bool ?? true
        self.snapshotDebounce = defaults.object(forKey: "snapshotDebounce") as? Double ?? 30.0
        self.terminalFontSize = defaults.object(forKey: "terminalFontSize") as? Double ?? 13.0
        self.scrollbackLines = defaults.object(forKey: "scrollbackLines") as? Int ?? 10000
        self.gmailSyncEnabled = defaults.object(forKey: "gmailSyncEnabled") as? Bool ?? false
        self.gmailSyncInterval = defaults.object(forKey: "gmailSyncInterval") as? Double ?? 300
        self.contextSearchEnabled = defaults.object(forKey: "contextSearchEnabled") as? Bool ?? true
        self.embeddingModel = defaults.string(forKey: "embeddingModel") ?? "openai/text-embedding-3-small"
    }
}

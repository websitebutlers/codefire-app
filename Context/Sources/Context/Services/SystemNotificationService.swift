import Foundation
import UserNotifications
import Combine

@MainActor
class SystemNotificationService: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    private var settings: AppSettings
    private var gmailPoller: GmailPoller
    private var cancellables = Set<AnyCancellable>()
    private var wasSyncing = false

    init(settings: AppSettings, gmailPoller: GmailPoller) {
        self.settings = settings
        self.gmailPoller = gmailPoller
        super.init()
        requestAuthorization()
    }

    // MARK: - Authorization

    private func requestAuthorization() {
        // UNUserNotificationCenter.current() crashes when the app lacks a proper
        // bundle identifier (e.g. running a `swift build` binary from Terminal).
        // Guard with Bundle.main.bundleIdentifier check to avoid SIGABRT.
        guard Bundle.main.bundleIdentifier != nil else {
            print("SystemNotificationService: skipping — no bundle identifier")
            return
        }
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error {
                print("SystemNotificationService: auth error: \(error)")
            }
            print("SystemNotificationService: authorized=\(granted)")
        }
    }

    // MARK: - Observers

    func observeGmailPoller() {
        gmailPoller.$isSyncing
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isSyncing in
                guard let self else { return }
                // Detect sync completion: was syncing, now done
                if self.wasSyncing && !isSyncing {
                    let newCount = self.gmailPoller.newTaskCount
                    if newCount > 0 && self.settings.notifyOnNewEmail {
                        self.sendNewEmailNotification(count: newCount)
                    }
                }
                self.wasSyncing = isSyncing
            }
            .store(in: &cancellables)
    }

    func observeClaudeExitNotifications() {
        NotificationCenter.default.publisher(for: .claudeProcessDidExit)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self, self.settings.notifyOnClaudeDone else { return }
                self.sendClaudeFinishedNotification()
            }
            .store(in: &cancellables)
    }

    // MARK: - Send Notifications

    private func sendNewEmailNotification(count: Int) {
        guard Bundle.main.bundleIdentifier != nil else { return }
        let content = UNMutableNotificationContent()
        content.title = "New Emails"
        content.body = count == 1
            ? "1 new actionable email"
            : "\(count) new actionable emails"
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "newEmail-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    private func sendClaudeFinishedNotification() {
        guard Bundle.main.bundleIdentifier != nil else { return }
        let content = UNMutableNotificationContent()
        content.title = "Claude Finished"
        content.body = "Claude Code session has completed"
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "claudeDone-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Show notifications even when app is in the foreground.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}

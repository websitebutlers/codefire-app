import Foundation
import CryptoKit

/// Stores secrets in a local JSON file in Application Support.
/// Uses file-system permissions for security (same as gh CLI, gcloud, etc.).
/// This avoids macOS Keychain ACL prompts with ad-hoc signed builds.
enum KeychainHelper {
    private static var store: [String: String] = {
        load()
    }()

    private static let storeURL: URL = {
        let dir = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!.appendingPathComponent("CodeFire", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(".credentials.json")
    }()

    static func save(key: String, value: String) throws {
        store[key] = value
        persist()
    }

    static func read(key: String) -> String? {
        store[key]
    }

    static func delete(key: String) {
        store.removeValue(forKey: key)
        persist()
    }

    // MARK: - File I/O

    private static func load() -> [String: String] {
        guard let data = try? Data(contentsOf: storeURL),
              let dict = try? JSONDecoder().decode([String: String].self, from: data)
        else { return [:] }
        return dict
    }

    private static func persist() {
        guard let data = try? JSONEncoder().encode(store) else { return }
        try? data.write(to: storeURL, options: [.atomic])
        // Restrict file permissions to owner-only (600)
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: storeURL.path
        )
    }

    enum KeychainError: Error {
        case saveFailed(OSStatus)
    }
}

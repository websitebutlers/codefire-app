import Foundation
import SwiftUI

/// Checks for app updates via GitHub Releases and handles download + install.
@MainActor
class UpdateService: ObservableObject {
    static let shared = UpdateService()

    // Config — user sets repo in AppSettings
    @Published var updateAvailable = false
    @Published var latestVersion: String?
    @Published var releaseNotes: String?
    @Published var downloadProgress: Double = 0
    @Published var isDownloading = false
    @Published var error: String?

    private var checkTimer: Timer?
    private var downloadTask: URLSessionDownloadTask?

    private let currentVersion: String = {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }()

    // MARK: - Version Checking

    /// Start periodic checking. Call on app launch.
    func startPeriodicChecks(owner: String, repo: String, interval: TimeInterval = 3600) {
        // Check immediately
        Task { await checkForUpdate(owner: owner, repo: repo) }

        // Then check periodically
        checkTimer?.invalidate()
        checkTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                await self.checkForUpdate(owner: owner, repo: repo)
            }
        }
    }

    func stopPeriodicChecks() {
        checkTimer?.invalidate()
        checkTimer = nil
    }

    /// Check GitHub Releases API for a newer version.
    func checkForUpdate(owner: String, repo: String) async {
        let urlString = "https://api.github.com/repos/\(owner)/\(repo)/releases/latest"
        guard let url = URL(string: urlString) else { return }

        var request = URLRequest(url: url)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("CodeFire/\(currentVersion)", forHTTPHeaderField: "User-Agent")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else { return }

            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tagName = json["tag_name"] as? String else { return }

            let remoteVersion = tagName.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))

            if isNewerVersion(remoteVersion, than: currentVersion) {
                self.latestVersion = remoteVersion
                self.releaseNotes = json["body"] as? String
                self.updateAvailable = true
            } else {
                self.updateAvailable = false
            }
        } catch {
            // Silently fail — don't bother user with network issues
        }
    }

    // MARK: - Download + Install

    /// Download the .zip asset and install it.
    func downloadAndInstall(owner: String, repo: String) async {
        guard !isDownloading else { return }
        isDownloading = true
        downloadProgress = 0
        error = nil

        do {
            // 1. Get the download URL for the .zip asset
            let releaseURL = "https://api.github.com/repos/\(owner)/\(repo)/releases/latest"
            guard let url = URL(string: releaseURL) else { throw UpdateError.invalidURL }

            var request = URLRequest(url: url)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")

            let (data, _) = try await URLSession.shared.data(for: request)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let assets = json["assets"] as? [[String: Any]] else {
                throw UpdateError.noAssets
            }

            // Find the .zip asset
            guard let zipAsset = assets.first(where: { ($0["name"] as? String)?.hasSuffix(".zip") == true }),
                  let downloadURLString = zipAsset["browser_download_url"] as? String,
                  let downloadURL = URL(string: downloadURLString) else {
                throw UpdateError.noZipAsset
            }

            // 2. Download the zip
            let delegate = DownloadDelegate { [weak self] progress in
                Task { @MainActor in
                    self?.downloadProgress = progress
                }
            }
            let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
            let (tempURL, _) = try await session.download(from: downloadURL)

            // 3. Extract to temp directory
            let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("CodeFireUpdate-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

            let extractResult = try await runProcess("/usr/bin/ditto", arguments: ["-xk", tempURL.path, tempDir.path])
            guard extractResult == 0 else { throw UpdateError.extractFailed }

            // 4. Find the .app in extracted contents
            let contents = try FileManager.default.contentsOfDirectory(at: tempDir, includingPropertiesForKeys: nil)
            guard let newApp = contents.first(where: { $0.pathExtension == "app" }) else {
                throw UpdateError.noAppInZip
            }

            // 5. Validate .app filename contains only safe characters
            let appName = newApp.lastPathComponent
            let safeChars = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-_ "))
            guard appName.unicodeScalars.allSatisfy({ safeChars.contains($0) }) else {
                throw UpdateError.suspiciousAppName
            }

            // 6. Remove quarantine from validated .app only (not entire temp dir)
            _ = try? await runProcess("/usr/bin/xattr", arguments: ["-d", "-r", "com.apple.quarantine", newApp.path])

            // 7. Create helper script and launch it
            guard let currentAppURL = currentAppURL() else {
                throw UpdateError.cannotLocateCurrentApp
            }

            let helperScript = tempDir.appendingPathComponent("update-helper.sh")
            let scriptContent = """
            #!/bin/bash
            # Wait for current process to exit
            while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do
                sleep 0.5
            done
            # Replace old app with new
            rm -rf "\(shellEscape(currentAppURL.path))"
            mv "\(shellEscape(newApp.path))" "\(shellEscape(currentAppURL.path))"
            # Launch updated app
            open "\(shellEscape(currentAppURL.path))"
            # Clean up
            rm -rf "\(shellEscape(tempDir.path))"
            """
            try scriptContent.write(to: helperScript, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: helperScript.path)

            // 8. Launch helper and quit
            let helper = Process()
            helper.executableURL = URL(fileURLWithPath: "/bin/bash")
            helper.arguments = [helperScript.path]
            try helper.run()

            NSApplication.shared.terminate(nil)

        } catch {
            self.error = error.localizedDescription
            self.isDownloading = false
        }
    }

    // MARK: - Helpers

    /// Shell-escape a path for safe use in double-quoted bash strings.
    private func shellEscape(_ path: String) -> String {
        var result = path
        for char in ["\\", "\"", "$", "`"] {
            result = result.replacingOccurrences(of: char, with: "\\\(char)")
        }
        return result
    }

    private func currentAppURL() -> URL? {
        // Walk up from the executable to find the .app bundle
        guard let execURL = Bundle.main.executableURL else { return nil }
        var url = execURL
        while url.pathExtension != "app" && url.path != "/" {
            url = url.deletingLastPathComponent()
        }
        return url.pathExtension == "app" ? url : nil
    }

    private func isNewerVersion(_ remote: String, than local: String) -> Bool {
        let remoteParts = remote.split(separator: ".").compactMap { Int($0) }
        let localParts = local.split(separator: ".").compactMap { Int($0) }

        for i in 0..<max(remoteParts.count, localParts.count) {
            let r = i < remoteParts.count ? remoteParts[i] : 0
            let l = i < localParts.count ? localParts[i] : 0
            if r > l { return true }
            if r < l { return false }
        }
        return false
    }

    @discardableResult
    private func runProcess(_ path: String, arguments: [String]) async throws -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus
    }

    enum UpdateError: LocalizedError {
        case invalidURL
        case noAssets
        case noZipAsset
        case extractFailed
        case noAppInZip
        case cannotLocateCurrentApp
        case suspiciousAppName

        var errorDescription: String? {
            switch self {
            case .invalidURL: return "Invalid update URL"
            case .noAssets: return "No assets found in release"
            case .noZipAsset: return "No .zip file found in release assets"
            case .extractFailed: return "Failed to extract update"
            case .noAppInZip: return "No .app found in downloaded update"
            case .cannotLocateCurrentApp: return "Cannot locate current app bundle"
            case .suspiciousAppName: return "Downloaded app has suspicious filename"
            }
        }
    }
}

/// Tracks download progress via URLSession delegate.
private class DownloadDelegate: NSObject, URLSessionDownloadDelegate {
    let onProgress: (Double) -> Void

    init(onProgress: @escaping (Double) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesExpectedToWrite > 0 {
            onProgress(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // Handled by the async download call
    }
}

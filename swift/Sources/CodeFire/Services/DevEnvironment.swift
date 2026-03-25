import Foundation
import SwiftUI

// MARK: - Project Type

enum ProjectType: String, CaseIterable {
    case node = "Node.js"
    case flutter = "Flutter"
    case python = "Python"
    case swift = "Swift"
    case unknown = "Unknown"

    var icon: String {
        switch self {
        case .node: return "cube.fill"
        case .flutter: return "arrow.trianglehead.2.counterclockwise"
        case .python: return "chevron.left.forwardslash.chevron.right"
        case .swift: return "swift"
        case .unknown: return "questionmark.folder"
        }
    }

    var color: Color {
        switch self {
        case .node: return .green
        case .flutter: return .cyan
        case .python: return .yellow
        case .swift: return .orange
        case .unknown: return .gray
        }
    }

    var defaultPorts: [Int] {
        switch self {
        case .node: return [3000, 3001, 4200, 5173, 5174, 8080, 8000]
        case .flutter: return [8080, 3000]
        case .python: return [8000, 5000, 8080]
        case .swift: return [8080]
        case .unknown: return []
        }
    }
}

// MARK: - Dev Command

struct DevCommand: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let command: String
    let icon: String
    let color: Color
}

// MARK: - Active Port

struct ActivePort: Identifiable {
    let port: Int
    let processName: String
    let pid: Int
    var id: Int { port }
}

// MARK: - DevEnvironment

/// Detects project type, available dev commands, and active local server ports.
@MainActor
class DevEnvironment: ObservableObject {
    @Published var projectType: ProjectType = .unknown
    @Published var commands: [DevCommand] = []
    @Published var activePorts: [ActivePort] = []
    @Published var packageScripts: [String: String] = [:]

    private var portTimer: Timer?
    private var projectPath: String?

    func scan(projectPath: String) {
        self.projectPath = projectPath
        detectProjectType(at: projectPath)
        buildCommands(at: projectPath)
        scanPorts()
        startPortPolling()
    }

    func stop() {
        portTimer?.invalidate()
        portTimer = nil
    }

    // MARK: - Project Detection

    private func detectProjectType(at path: String) {
        let fm = FileManager.default

        if fm.fileExists(atPath: "\(path)/pubspec.yaml") {
            projectType = .flutter
        } else if fm.fileExists(atPath: "\(path)/package.json") {
            projectType = .node
        } else if fm.fileExists(atPath: "\(path)/Package.swift") {
            projectType = .swift
        } else if fm.fileExists(atPath: "\(path)/requirements.txt")
                    || fm.fileExists(atPath: "\(path)/pyproject.toml")
                    || fm.fileExists(atPath: "\(path)/setup.py") {
            projectType = .python
        } else {
            projectType = .unknown
        }
    }

    // MARK: - Build Commands

    private func buildCommands(at path: String) {
        var result: [DevCommand] = []

        switch projectType {
        case .node:
            result.append(contentsOf: buildNodeCommands(at: path))
        case .flutter:
            result.append(contentsOf: buildFlutterCommands())
        case .python:
            result.append(contentsOf: buildPythonCommands(at: path))
        case .swift:
            result.append(contentsOf: buildSwiftCommands())
        case .unknown:
            break
        }

        commands = result
    }

    private func buildNodeCommands(at path: String) -> [DevCommand] {
        var cmds: [DevCommand] = []

        // Parse package.json for scripts
        let packageJsonPath = "\(path)/package.json"
        if let data = FileManager.default.contents(atPath: packageJsonPath),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let scripts = json["scripts"] as? [String: String] {
            packageScripts = scripts

            // Detect package manager
            let pm = detectPackageManager(at: path)

            // Prioritized script keys
            let devKeys = ["dev", "start", "serve", "develop"]
            for key in devKeys where scripts[key] != nil {
                cmds.append(DevCommand(
                    id: "npm-\(key)",
                    title: "\(pm) \(key)",
                    subtitle: scripts[key] ?? "",
                    command: "\(pm) run \(key)",
                    icon: "play.fill",
                    color: .green
                ))
            }

            if scripts["build"] != nil {
                cmds.append(DevCommand(
                    id: "npm-build",
                    title: "\(pm) build",
                    subtitle: scripts["build"] ?? "",
                    command: "\(pm) run build",
                    icon: "hammer.fill",
                    color: .blue
                ))
            }

            if scripts["test"] != nil {
                cmds.append(DevCommand(
                    id: "npm-test",
                    title: "\(pm) test",
                    subtitle: scripts["test"] ?? "",
                    command: "\(pm) test",
                    icon: "checkmark.circle.fill",
                    color: .green
                ))
            }

            if scripts["lint"] != nil {
                cmds.append(DevCommand(
                    id: "npm-lint",
                    title: "\(pm) lint",
                    subtitle: scripts["lint"] ?? "",
                    command: "\(pm) run lint",
                    icon: "sparkle",
                    color: .purple
                ))
            }
        }

        // Always offer install
        let pm = detectPackageManager(at: path)
        cmds.append(DevCommand(
            id: "npm-install",
            title: "\(pm) install",
            subtitle: "Install dependencies",
            command: "\(pm) install",
            icon: "arrow.down.circle.fill",
            color: .orange
        ))

        return cmds
    }

    private func buildFlutterCommands() -> [DevCommand] {
        [
            DevCommand(
                id: "flutter-run",
                title: "flutter run",
                subtitle: "Run on connected device",
                command: "flutter run",
                icon: "play.fill",
                color: .cyan
            ),
            DevCommand(
                id: "flutter-run-chrome",
                title: "flutter run -d chrome",
                subtitle: "Run in Chrome browser",
                command: "flutter run -d chrome",
                icon: "globe",
                color: .blue
            ),
            DevCommand(
                id: "flutter-run-macos",
                title: "flutter run -d macos",
                subtitle: "Run as macOS app",
                command: "flutter run -d macos",
                icon: "desktopcomputer",
                color: .purple
            ),
            DevCommand(
                id: "flutter-test",
                title: "flutter test",
                subtitle: "Run all tests",
                command: "flutter test",
                icon: "checkmark.circle.fill",
                color: .green
            ),
            DevCommand(
                id: "flutter-build",
                title: "flutter build",
                subtitle: "Build release",
                command: "flutter build",
                icon: "hammer.fill",
                color: .orange
            ),
            DevCommand(
                id: "flutter-pub-get",
                title: "flutter pub get",
                subtitle: "Get dependencies",
                command: "flutter pub get",
                icon: "arrow.down.circle.fill",
                color: .orange
            ),
        ]
    }

    private func buildPythonCommands(at path: String) -> [DevCommand] {
        var cmds: [DevCommand] = []
        let fm = FileManager.default

        // Django
        if fm.fileExists(atPath: "\(path)/manage.py") {
            cmds.append(DevCommand(
                id: "django-run",
                title: "manage.py runserver",
                subtitle: "Django dev server",
                command: "python manage.py runserver",
                icon: "play.fill",
                color: .green
            ))
        }

        // FastAPI / uvicorn
        if fm.fileExists(atPath: "\(path)/main.py") || fm.fileExists(atPath: "\(path)/app.py") {
            let entrypoint = fm.fileExists(atPath: "\(path)/main.py") ? "main:app" : "app:app"
            cmds.append(DevCommand(
                id: "uvicorn-run",
                title: "uvicorn",
                subtitle: "ASGI dev server",
                command: "uvicorn \(entrypoint) --reload",
                icon: "play.fill",
                color: .green
            ))
        }

        cmds.append(DevCommand(
            id: "pip-install",
            title: "pip install",
            subtitle: "Install requirements",
            command: "pip install -r requirements.txt",
            icon: "arrow.down.circle.fill",
            color: .orange
        ))

        return cmds
    }

    private func buildSwiftCommands() -> [DevCommand] {
        [
            DevCommand(
                id: "swift-build",
                title: "swift build",
                subtitle: "Build package",
                command: "swift build",
                icon: "hammer.fill",
                color: .orange
            ),
            DevCommand(
                id: "swift-test",
                title: "swift test",
                subtitle: "Run tests",
                command: "swift test",
                icon: "checkmark.circle.fill",
                color: .green
            ),
            DevCommand(
                id: "swift-run",
                title: "swift run",
                subtitle: "Build and run",
                command: "swift run",
                icon: "play.fill",
                color: .green
            ),
        ]
    }

    // MARK: - Package Manager Detection

    private func detectPackageManager(at path: String) -> String {
        let fm = FileManager.default
        if fm.fileExists(atPath: "\(path)/bun.lockb") || fm.fileExists(atPath: "\(path)/bun.lock") {
            return "bun"
        }
        if fm.fileExists(atPath: "\(path)/pnpm-lock.yaml") {
            return "pnpm"
        }
        if fm.fileExists(atPath: "\(path)/yarn.lock") {
            return "yarn"
        }
        return "npm"
    }

    // MARK: - Port Scanning

    func scanPorts() {
        Task {
            let ports = await Self.detectListeningPorts()
            self.activePorts = ports
        }
    }

    private func startPortPolling() {
        portTimer?.invalidate()
        portTimer = Timer.scheduledTimer(withTimeInterval: 300.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.scanPorts()
            }
        }
    }

    private static func detectListeningPorts() async -> [ActivePort] {
        let process = Process()
        let pipe = Pipe()

        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-iTCP", "-sTCP:LISTEN", "-n", "-P"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            return []
        }

        // Read pipe data BEFORE waitUntilExit() — if the 64KB kernel pipe buffer
        // fills, the child blocks on write and waitUntilExit() deadlocks both.
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        guard let output = String(data: data, encoding: .utf8) else {
            return []
        }

        var seen = Set<Int>()
        var results: [ActivePort] = []

        // lsof output format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
        for line in output.components(separatedBy: .newlines) {
            let cols = line.split(separator: " ", omittingEmptySubsequences: true)
            guard cols.count >= 9 else { continue }

            let processName = String(cols[0])
            let pid = Int(cols[1]) ?? 0

            // NAME column looks like "*:3000" or "127.0.0.1:8080"
            let name = String(cols.last ?? "")
            if let colonIndex = name.lastIndex(of: ":") {
                let portStr = name[name.index(after: colonIndex)...]
                if let port = Int(portStr), !seen.contains(port) {
                    seen.insert(port)
                    results.append(ActivePort(port: port, processName: processName, pid: pid))
                }
            }
        }

        // Filter to common dev ports to avoid noise
        let devPorts = Set([3000, 3001, 3002, 3003, 4200, 4321, 5000, 5173, 5174,
                           8000, 8080, 8081, 8888, 9000, 9090, 19006])

        return results
            .filter { devPorts.contains($0.port) }
            .sorted { $0.port < $1.port }
    }
}

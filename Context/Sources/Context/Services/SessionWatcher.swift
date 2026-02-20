import Foundation
import GRDB

@MainActor
class SessionWatcher: ObservableObject {
    private var fileWatcher: FileWatcher?
    private let db: DatabaseService
    private var currentProject: Project?

    init(db: DatabaseService = .shared) {
        self.db = db
    }

    func watchProject(_ project: Project) {
        stopWatching()
        currentProject = project

        guard let claudeDir = project.claudeProject else {
            print("SessionWatcher: No Claude project directory for \(project.name)")
            return
        }

        let watchPath = claudeDir
        let fm = FileManager.default
        guard fm.fileExists(atPath: watchPath) else {
            print("SessionWatcher: Claude dir does not exist at \(watchPath)")
            return
        }

        fileWatcher = FileWatcher(
            paths: [watchPath],
            debounceInterval: 30.0
        ) { [weak self] paths in
            self?.handleSessionChanges(paths)
        }
        fileWatcher?.start()
        print("SessionWatcher: Watching \(watchPath)")
    }

    func stopWatching() {
        fileWatcher?.stop()
        fileWatcher = nil
        currentProject = nil
    }

    private func handleSessionChanges(_ paths: [String]) {
        guard let project = currentProject else { return }

        let jsonlPaths = paths.filter { $0.hasSuffix(".jsonl") }
        guard !jsonlPaths.isEmpty else { return }

        for path in jsonlPaths {
            let filename = (path as NSString).lastPathComponent
            let sessionId = (filename as NSString).deletingPathExtension

            // Validate that the filename (minus extension) is a valid UUID
            guard UUID(uuidString: sessionId) != nil else {
                continue
            }

            let fileURL = URL(fileURLWithPath: path)
            do {
                guard let parsed = try SessionParser.parse(fileURL: fileURL) else {
                    continue
                }

                let filesChangedJSON: String?
                if !parsed.filesChanged.isEmpty,
                   let data = try? JSONEncoder().encode(parsed.filesChanged) {
                    filesChangedJSON = String(data: data, encoding: .utf8)
                } else {
                    filesChangedJSON = nil
                }

                let summary = SessionParser.generateSummary(from: parsed)

                var session = Session(
                    id: parsed.sessionId,
                    projectId: project.id,
                    slug: parsed.slug,
                    startedAt: parsed.startedAt,
                    endedAt: parsed.endedAt,
                    model: parsed.model,
                    gitBranch: parsed.gitBranch,
                    summary: summary,
                    messageCount: parsed.messageCount,
                    toolUseCount: parsed.toolUseCount,
                    filesChanged: filesChangedJSON
                )

                try db.dbQueue.write { db in
                    try session.save(db)
                }

                print("SessionWatcher: Upserted session \(parsed.sessionId)")
            } catch {
                print("SessionWatcher: Failed to process \(path): \(error)")
            }
        }
    }
}

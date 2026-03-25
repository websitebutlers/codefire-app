import Foundation
import GRDB
import CryptoKit

/// Main orchestrator for the context engine. Manages file watching,
/// chunking, embedding, and index lifecycle for the current project.
@MainActor
class ContextEngine: ObservableObject {
    @Published var indexStatus: String = "idle"
    @Published var totalChunks: Int = 0
    @Published var isIndexing: Bool = false
    @Published var lastError: String?
    @Published var indexProgress: Double = 0    // 0.0 to 1.0
    @Published var indexedFileCount: Int = 0
    @Published var totalFileCount: Int = 0
    @Published var lastIndexedAt: Date?
    @Published var embeddingProgress: Double = 0  // 0.0 to 1.0, for background embedding phase
    @Published var isEmbedding: Bool = false

    private let embeddingClient = EmbeddingClient()
    private var fileWatcher: FileWatcher?
    private var indexRequestPoller: Timer?
    private var embeddingTask: Task<Void, Never>?
    private var currentProjectId: String?
    private var currentProjectPath: String?

    private let skipDirs: Set<String> = [
        "node_modules", ".build", "build", ".dart_tool", "__pycache__",
        ".next", "dist", ".git", ".gradle", "Pods", ".pub-cache",
        ".pub", "ios/Pods", "android/.gradle", ".swiftpm", "DerivedData",
        ".expo", "coverage", "vendor", "target"
    ]

    private let skipExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "svg", "ico", "webp",
        "woff", "woff2", "ttf", "eot",
        "zip", "tar", "gz", "dmg",
        "mp3", "mp4", "wav", "mov",
        "pdf", "lock", "sum"
    ]

    // MARK: - Public API

    /// Start indexing a project. Call when a project is selected.
    func startIndexing(projectId: String, projectPath: String) {
        guard !isIndexing else { return }

        // Stop watching previous project
        stopWatching()

        currentProjectId = projectId
        currentProjectPath = projectPath
        lastError = nil

        // Load existing index state
        if let state = try? DatabaseService.shared.dbQueue.read({ db in
            try IndexState.filter(Column("projectId") == projectId).fetchOne(db)
        }) {
            totalChunks = state.totalChunks
            lastIndexedAt = state.lastFullIndexAt
            if state.status == "ready" {
                indexStatus = "ready"
            } else if state.status == "error" {
                indexStatus = "error"
                lastError = state.lastError
            }
        } else {
            indexStatus = "idle"
            totalChunks = 0
        }

        // Start file watcher
        fileWatcher = FileWatcher(paths: [projectPath], debounceInterval: 2.0) { [weak self] changedPaths in
            guard let self = self else { return }
            Task { @MainActor in
                await self.handleFileChanges(changedPaths)
            }
        }
        fileWatcher?.start()

        // Run initial index
        Task {
            await performFullIndex()
        }
    }

    /// Stop watching and clean up.
    func stopWatching() {
        fileWatcher?.stop()
        fileWatcher = nil
        embeddingTask?.cancel()
        embeddingTask = nil
        isEmbedding = false
    }

    // MARK: - Index Request Polling (MCP IPC)

    /// Start polling for index requests from MCP processes.
    func startPollingForRequests() {
        indexRequestPoller = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                await self.checkForIndexRequests()
            }
        }
    }

    /// Stop polling for index requests.
    func stopPollingForRequests() {
        indexRequestPoller?.invalidate()
        indexRequestPoller = nil
    }

    private func checkForIndexRequests() async {
        guard !isIndexing else { return }

        do {
            // Fetch oldest pending request
            let requestData = try await DatabaseService.shared.dbQueue.read { db -> (Int64, String, String)? in
                guard let row = try Row.fetchOne(db, sql: """
                    SELECT id, projectId, projectPath FROM indexRequests
                    WHERE status = 'pending'
                    ORDER BY createdAt ASC LIMIT 1
                """) else { return nil }
                return (row["id"] as Int64, row["projectId"] as String, row["projectPath"] as String)
            }

            guard let (requestId, projectId, projectPath) = requestData else { return }

            // Mark as processing
            try await DatabaseService.shared.dbQueue.write { db in
                try db.execute(
                    sql: "UPDATE indexRequests SET status = 'processing' WHERE id = ?",
                    arguments: [requestId]
                )
            }

            // Start indexing this project
            startIndexing(projectId: projectId, projectPath: projectPath)

            // Mark as completed (indexing is async, but the request is fulfilled)
            try await DatabaseService.shared.dbQueue.write { db in
                try db.execute(
                    sql: "UPDATE indexRequests SET status = 'completed' WHERE id = ?",
                    arguments: [requestId]
                )
            }
        } catch {
            print("ContextEngine: failed to check index requests: \(error)")
        }
    }

    /// Force a full re-index of the current project.
    func rebuildIndex() {
        guard let projectId = currentProjectId, let _ = currentProjectPath else { return }
        embeddingTask?.cancel()
        embeddingTask = nil
        isEmbedding = false
        Task {
            // Clear existing index
            try? await DatabaseService.shared.dbQueue.write { db in
                try db.execute(sql: "DELETE FROM codeChunks WHERE projectId = ?", arguments: [projectId])
                try db.execute(sql: "DELETE FROM indexedFiles WHERE projectId = ?", arguments: [projectId])
            }
            await performFullIndex()
        }
    }

    /// Clear the index for the current project.
    func clearIndex() async {
        guard let projectId = currentProjectId else { return }
        embeddingTask?.cancel()
        embeddingTask = nil
        isEmbedding = false
        do {
            try await DatabaseService.shared.dbQueue.write { db in
                try db.execute(sql: "DELETE FROM codeChunks WHERE projectId = ?", arguments: [projectId])
                try db.execute(sql: "DELETE FROM indexedFiles WHERE projectId = ?", arguments: [projectId])
                try db.execute(sql: "DELETE FROM indexState WHERE projectId = ?", arguments: [projectId])
            }
            indexStatus = "idle"
            totalChunks = 0
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Full Index

    /// Max chunks per embedding API call
    private let embeddingBatchSize = 100

    private func performFullIndex() async {
        guard let projectId = currentProjectId, let projectPath = currentProjectPath else { return }

        isIndexing = true
        indexStatus = "indexing"
        indexProgress = 0
        indexedFileCount = 0
        totalFileCount = 0
        lastError = nil
        await updateIndexState(projectId: projectId, status: "indexing")

        // Capture skip sets for use off main actor
        let skipDirsCopy = skipDirs
        let skipExtsCopy = skipExtensions

        do {
            // Phase 1: Fast FTS Index — enumerate, chunk, store (no embedding)
            // FTS5 syncs automatically via GRDB triggers on codeChunks

            // 1. Heavy file I/O runs OFF main actor via Task.detached
            let fileWork = await Task.detached { () -> (
                pendingChunks: [CodeChunk],
                pendingFileRecords: [IndexedFile],
                staleFileIds: [String],
                totalFiles: Int,
                skippedFiles: Int
            ) in
                let files = ContextEngine.enumerateFilesOffMain(at: projectPath, skipDirs: skipDirsCopy, skipExtensions: skipExtsCopy)

                // Use write instead of read to avoid GRDB read isolation path crash
                let existingFiles: [String: IndexedFile] = (try? await DatabaseService.shared.dbQueue.write { db in
                    let records = try IndexedFile
                        .filter(Column("projectId") == projectId)
                        .fetchAll(db)
                    return Dictionary(records.map { ($0.relativePath, $0) }, uniquingKeysWith: { _, latest in latest })
                }) ?? [:]

                var pendingChunks: [CodeChunk] = []
                var pendingFileRecords: [IndexedFile] = []
                var staleFileIds: [String] = []
                var skippedFiles = 0

                for (relativePath, fileURL) in files {
                    let content: String
                    do {
                        content = try String(contentsOf: fileURL, encoding: .utf8)
                    } catch {
                        continue
                    }

                    let hash = ContextEngine.sha256Static(content)
                    let existing = existingFiles[relativePath]

                    if let existing, existing.contentHash == hash {
                        skippedFiles += 1
                        continue  // File unchanged
                    }

                    if let existing {
                        staleFileIds.append(existing.id)
                    }

                    let language = CodeChunker.detectLanguage(from: relativePath)
                    let chunks: [CodeChunker.Chunk]

                    if language == "markdown" {
                        chunks = CodeChunker.chunkMarkdown(content: content, filePath: relativePath)
                    } else if let lang = language {
                        chunks = CodeChunker.chunkFile(content: content, language: lang, filePath: relativePath)
                    } else {
                        skippedFiles += 1
                        continue
                    }

                    let fileId = existing?.id ?? UUID().uuidString
                    pendingFileRecords.append(IndexedFile(
                        id: fileId,
                        projectId: projectId,
                        relativePath: relativePath,
                        contentHash: hash,
                        language: language,
                        lastIndexedAt: Date()
                    ))

                    for chunk in chunks {
                        pendingChunks.append(CodeChunk(
                            id: UUID().uuidString,
                            fileId: fileId,
                            projectId: projectId,
                            chunkType: chunk.chunkType,
                            symbolName: chunk.symbolName,
                            content: chunk.content,
                            startLine: chunk.startLine,
                            endLine: chunk.endLine,
                            embedding: nil
                        ))
                    }
                }

                return (pendingChunks, pendingFileRecords, staleFileIds, files.count, skippedFiles)
            }.value

            totalFileCount = fileWork.totalFiles
            indexedFileCount = fileWork.skippedFiles + fileWork.pendingFileRecords.count
            indexProgress = 0.3

            // 2. Batch DB write: delete stale chunks + upsert file records + insert new chunks
            if !fileWork.staleFileIds.isEmpty || !fileWork.pendingFileRecords.isEmpty || !fileWork.pendingChunks.isEmpty {
                try await DatabaseService.shared.dbQueue.write { db in
                    for fileId in fileWork.staleFileIds {
                        try db.execute(sql: "DELETE FROM codeChunks WHERE fileId = ?", arguments: [fileId])
                    }
                    for var record in fileWork.pendingFileRecords {
                        try record.save(db)
                    }
                    for var chunk in fileWork.pendingChunks {
                        try chunk.insert(db)
                    }
                }
            }

            indexProgress = 0.6

            // 3. Index git history (store without embedding)
            _ = await indexGitHistory(projectId: projectId, projectPath: projectPath)
            indexProgress = 0.8

            // 4. Clean up orphaned files
            do {
                try await cleanupOrphanedFiles(projectId: projectId, projectPath: projectPath)
            } catch {
                print("ContextEngine: orphan cleanup failed (non-fatal): \(error)")
            }

            // 5. Count total chunks and mark as ready — FTS search works immediately
            await updateTotalChunks(projectId: projectId)
            indexStatus = "ready"
            isIndexing = false
            indexProgress = 1.0
            lastIndexedAt = Date()
            await updateIndexState(projectId: projectId, status: "ready", totalChunks: totalChunks)

            // Phase 2: Background embedding (non-blocking, optional enhancement)
            startBackgroundEmbedding()

        } catch {
            lastError = error.localizedDescription
            indexStatus = "error"
            isIndexing = false
            indexProgress = 0
            await updateIndexState(projectId: projectId, status: "error", error: error.localizedDescription)
        }
    }

    // MARK: - Incremental Update

    private func handleFileChanges(_ changedPaths: [String]) async {
        guard let projectId = currentProjectId, let projectPath = currentProjectPath else { return }
        guard !isIndexing else { return }  // Don't interrupt full index

        for path in changedPaths {
            // Filter to project directory
            guard path.hasPrefix(projectPath) else { continue }
            let relativePath = String(path.dropFirst(projectPath.count + 1))

            // Skip non-indexable files
            guard shouldIndex(relativePath: relativePath) else { continue }

            let fileURL = URL(fileURLWithPath: path)
            let fm = FileManager.default

            if fm.fileExists(atPath: path) {
                // File created or modified
                guard let content = try? String(contentsOf: fileURL, encoding: .utf8) else { continue }
                let hash = sha256(content)

                // Check if unchanged
                let existing = try? await DatabaseService.shared.dbQueue.read { db in
                    try IndexedFile
                        .filter(Column("projectId") == projectId && Column("relativePath") == relativePath)
                        .fetchOne(db)
                }

                if let existing = existing, existing.contentHash == hash { continue }

                // Re-index this file
                if let existing = existing {
                    try? await DatabaseService.shared.dbQueue.write { db in
                        try db.execute(sql: "DELETE FROM codeChunks WHERE fileId = ?", arguments: [existing.id])
                    }
                }

                let language = CodeChunker.detectLanguage(from: relativePath)
                let chunks: [CodeChunker.Chunk]

                if language == "markdown" {
                    chunks = CodeChunker.chunkMarkdown(content: content, filePath: relativePath)
                } else if let lang = language {
                    chunks = CodeChunker.chunkFile(content: content, language: lang, filePath: relativePath)
                } else {
                    continue
                }

                let fileId = existing?.id ?? UUID().uuidString
                let indexedFile = IndexedFile(
                    id: fileId,
                    projectId: projectId,
                    relativePath: relativePath,
                    contentHash: hash,
                    language: language,
                    lastIndexedAt: Date()
                )

                try? await DatabaseService.shared.dbQueue.write { db in
                    var record = indexedFile
                    try record.save(db)
                }

                let pendingChunks: [CodeChunk] = chunks.map { chunk in
                    CodeChunk(
                        id: UUID().uuidString,
                        fileId: fileId,
                        projectId: projectId,
                        chunkType: chunk.chunkType,
                        symbolName: chunk.symbolName,
                        content: chunk.content,
                        startLine: chunk.startLine,
                        endLine: chunk.endLine,
                        embedding: nil
                    )
                }

                if !pendingChunks.isEmpty {
                    // Store chunks immediately — FTS search works right away
                    try? await DatabaseService.shared.dbQueue.write { db in
                        for var chunk in pendingChunks {
                            try chunk.insert(db)
                        }
                    }
                    // Embed in background for semantic search enhancement
                    if ClaudeService.openRouterAPIKey != nil {
                        let chunksToEmbed = pendingChunks
                        let client = embeddingClient
                        Task.detached {
                            let texts = chunksToEmbed.map { $0.content }
                            let result = await client.embedBatch(texts)
                            try? await DatabaseService.shared.dbQueue.write { db in
                                for (i, chunk) in chunksToEmbed.enumerated() {
                                    if i < result.embeddings.count && !result.embeddings[i].isEmpty {
                                        let encoded = CodeChunk.encodeEmbedding(result.embeddings[i])
                                        try db.execute(
                                            sql: "UPDATE codeChunks SET embedding = ? WHERE id = ?",
                                            arguments: [encoded, chunk.id]
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                // Update total count
                await updateTotalChunks(projectId: projectId)

            } else {
                // File deleted
                if let existing = try? await DatabaseService.shared.dbQueue.read({ db in
                    try IndexedFile
                        .filter(Column("projectId") == projectId && Column("relativePath") == relativePath)
                        .fetchOne(db)
                }) {
                    try? await DatabaseService.shared.dbQueue.write { db in
                        try db.execute(sql: "DELETE FROM codeChunks WHERE fileId = ?", arguments: [existing.id])
                        try existing.delete(db)
                    }
                    await updateTotalChunks(projectId: projectId)
                }
            }
        }
    }

    // MARK: - Git History Indexing

    private func indexGitHistory(projectId: String, projectPath: String) async -> Int {
        // Check if git repo
        let gitDir = (projectPath as NSString).appendingPathComponent(".git")
        guard FileManager.default.fileExists(atPath: gitDir) else { return 0 }

        // Run git log in a detached context to avoid MainActor issues with Process.
        // IMPORTANT: Read pipe data BEFORE waitUntilExit() to avoid deadlock when
        // output exceeds the 64KB kernel pipe buffer.
        let gitLog: String? = await Task.detached {
            let process = Process()
            let pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            process.arguments = ["log", "--oneline", "--stat", "-200"]
            process.currentDirectoryURL = URL(fileURLWithPath: projectPath)
            process.standardOutput = pipe
            process.standardError = FileHandle.nullDevice

            do {
                try process.run()
            } catch {
                return nil
            }

            // Read all output first — if we waitUntilExit() before draining,
            // the child blocks when the 64KB pipe buffer fills, deadlocking both.
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()

            guard process.terminationStatus == 0 else { return nil }
            return String(data: data, encoding: .utf8)
        }.value

        guard let gitLog, !gitLog.isEmpty else { return 0 }

        let chunks = CodeChunker.chunkGitHistory(gitLog)
        guard !chunks.isEmpty else { return 0 }

        // Use a special fileId for git history
        let gitFileId = "\(projectId)__git_history"
        let gitLogHash = sha256(gitLog)

        // Delete existing git chunks and upsert file record + new chunks in a single transaction
        // to avoid orphaned state if one step fails.
        do {
            try await DatabaseService.shared.dbQueue.write { db in
                try db.execute(sql: "DELETE FROM codeChunks WHERE fileId = ?", arguments: [gitFileId])
                var gitFile = IndexedFile(
                    id: gitFileId,
                    projectId: projectId,
                    relativePath: ".git/history",
                    contentHash: gitLogHash,
                    language: nil,
                    lastIndexedAt: Date()
                )
                try gitFile.save(db)

                for chunk in chunks {
                    var codeChunk = CodeChunk(
                        id: UUID().uuidString,
                        fileId: gitFileId,
                        projectId: projectId,
                        chunkType: chunk.chunkType,
                        symbolName: chunk.symbolName,
                        content: chunk.content,
                        startLine: chunk.startLine,
                        endLine: chunk.endLine,
                        embedding: nil
                    )
                    try codeChunk.insert(db)
                }
            }
            return chunks.count
        } catch {
            print("ContextEngine: git history indexing failed (non-fatal): \(error)")
            return 0
        }
    }

    // MARK: - Background Embedding

    /// Start background embedding for chunks that don't have embeddings yet.
    /// Non-blocking — runs entirely off the main actor, only hops back for progress updates.
    /// Cancellable and resumable: always queries WHERE embedding IS NULL.
    private func startBackgroundEmbedding() {
        guard let projectId = currentProjectId else { return }
        guard ClaudeService.openRouterAPIKey != nil else { return }

        embeddingTask?.cancel()
        isEmbedding = true
        embeddingProgress = 0

        let client = embeddingClient
        let batchSize = embeddingBatchSize

        embeddingTask = Task {
            let totalUnembedded = (try? await DatabaseService.shared.dbQueue.read { db -> Int in
                try Int.fetchOne(db, sql: """
                    SELECT COUNT(*) FROM codeChunks
                    WHERE projectId = ? AND embedding IS NULL
                """, arguments: [projectId]) ?? 0
            }) ?? 0

            guard totalUnembedded > 0 else {
                isEmbedding = false
                embeddingProgress = 1
                return
            }

            var totalProcessed = 0
            let concurrency = 5

            while !Task.isCancelled {
                // Fetch next group of un-embedded chunks
                let groupSize = batchSize * concurrency
                let chunks: [(id: String, content: String)] = (try? await DatabaseService.shared.dbQueue.read { db in
                    let rows = try Row.fetchAll(db, sql: """
                        SELECT id, content FROM codeChunks
                        WHERE projectId = ? AND embedding IS NULL
                        LIMIT ?
                    """, arguments: [projectId, groupSize])
                    return rows.map { (id: $0["id"] as String, content: $0["content"] as String) }
                }) ?? []

                guard !chunks.isEmpty else { break }

                // Split into batches and process concurrently off main actor
                var batches: [[(id: String, content: String)]] = []
                for i in stride(from: 0, to: chunks.count, by: batchSize) {
                    batches.append(Array(chunks[i..<min(i + batchSize, chunks.count)]))
                }

                let batchesCopy = batches
                // Use structured child tasks (not Task.detached) so cancellation propagates
                let groupProcessed = await withTaskGroup(of: Int.self, returning: Int.self) { group in
                    for batch in batchesCopy {
                        group.addTask {
                            guard !Task.isCancelled else { return 0 }
                            let texts = batch.map { $0.content }
                            let result = await client.embedBatch(texts)
                            try? await DatabaseService.shared.dbQueue.write { db in
                                for (i, item) in batch.enumerated() {
                                    if i < result.embeddings.count && !result.embeddings[i].isEmpty {
                                        let encoded = CodeChunk.encodeEmbedding(result.embeddings[i])
                                        try db.execute(
                                            sql: "UPDATE codeChunks SET embedding = ? WHERE id = ?",
                                            arguments: [encoded, item.id]
                                        )
                                    }
                                }
                            }
                            return batch.count
                        }
                    }
                    var sum = 0
                    for await count in group { sum += count }
                    return sum
                }

                guard !Task.isCancelled else { break }

                totalProcessed += groupProcessed
                embeddingProgress = min(Double(totalProcessed) / Double(totalUnembedded), 1.0)
            }

            if !Task.isCancelled {
                isEmbedding = false
                embeddingProgress = 1
            }
        }
    }

    // MARK: - Helpers

    /// Nonisolated static file enumeration for use from detached tasks
    private nonisolated static func enumerateFilesOffMain(at path: String, skipDirs: Set<String>, skipExtensions: Set<String>) -> [(String, URL)] {
        let fm = FileManager.default
        var results: [(String, URL)] = []

        guard let enumerator = fm.enumerator(
            at: URL(fileURLWithPath: path),
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return results }

        for case let fileURL as URL in enumerator {
            let relativePath = fileURL.path.replacingOccurrences(of: path + "/", with: "")

            // Skip directories
            if skipDirs.contains(where: { relativePath.hasPrefix($0 + "/") || relativePath == $0 }) {
                continue
            }

            // Skip non-indexable extensions
            let ext = fileURL.pathExtension.lowercased()
            if skipExtensions.contains(ext) { continue }

            // Only index known file types
            let pathExt = (relativePath as NSString).pathExtension.lowercased()
            if skipExtensions.contains(pathExt) { continue }
            guard CodeChunker.isIndexable(relativePath) else { continue }

            guard let values = try? fileURL.resourceValues(forKeys: [.isRegularFileKey]),
                  values.isRegularFile == true else { continue }

            results.append((relativePath, fileURL))
        }

        return results
    }

    private func shouldIndex(relativePath: String) -> Bool {
        // Check skip dirs
        if skipDirs.contains(where: { relativePath.hasPrefix($0 + "/") }) { return false }

        // Check extension
        let ext = (relativePath as NSString).pathExtension.lowercased()
        if skipExtensions.contains(ext) { return false }

        return CodeChunker.isIndexable(relativePath)
    }

    private nonisolated func sha256(_ string: String) -> String {
        return Self.sha256Static(string)
    }

    private nonisolated static func sha256Static(_ string: String) -> String {
        let data = Data(string.utf8)
        let hash = SHA256.hash(data: data)
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    private func cleanupOrphanedFiles(projectId: String, projectPath: String) async throws {
        // Use write instead of read to avoid GRDB read isolation path crash
        let indexed = try await DatabaseService.shared.dbQueue.write { db in
            try IndexedFile.filter(Column("projectId") == projectId).fetchAll(db)
        }

        // Collect orphaned file IDs with filesystem checks OUTSIDE the DB lock
        let fm = FileManager.default
        var orphanedIds: [String] = []
        for file in indexed {
            if file.relativePath == ".git/history" { continue }
            let fullPath = (projectPath as NSString).appendingPathComponent(file.relativePath)
            if !fm.fileExists(atPath: fullPath) {
                orphanedIds.append(file.id)
            }
        }

        // Also clean up orphaned chunks that reference non-existent file records
        // (e.g., from prior partial git history writes)
        let orphanedChunkFileIds = try await DatabaseService.shared.dbQueue.write { db -> [String] in
            let rows = try Row.fetchAll(db, sql: """
                SELECT DISTINCT cc.fileId FROM codeChunks cc
                LEFT JOIN indexedFiles inf ON cc.fileId = inf.id
                WHERE cc.projectId = ? AND inf.id IS NULL
            """, arguments: [projectId])
            return rows.map { $0["fileId"] as String }
        }

        let allOrphanedFileIds = Array(Set(orphanedIds + orphanedChunkFileIds))
        guard !allOrphanedFileIds.isEmpty else { return }

        // Single batched delete transaction — avoids per-file lock contention
        try await DatabaseService.shared.dbQueue.write { db in
            for fileId in allOrphanedFileIds {
                try db.execute(sql: "DELETE FROM codeChunks WHERE fileId = ?", arguments: [fileId])
                try db.execute(sql: "DELETE FROM indexedFiles WHERE id = ?", arguments: [fileId])
            }
        }
        print("ContextEngine: cleaned up \(allOrphanedFileIds.count) orphaned file(s)")
    }

    private func updateIndexState(projectId: String, status: String, totalChunks: Int? = nil, error: String? = nil) async {
        try? await DatabaseService.shared.dbQueue.write { db in
            var state = try IndexState
                .filter(Column("projectId") == projectId)
                .fetchOne(db) ?? IndexState(
                    projectId: projectId,
                    status: status,
                    totalChunks: 0
                )
            state.status = status
            if let total = totalChunks { state.totalChunks = total }
            if let error = error { state.lastError = error }
            if status == "ready" { state.lastFullIndexAt = Date() }
            try state.save(db)
        }
    }

    private func updateTotalChunks(projectId: String) async {
        // Use write instead of read to avoid GRDB read isolation path crash (swift_unexpectedError)
        let count = try? await DatabaseService.shared.dbQueue.write { db -> Int in
            try CodeChunk.filter(Column("projectId") == projectId).fetchCount(db)
        }
        if let count = count {
            totalChunks = count
            await updateIndexState(projectId: projectId, status: "ready", totalChunks: count)
        }
    }
}

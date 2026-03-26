import Foundation
import SwiftUI

// MARK: - Architecture Graph Models

struct ArchNode: Identifiable {
    let id: String          // relative file path
    let name: String        // filename
    let directory: String   // parent directory
    let fileType: String    // extension
    var imports: [String]   // relative paths of imported files
    var position: CGPoint = .zero
}

struct ArchEdge: Identifiable {
    let id: String
    let from: String
    let to: String
}

// MARK: - Schema Models

struct SchemaTable: Identifiable {
    let id: String          // table name
    let name: String
    var columns: [SchemaColumn]
    var position: CGPoint = .zero
}

struct SchemaColumn: Identifiable {
    let id: String
    let name: String
    let type: String
    let isPrimaryKey: Bool
    let isForeignKey: Bool
    let references: String? // "tableName" if FK
}

// MARK: - File Tree Models

struct FileNode: Identifiable {
    let id: String          // relative path
    let name: String
    let size: Int           // bytes
    let lineCount: Int
    let fileType: String
    let lastModified: Date
    var rect: CGRect = .zero
}

// MARK: - Git Graph Models

struct GitCommit: Identifiable {
    let id: String          // SHA
    let shortSHA: String
    let message: String
    let author: String
    let date: Date
    let branches: [String]
    let isMerge: Bool
}

// MARK: - ProjectAnalyzer

/// Scans project files for architecture, schema, file tree, and git data.
@MainActor
class ProjectAnalyzer: ObservableObject {
    @Published var archNodes: [ArchNode] = []
    @Published var archEdges: [ArchEdge] = []
    @Published var schemaTables: [SchemaTable] = []
    @Published var fileNodes: [FileNode] = []
    @Published var gitCommits: [GitCommit] = []
    @Published var isScanning = false

    private var projectPath: String?

    func scan(projectPath: String) {
        self.projectPath = projectPath
        isScanning = true

        Task.detached {
            let arch = Self.performArchScan(at: projectPath)
            let schema = Self.performSchemaScan(at: projectPath)
            let files = Self.performFileTreeScan(at: projectPath)
            let git = Self.performGitHistoryScan(at: projectPath)

            await MainActor.run { [weak self] in
                self?.archNodes = arch.nodes
                self?.archEdges = arch.edges
                self?.schemaTables = schema
                self?.fileNodes = files
                self?.gitCommits = git
                self?.isScanning = false
            }
        }
    }

    // MARK: - Architecture Scanner

    nonisolated static func performArchScan(at path: String) -> (nodes: [ArchNode], edges: [ArchEdge]) {
        let fm = FileManager.default
        let extensions = ["swift", "ts", "tsx", "js", "jsx", "dart", "py", "rs", "go"]
        let rootURL = URL(fileURLWithPath: path)

        var nodes: [String: ArchNode] = [:]
        var allFiles: [(String, URL)] = []

        // Collect source files
        if let enumerator = fm.enumerator(at: rootURL, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) {
            for case let fileURL as URL in enumerator {
                let ext = fileURL.pathExtension
                guard extensions.contains(ext) else { continue }

                let relativePath = fileURL.path.replacingOccurrences(of: path + "/", with: "")

                let skipDirs = ["node_modules", ".build", "build", ".dart_tool", "__pycache__", ".next", "dist", ".git"]
                if skipDirs.contains(where: { relativePath.hasPrefix($0 + "/") }) { continue }

                allFiles.append((relativePath, fileURL))
                let dir = (relativePath as NSString).deletingLastPathComponent
                nodes[relativePath] = ArchNode(
                    id: relativePath,
                    name: fileURL.lastPathComponent,
                    directory: dir.isEmpty ? "." : dir,
                    fileType: ext,
                    imports: []
                )
            }
        }

        // Parse imports
        let fileSet = Set(allFiles.map { $0.0 })
        for (relativePath, fileURL) in allFiles {
            guard let content = try? String(contentsOf: fileURL, encoding: .utf8) else { continue }
            let imports = parseImports(content: content, fileType: fileURL.pathExtension, currentPath: relativePath, allFiles: fileSet)
            nodes[relativePath]?.imports = imports
        }

        // Build edges
        var edges: [ArchEdge] = []
        for (path, node) in nodes {
            for imp in node.imports {
                edges.append(ArchEdge(id: "\(path)->\(imp)", from: path, to: imp))
            }
        }

        // Layout in a circle
        var sortedNodes = Array(nodes.values).sorted { $0.directory < $1.directory }
        let count = sortedNodes.count
        let radius: CGFloat = max(150, CGFloat(count) * 8)
        let center = CGPoint(x: radius + 60, y: radius + 60)

        for i in 0..<count {
            let angle = (CGFloat(i) / CGFloat(max(count, 1))) * 2 * .pi - .pi / 2
            sortedNodes[i].position = CGPoint(
                x: center.x + radius * cos(angle),
                y: center.y + radius * sin(angle)
            )
        }

        return (sortedNodes, edges)
    }

    private nonisolated static func parseImports(content: String, fileType: String, currentPath: String, allFiles: Set<String>) -> [String] {
        var result: [String] = []
        let lines = content.components(separatedBy: .newlines)
        let currentDir = (currentPath as NSString).deletingLastPathComponent

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            var importPath: String?

            // Swift: import ModuleName
            if fileType == "swift" && trimmed.hasPrefix("import ") {
                // Skip system imports, only match local file references
                continue
            }

            // TypeScript/JavaScript: import ... from './path' or require('./path')
            if ["ts", "tsx", "js", "jsx"].contains(fileType) {
                if let match = trimmed.range(of: #"from\s+['"]([^'"]+)['"]"#, options: .regularExpression) {
                    let fromPart = String(trimmed[match])
                    if let pathMatch = fromPart.range(of: #"['"]([^'"]+)['"]"#, options: .regularExpression) {
                        importPath = String(fromPart[pathMatch]).trimmingCharacters(in: CharacterSet(charactersIn: "'\""))
                    }
                }
            }

            // Dart: import 'package:...' or import '...'
            if fileType == "dart" && trimmed.hasPrefix("import ") {
                if let match = trimmed.range(of: #"'([^']+)'"#, options: .regularExpression) {
                    let path = String(trimmed[match]).trimmingCharacters(in: CharacterSet(charactersIn: "'"))
                    if !path.hasPrefix("package:") && !path.hasPrefix("dart:") {
                        importPath = path
                    }
                }
            }

            // Python: from .module import ... or import module
            if fileType == "py" && (trimmed.hasPrefix("from ") || trimmed.hasPrefix("import ")) {
                if trimmed.hasPrefix("from .") || trimmed.hasPrefix("from ..") {
                    let parts = trimmed.split(separator: " ")
                    if parts.count >= 2 {
                        let module = String(parts[1]).replacingOccurrences(of: ".", with: "/") + ".py"
                        importPath = module
                    }
                }
            }

            // Resolve relative import to a file in our set
            if let imp = importPath, imp.hasPrefix(".") {
                let resolved = resolveRelativePath(imp, from: currentDir)
                // Try with extensions
                let candidates = [resolved, resolved + ".ts", resolved + ".tsx", resolved + ".js", resolved + ".jsx",
                                  resolved + ".dart", resolved + "/index.ts", resolved + "/index.js"]
                for candidate in candidates {
                    if allFiles.contains(candidate) {
                        result.append(candidate)
                        break
                    }
                }
            }
        }

        return result
    }

    private nonisolated static func resolveRelativePath(_ importPath: String, from currentDir: String) -> String {
        var parts = currentDir.split(separator: "/").map(String.init)
        let importParts = importPath.split(separator: "/").map(String.init)

        for part in importParts {
            if part == "." { continue }
            if part == ".." { if !parts.isEmpty { parts.removeLast() } }
            else { parts.append(part) }
        }

        return parts.joined(separator: "/")
    }

    // MARK: - Schema Scanner

    nonisolated static func performSchemaScan(at path: String) -> [SchemaTable] {
        let fm = FileManager.default
        var tables: [SchemaTable] = []

        // Check for Prisma schema
        let prismaPath = "\(path)/prisma/schema.prisma"
        if fm.fileExists(atPath: prismaPath),
           let content = try? String(contentsOfFile: prismaPath, encoding: .utf8) {
            tables.append(contentsOf: parsePrismaSchema(content))
        }

        // Check for SQL migrations / schema files
        let sqlPaths = ["\(path)/schema.sql", "\(path)/supabase/schema.sql"]
        for sqlPath in sqlPaths {
            if fm.fileExists(atPath: sqlPath),
               let content = try? String(contentsOfFile: sqlPath, encoding: .utf8) {
                tables.append(contentsOf: parseSQLSchema(content))
            }
        }

        // Check for GRDB / Swift model files
        if fm.fileExists(atPath: "\(path)/Package.swift") {
            tables.append(contentsOf: scanSwiftModels(at: path))
        }

        // Check for Django models.py
        let djangoPath = "\(path)/models.py"
        if fm.fileExists(atPath: djangoPath),
           let content = try? String(contentsOfFile: djangoPath, encoding: .utf8) {
            tables.append(contentsOf: parseDjangoModels(content))
        }

        // Layout tables in a grid
        let cols = max(1, Int(ceil(sqrt(Double(tables.count)))))
        for i in 0..<tables.count {
            let row = i / cols
            let col = i % cols
            tables[i].position = CGPoint(x: 30 + col * 260, y: 30 + row * 220)
        }

        return tables
    }

    private nonisolated static func parsePrismaSchema(_ content: String) -> [SchemaTable] {
        var tables: [SchemaTable] = []
        let lines = content.components(separatedBy: .newlines)
        var currentModel: String?
        var currentColumns: [SchemaColumn] = []

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("model ") {
                if let name = currentModel {
                    tables.append(SchemaTable(id: name, name: name, columns: currentColumns))
                }
                currentModel = trimmed.replacingOccurrences(of: "model ", with: "")
                    .replacingOccurrences(of: " {", with: "")
                    .trimmingCharacters(in: .whitespaces)
                currentColumns = []
            } else if trimmed == "}" {
                if let name = currentModel {
                    tables.append(SchemaTable(id: name, name: name, columns: currentColumns))
                    currentModel = nil
                    currentColumns = []
                }
            } else if currentModel != nil && !trimmed.isEmpty && !trimmed.hasPrefix("//") && !trimmed.hasPrefix("@@") {
                let parts = trimmed.split(separator: " ", maxSplits: 2).map(String.init)
                if parts.count >= 2 {
                    let name = parts[0]
                    let type = parts[1]
                    let isPK = trimmed.contains("@id")
                    let isFK = trimmed.contains("@relation")
                    let ref: String? = isFK ? type.replacingOccurrences(of: "?", with: "").replacingOccurrences(of: "[]", with: "") : nil
                    currentColumns.append(SchemaColumn(id: "\(currentModel!).\(name)", name: name, type: type, isPrimaryKey: isPK, isForeignKey: isFK, references: ref))
                }
            }
        }

        return tables
    }

    private nonisolated static func parseSQLSchema(_ content: String) -> [SchemaTable] {
        var tables: [SchemaTable] = []
        let pattern = #"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["\`]?(\w+)["\`]?\s*\(([\s\S]*?)\);"#

        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
        let matches = regex.matches(in: content, range: NSRange(content.startIndex..., in: content))

        for match in matches {
            guard let nameRange = Range(match.range(at: 1), in: content),
                  let bodyRange = Range(match.range(at: 2), in: content) else { continue }

            let tableName = String(content[nameRange])
            let body = String(content[bodyRange])
            var columns: [SchemaColumn] = []

            for line in body.components(separatedBy: ",") {
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty,
                      !trimmed.uppercased().hasPrefix("PRIMARY KEY"),
                      !trimmed.uppercased().hasPrefix("FOREIGN KEY"),
                      !trimmed.uppercased().hasPrefix("UNIQUE"),
                      !trimmed.uppercased().hasPrefix("CONSTRAINT"),
                      !trimmed.uppercased().hasPrefix("CHECK")
                else { continue }

                let parts = trimmed.split(separator: " ", maxSplits: 2).map(String.init)
                if parts.count >= 2 {
                    let colName = parts[0].trimmingCharacters(in: CharacterSet(charactersIn: "\"`"))
                    let colType = parts[1]
                    let isPK = trimmed.uppercased().contains("PRIMARY KEY")
                    let isFK = trimmed.uppercased().contains("REFERENCES")
                    var ref: String?
                    if isFK, let refMatch = trimmed.range(of: #"REFERENCES\s+["\`]?(\w+)"#, options: [.regularExpression, .caseInsensitive]) {
                        let refStr = String(trimmed[refMatch])
                        ref = refStr.split(separator: " ").last.map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: "\"`(")) }
                    }
                    columns.append(SchemaColumn(id: "\(tableName).\(colName)", name: colName, type: colType, isPrimaryKey: isPK, isForeignKey: isFK, references: ref))
                }
            }

            tables.append(SchemaTable(id: tableName, name: tableName, columns: columns))
        }

        return tables
    }

    private nonisolated static func scanSwiftModels(at path: String) -> [SchemaTable] {
        // Look for GRDB model files with databaseTableName
        let fm = FileManager.default
        var tables: [SchemaTable] = []

        guard let enumerator = fm.enumerator(at: URL(fileURLWithPath: path), includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) else { return [] }

        for case let fileURL as URL in enumerator {
            guard fileURL.pathExtension == "swift" else { continue }
            let relativePath = fileURL.path.replacingOccurrences(of: path + "/", with: "")
            if relativePath.hasPrefix(".build/") { continue }

            guard let content = try? String(contentsOf: fileURL, encoding: .utf8),
                  content.contains("databaseTableName") else { continue }

            // Extract table name
            if let nameMatch = content.range(of: #"databaseTableName\s*=\s*"(\w+)""#, options: .regularExpression) {
                let match = String(content[nameMatch])
                let tableName = match.split(separator: "\"")[1]

                // Extract var properties
                var columns: [SchemaColumn] = []
                let lines = content.components(separatedBy: .newlines)
                for line in lines {
                    let trimmed = line.trimmingCharacters(in: .whitespaces)
                    if trimmed.hasPrefix("var ") && trimmed.contains(":") && !trimmed.contains("databaseTableName") && !trimmed.contains("{") {
                        let parts = trimmed.replacingOccurrences(of: "var ", with: "").split(separator: ":").map { $0.trimmingCharacters(in: .whitespaces) }
                        if parts.count >= 2 {
                            let name = parts[0]
                            let type = parts[1].components(separatedBy: " ").first ?? parts[1]
                            let isPK = name == "id"
                            columns.append(SchemaColumn(id: "\(tableName).\(name)", name: name, type: type, isPrimaryKey: isPK, isForeignKey: false, references: nil))
                        }
                    }
                }

                if !columns.isEmpty {
                    tables.append(SchemaTable(id: String(tableName), name: String(tableName), columns: columns))
                }
            }
        }

        return tables
    }

    private nonisolated static func parseDjangoModels(_ content: String) -> [SchemaTable] {
        // Simplified Django model parser
        var tables: [SchemaTable] = []
        let lines = content.components(separatedBy: .newlines)
        var currentModel: String?
        var currentColumns: [SchemaColumn] = []

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("class ") && trimmed.contains("models.Model") {
                if let name = currentModel, !currentColumns.isEmpty {
                    tables.append(SchemaTable(id: name, name: name, columns: currentColumns))
                }
                currentModel = trimmed.replacingOccurrences(of: "class ", with: "").components(separatedBy: "(").first?.trimmingCharacters(in: .whitespaces)
                currentColumns = []
            } else if currentModel != nil && trimmed.contains("models.") && trimmed.contains("=") {
                let parts = trimmed.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                if parts.count == 2 {
                    let name = parts[0]
                    let fieldType = parts[1].components(separatedBy: "(").first ?? parts[1]
                    let isFK = fieldType.contains("ForeignKey")
                    currentColumns.append(SchemaColumn(id: "\(currentModel!).\(name)", name: name, type: fieldType, isPrimaryKey: false, isForeignKey: isFK, references: nil))
                }
            }
        }

        if let name = currentModel, !currentColumns.isEmpty {
            tables.append(SchemaTable(id: name, name: name, columns: currentColumns))
        }

        return tables
    }

    // MARK: - File Tree Scanner

    nonisolated static func performFileTreeScan(at path: String) -> [FileNode] {
        let fm = FileManager.default
        let rootURL = URL(fileURLWithPath: path)
        var nodes: [FileNode] = []

        let skipDirs = Set(["node_modules", ".build", "build", ".dart_tool", "__pycache__",
                            ".next", "dist", ".git", ".gradle", "Pods", ".pub-cache",
                            ".pub", "ios/Pods", "android/.gradle"])

        guard let enumerator = fm.enumerator(at: rootURL, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey], options: [.skipsHiddenFiles]) else { return [] }

        for case let fileURL as URL in enumerator {
            let relativePath = fileURL.path.replacingOccurrences(of: path + "/", with: "")
            if skipDirs.contains(where: { relativePath.hasPrefix($0 + "/") || relativePath == $0 }) { continue }

            guard let values = try? fileURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]),
                  values.isRegularFile == true else { continue }

            let size = values.fileSize ?? 0
            let modified = values.contentModificationDate ?? Date.distantPast
            let ext = fileURL.pathExtension

            let lineCount = max(1, size / 40)

            nodes.append(FileNode(
                id: relativePath,
                name: fileURL.lastPathComponent,
                size: size,
                lineCount: lineCount,
                fileType: ext.isEmpty ? "other" : ext,
                lastModified: modified
            ))
        }

        nodes.sort { $0.size > $1.size }
        if nodes.count > 200 { nodes = Array(nodes.prefix(200)) }

        return nodes
    }

    // MARK: - Git History Scanner

    nonisolated static func performGitHistoryScan(at path: String) -> [GitCommit] {
        let process = Process()
        let pipe = Pipe()

        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["log", "--all", "--oneline", "--decorate", "--format=%H|%h|%s|%an|%aI|%D", "-100"]
        process.currentDirectoryURL = URL(fileURLWithPath: path)
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            return []
        }

        // Read pipe data BEFORE waitUntilExit() to avoid deadlock when output exceeds 64KB.
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard let output = String(data: data, encoding: .utf8) else { return [] }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]

        var commits: [GitCommit] = []

        for line in output.components(separatedBy: .newlines) {
            let parts = line.split(separator: "|", maxSplits: 5).map(String.init)
            guard parts.count >= 5 else { continue }

            let sha = parts[0]
            let shortSHA = parts[1]
            let message = parts[2]
            let author = parts[3]
            let dateStr = parts[4]
            let refs = parts.count > 5 ? parts[5] : ""

            let date = formatter.date(from: dateStr) ?? Date()
            let branches = refs.components(separatedBy: ", ")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty && !$0.contains("HEAD") }
                .map { $0.replacingOccurrences(of: "origin/", with: "") }

            let isMerge = message.lowercased().hasPrefix("merge")

            commits.append(GitCommit(
                id: sha,
                shortSHA: shortSHA,
                message: message,
                author: author,
                date: date,
                branches: branches,
                isMerge: isMerge
            ))
        }

        return commits
    }
}

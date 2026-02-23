import Foundation

class FileTreeNode: Identifiable, ObservableObject {
    let id: String // relative path from project root
    let name: String
    let isDirectory: Bool
    let fullPath: URL
    let depth: Int

    var children: [FileTreeNode]?
    var isExpanded: Bool = false

    init(id: String, name: String, isDirectory: Bool, fullPath: URL, depth: Int) {
        self.id = id
        self.name = name
        self.isDirectory = isDirectory
        self.fullPath = fullPath
        self.depth = depth
    }

    // MARK: - Skip Directories

    static let skipDirectories: Set<String> = [
        "node_modules", ".build", "build", ".dart_tool", "__pycache__",
        ".next", "dist", ".git", ".gradle", "Pods", ".pub-cache",
        ".pub", "ios/Pods", "android/.gradle", ".swiftpm", "DerivedData",
        ".expo", "coverage", "vendor", "target", ".claude"
    ]

    // MARK: - Sorted Children

    var sortedChildren: [FileTreeNode] {
        guard let children else { return [] }
        return children.sorted { a, b in
            if a.isDirectory != b.isDirectory {
                return a.isDirectory // directories first
            }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }

    // MARK: - Lazy Loading

    func loadChildren() {
        guard isDirectory, children == nil else { return }

        let fm = FileManager.default
        guard let contents = try? fm.contentsOfDirectory(
            at: fullPath,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            children = []
            return
        }

        children = contents.compactMap { url in
            let name = url.lastPathComponent
            if Self.skipDirectories.contains(name) { return nil }

            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            let relativePath = id.isEmpty ? name : "\(id)/\(name)"

            return FileTreeNode(
                id: relativePath,
                name: name,
                isDirectory: isDir,
                fullPath: url,
                depth: depth + 1
            )
        }
    }

    // MARK: - Language Detection (reuses CodeChunker mapping)

    static func detectLanguage(from path: String) -> String? {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "swift": return "swift"
        case "ts", "tsx": return "typescript"
        case "js", "jsx": return "javascript"
        case "py": return "python"
        case "rs": return "rust"
        case "go": return "go"
        case "dart": return "dart"
        case "java": return "java"
        case "md", "markdown": return "markdown"
        case "json": return "json"
        case "yaml", "yml": return "yaml"
        case "toml": return "toml"
        case "html", "htm": return "html"
        case "css": return "css"
        case "sh", "bash", "zsh": return "shell"
        case "sql": return "sql"
        case "xml": return "xml"
        case "rb": return "ruby"
        case "c", "h": return "c"
        case "cpp", "cc", "cxx", "hpp": return "cpp"
        default: return nil
        }
    }

    // MARK: - Root Factory

    static func makeRoot(for projectPath: String) -> [FileTreeNode] {
        let rootURL = URL(fileURLWithPath: projectPath)
        let fm = FileManager.default
        guard let contents = try? fm.contentsOfDirectory(
            at: rootURL,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        return contents.compactMap { url in
            let name = url.lastPathComponent
            if skipDirectories.contains(name) { return nil }

            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false

            return FileTreeNode(
                id: name,
                name: name,
                isDirectory: isDir,
                fullPath: url,
                depth: 0
            )
        }.sorted { a, b in
            if a.isDirectory != b.isDirectory {
                return a.isDirectory
            }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }
}

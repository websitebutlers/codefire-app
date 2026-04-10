import SwiftUI

// MARK: - Open File Model

/// One tab in the file viewer. Each tab keeps its own original content,
/// edited buffer, and view state so the user can switch freely without
/// losing in-progress edits.
struct OpenFile: Identifiable {
    let id: String              // matches FileTreeNode.id
    let node: FileTreeNode
    let name: String
    let fullPath: URL
    let language: String?
    var originalContent: String
    var editedContent: String
    var isEditMode: Bool
    var showDiff: Bool
    let isTruncated: Bool
    let isBinary: Bool

    var isDirty: Bool {
        editedContent != originalContent
    }
}

struct FileBrowserView: View {
    @EnvironmentObject var appState: AppState

    @State private var rootNodes: [FileTreeNode] = []
    @State private var selectedNodeId: String?
    @State private var searchText = ""
    @State private var treeVersion = 0

    // Tab state
    @State private var openFiles: [OpenFile] = []
    @State private var activeFileId: String?

    // Dirty-close confirmation
    @State private var closeCandidateId: String? = nil
    @State private var showCloseAlert = false

    private static let maxFileSize = 512 * 1024 // 512 KB
    private static let maxLineCount = 10_000
    private static let maxOpenTabs = 20

    var body: some View {
        Group {
            if appState.currentProject == nil {
                emptyState(
                    icon: "folder",
                    title: "Select a project",
                    subtitle: "Choose a project from the sidebar to browse files"
                )
            } else {
                HSplitView {
                    treePanel
                        .frame(minWidth: 220, idealWidth: 280, maxWidth: 360)

                    viewerPanel
                        .frame(minWidth: 500, idealWidth: 900)
                }
            }
        }
        .onAppear { loadRoot() }
        .onChange(of: appState.currentProject) { _, _ in
            resetAll()
            loadRoot()
        }
        .alert(
            "Discard unsaved changes?",
            isPresented: $showCloseAlert,
            presenting: closeCandidateId
        ) { id in
            Button("Discard", role: .destructive) {
                closeTab(id: id)
            }
            Button("Save") {
                if let file = openFiles.first(where: { $0.id == id }) {
                    saveFile(content: file.editedContent, to: file.fullPath.path, fileId: id)
                    closeTab(id: id)
                }
            }
            Button("Cancel", role: .cancel) {
                closeCandidateId = nil
            }
        } message: { id in
            if let file = openFiles.first(where: { $0.id == id }) {
                Text("\"\(file.name)\" has unsaved changes.")
            } else {
                Text("This file has unsaved changes.")
            }
        }
    }

    // MARK: - Active File Helpers

    private var activeFile: OpenFile? {
        guard let id = activeFileId else { return nil }
        return openFiles.first(where: { $0.id == id })
    }

    private var activeIndex: Int? {
        guard let id = activeFileId else { return nil }
        return openFiles.firstIndex(where: { $0.id == id })
    }

    private var activeEditedContentBinding: Binding<String> {
        Binding(
            get: { activeFile?.editedContent ?? "" },
            set: { newValue in
                if let idx = activeIndex {
                    openFiles[idx].editedContent = newValue
                }
            }
        )
    }

    // MARK: - Tree Panel

    private var treePanel: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                TextField("Filter files…", text: $searchText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(6)
            .padding(.horizontal, 8)
            .padding(.vertical, 8)

            Divider()

            // Tree
            ScrollView {
                LazyVStack(spacing: 1) {
                    let nodes = searchText.isEmpty ? visibleNodes : filteredNodes
                    ForEach(nodes, id: \.id) { node in
                        FileTreeRowView(node: node, isSelected: selectedNodeId == node.id)
                            .onTapGesture {
                                handleNodeTap(node)
                            }
                    }
                    .id(treeVersion)
                }
                .padding(.vertical, 4)
                .padding(.horizontal, 4)
            }
        }
    }

    // MARK: - Viewer Panel

    private var viewerPanel: some View {
        VStack(spacing: 0) {
            if !openFiles.isEmpty {
                tabStrip
                Divider()
            }

            if let file = activeFile {
                fileHeader(for: file)
                Divider()

                if file.isTruncated {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 11))
                            .foregroundColor(.orange)
                        Text("File truncated — showing first portion only")
                            .font(.system(size: 11))
                            .foregroundColor(.orange)
                        Spacer()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.orange.opacity(0.08))
                }

                if file.isBinary {
                    emptyState(
                        icon: "doc.fill",
                        title: "Binary file",
                        subtitle: "This file cannot be previewed as text"
                    )
                } else if file.showDiff {
                    DiffViewerView(filePath: file.fullPath.path)
                } else if file.isEditMode {
                    CodeEditorView(
                        content: activeEditedContentBinding,
                        language: file.language,
                        onCreateTask: { createTask(from: $0) },
                        onAddToNotes: { addToNotes($0) },
                        onInsertIntoTerminal: { insertIntoTerminal($0) }
                    )
                    .background(Color.accentColor.opacity(0.04))
                } else {
                    CodeViewerView(
                        content: file.originalContent,
                        language: file.language,
                        onCreateTask: { createTask(from: $0) },
                        onAddToNotes: { addToNotes($0) },
                        onInsertIntoTerminal: { insertIntoTerminal($0) }
                    )
                }
            } else {
                emptyState(
                    icon: "doc.text",
                    title: "Select a file to view",
                    subtitle: "Click a file in the tree to preview its contents"
                )
            }
        }
        .background {
            // Cmd+S — save active edit
            if let file = activeFile, file.isEditMode {
                Button("") {
                    saveFile(
                        content: file.editedContent,
                        to: file.fullPath.path,
                        fileId: file.id
                    )
                }
                .keyboardShortcut("s", modifiers: .command)
                .frame(width: 0, height: 0)
                .opacity(0)
            }
            // Cmd+W — close active tab
            if activeFileId != nil {
                Button("") {
                    if let id = activeFileId {
                        requestCloseTab(id: id)
                    }
                }
                .keyboardShortcut("w", modifiers: .command)
                .frame(width: 0, height: 0)
                .opacity(0)
            }
        }
    }

    // MARK: - Tab Strip

    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(openFiles) { file in
                    FileTabButton(
                        file: file,
                        isActive: file.id == activeFileId,
                        onActivate: {
                            activeFileId = file.id
                            selectedNodeId = file.id
                        },
                        onClose: {
                            requestCloseTab(id: file.id)
                        }
                    )
                }
            }
        }
        .frame(height: 32)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - File Header (toolbar)

    private func fileHeader(for file: OpenFile) -> some View {
        HStack(spacing: 8) {
            if file.isDirty {
                Circle()
                    .fill(Color.orange)
                    .frame(width: 7, height: 7)
                    .help("Unsaved changes")
            }

            Text(file.name)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundColor(.primary)

            if let lang = file.language {
                Text(lang)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color(nsColor: .separatorColor).opacity(0.2))
                    )
            }

            modePill(file: file)

            Spacer()

            if !file.isBinary {
                // Diff toggle
                toolbarIconButton(
                    icon: file.showDiff
                        ? "arrow.left.arrow.right.circle.fill"
                        : "arrow.left.arrow.right.circle",
                    active: file.showDiff,
                    help: "Toggle Git Diff"
                ) {
                    if let idx = activeIndex {
                        openFiles[idx].showDiff.toggle()
                        if openFiles[idx].showDiff {
                            openFiles[idx].isEditMode = false
                        }
                    }
                }

                // Edit / View toggle
                toolbarIconButton(
                    icon: file.isEditMode ? "pencil.circle.fill" : "pencil.circle",
                    active: file.isEditMode,
                    help: file.isEditMode ? "Switch to Read Mode" : "Switch to Edit Mode"
                ) {
                    if let idx = activeIndex {
                        openFiles[idx].isEditMode.toggle()
                        if openFiles[idx].isEditMode {
                            openFiles[idx].showDiff = false
                        }
                    }
                }

                // Save button — only in edit mode
                if file.isEditMode {
                    Button {
                        saveFile(
                            content: file.editedContent,
                            to: file.fullPath.path,
                            fileId: file.id
                        )
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "square.and.arrow.down")
                                .font(.system(size: 10))
                            Text("Save")
                                .font(.system(size: 11, weight: .medium))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(
                            file.isDirty
                                ? Color.accentColor
                                : Color.accentColor.opacity(0.15)
                        )
                        .foregroundColor(file.isDirty ? .white : .accentColor)
                        .cornerRadius(6)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(Color.accentColor.opacity(0.3), lineWidth: 0.5)
                        )
                    }
                    .buttonStyle(.plain)
                    .help("Save (⌘S)")
                    .disabled(!file.isDirty)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            file.isEditMode
                ? Color.accentColor.opacity(0.06)
                : Color.clear
        )
    }

    private func modePill(file: OpenFile) -> some View {
        HStack(spacing: 4) {
            Image(systemName: file.isEditMode ? "pencil" : "eye")
                .font(.system(size: 9, weight: .bold))
            Text(file.isEditMode ? "EDITING" : "READ")
                .font(.system(size: 9, weight: .heavy))
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(file.isEditMode ? Color.accentColor : Color.secondary.opacity(0.4))
        )
        .foregroundColor(.white)
    }

    private func toolbarIconButton(
        icon: String,
        active: Bool,
        help: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(active ? .accentColor : .secondary)
        }
        .buttonStyle(.plain)
        .help(help)
    }

    // MARK: - Empty State

    private func emptyState(icon: String, title: String, subtitle: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.secondary)
            Text(subtitle)
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Tree Traversal

    private var visibleNodes: [FileTreeNode] {
        var result: [FileTreeNode] = []
        func walk(_ nodes: [FileTreeNode]) {
            for node in nodes.sorted(by: { a, b in
                if a.isDirectory != b.isDirectory { return a.isDirectory }
                return a.name.localizedStandardCompare(b.name) == .orderedAscending
            }) {
                result.append(node)
                if node.isDirectory && node.isExpanded {
                    walk(node.sortedChildren)
                }
            }
        }
        walk(rootNodes)
        return result
    }

    private var filteredNodes: [FileTreeNode] {
        let query = searchText.lowercased()
        var result: [FileTreeNode] = []
        func walk(_ nodes: [FileTreeNode]) {
            for node in nodes {
                if !node.isDirectory && node.name.lowercased().contains(query) {
                    result.append(node)
                }
                if node.isDirectory, let children = node.children {
                    walk(children)
                } else if node.isDirectory {
                    node.loadChildren()
                    walk(node.sortedChildren)
                }
            }
        }
        walk(rootNodes)
        return result.sorted {
            $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }

    // MARK: - Tree Tap

    private func handleNodeTap(_ node: FileTreeNode) {
        if node.isDirectory {
            node.loadChildren()
            node.isExpanded.toggle()
            treeVersion += 1
            return
        }

        selectedNodeId = node.id

        // Already open? just activate
        if openFiles.contains(where: { $0.id == node.id }) {
            activeFileId = node.id
            return
        }

        // Cap number of open tabs — evict the oldest non-dirty tab
        if openFiles.count >= Self.maxOpenTabs,
           let oldest = openFiles.first(where: { !$0.isDirty }) {
            closeTab(id: oldest.id)
        }

        openFile(node)
    }

    // MARK: - File Loading

    private func openFile(_ node: FileTreeNode) {
        let url = node.fullPath
        let language = FileTreeNode.detectLanguage(from: node.name)

        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? Int else {
            appendBinary(node: node, url: url, language: language)
            return
        }

        let readSize = min(size, Self.maxFileSize)
        guard let fileHandle = try? FileHandle(forReadingFrom: url) else {
            appendBinary(node: node, url: url, language: language)
            return
        }
        defer { fileHandle.closeFile() }

        let data = fileHandle.readData(ofLength: readSize)

        guard var text = String(data: data, encoding: .utf8) else {
            appendBinary(node: node, url: url, language: language)
            return
        }

        var truncated = size > Self.maxFileSize
        let lines = text.components(separatedBy: "\n")
        if lines.count > Self.maxLineCount {
            text = lines.prefix(Self.maxLineCount).joined(separator: "\n")
            truncated = true
        }

        let file = OpenFile(
            id: node.id,
            node: node,
            name: node.name,
            fullPath: url,
            language: language,
            originalContent: text,
            editedContent: text,
            isEditMode: false,
            showDiff: false,
            isTruncated: truncated,
            isBinary: false
        )
        openFiles.append(file)
        activeFileId = file.id
    }

    private func appendBinary(node: FileTreeNode, url: URL, language: String?) {
        let file = OpenFile(
            id: node.id,
            node: node,
            name: node.name,
            fullPath: url,
            language: language,
            originalContent: "",
            editedContent: "",
            isEditMode: false,
            showDiff: false,
            isTruncated: false,
            isBinary: true
        )
        openFiles.append(file)
        activeFileId = file.id
    }

    // MARK: - Save

    private func saveFile(content: String, to path: String, fileId: String) {
        do {
            try content.write(toFile: path, atomically: true, encoding: .utf8)
            if let idx = openFiles.firstIndex(where: { $0.id == fileId }) {
                openFiles[idx].originalContent = content
                openFiles[idx].editedContent = content
            }
        } catch {
            print("FileBrowserView: failed to save file: \(error)")
        }
    }

    // MARK: - Tab Close

    private func requestCloseTab(id: String) {
        guard let file = openFiles.first(where: { $0.id == id }) else { return }
        if file.isDirty {
            closeCandidateId = id
            showCloseAlert = true
        } else {
            closeTab(id: id)
        }
    }

    private func closeTab(id: String) {
        guard let idx = openFiles.firstIndex(where: { $0.id == id }) else { return }
        let wasActive = activeFileId == id
        openFiles.remove(at: idx)

        if wasActive {
            if openFiles.isEmpty {
                activeFileId = nil
                selectedNodeId = nil
            } else {
                let newIdx = min(idx, openFiles.count - 1)
                activeFileId = openFiles[newIdx].id
                selectedNodeId = openFiles[newIdx].id
            }
        }
        closeCandidateId = nil
    }

    // MARK: - Context Menu Actions

    private func createTask(from content: String) {
        let title = "File: " + String(content.prefix(60))
            .replacingOccurrences(of: "\n", with: " ")
        var task = TaskItem(
            id: nil,
            projectId: appState.currentProject?.id ?? "__global__",
            title: title,
            description: content,
            status: "todo",
            priority: 2,
            sourceSession: nil,
            source: "file",
            createdAt: Date(),
            completedAt: nil,
            labels: nil,
            attachments: nil
        )
        task.setLabels(["feature"])
        do {
            try DatabaseService.shared.dbQueue.write { db in
                try task.insert(db)
            }
            NotificationCenter.default.post(name: .tasksDidChange, object: nil)
        } catch {
            print("FileBrowserView: failed to create task: \(error)")
        }
    }

    private func addToNotes(_ content: String) {
        let title = "File: " + String(content.prefix(60))
            .replacingOccurrences(of: "\n", with: " ")
        var note = Note(
            projectId: appState.currentProject?.id ?? "__global__",
            title: title,
            content: content,
            pinned: false,
            createdAt: Date(),
            updatedAt: Date()
        )
        if appState.currentProject == nil {
            note.isGlobal = true
        }
        do {
            try DatabaseService.shared.dbQueue.write { db in
                try note.insert(db)
            }
        } catch {
            print("FileBrowserView: failed to create note: \(error)")
        }
    }

    private func insertIntoTerminal(_ content: String) {
        NotificationCenter.default.post(
            name: .insertIntoTerminal,
            object: nil,
            userInfo: ["text": content]
        )
    }

    // MARK: - Lifecycle

    private func loadRoot() {
        guard let project = appState.currentProject else {
            rootNodes = []
            return
        }
        rootNodes = FileTreeNode.makeRoot(for: project.path)
    }

    private func resetAll() {
        rootNodes = []
        selectedNodeId = nil
        searchText = ""
        openFiles = []
        activeFileId = nil
        closeCandidateId = nil
        showCloseAlert = false
        treeVersion += 1
    }
}

// MARK: - Tab Button

private struct FileTabButton: View {
    let file: OpenFile
    let isActive: Bool
    let onActivate: () -> Void
    let onClose: () -> Void

    @State private var isHovering = false

    var body: some View {
        HStack(spacing: 6) {
            if file.isDirty {
                Circle()
                    .fill(Color.orange)
                    .frame(width: 6, height: 6)
            } else {
                Image(systemName: fileIcon)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }

            Text(file.name)
                .font(.system(size: 11, weight: isActive ? .medium : .regular))
                .foregroundColor(isActive ? .primary : .secondary)
                .lineLimit(1)

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundColor(.secondary)
                    .frame(width: 14, height: 14)
                    .background(
                        Circle()
                            .fill(
                                isHovering
                                    ? Color(nsColor: .separatorColor).opacity(0.3)
                                    : Color.clear
                            )
                    )
            }
            .buttonStyle(.plain)
            .opacity(isHovering || isActive || file.isDirty ? 1 : 0.4)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            ZStack {
                if isActive {
                    Color(nsColor: .controlBackgroundColor)
                } else if isHovering {
                    Color(nsColor: .separatorColor).opacity(0.15)
                }
            }
        )
        .overlay(alignment: .bottom) {
            if isActive {
                Rectangle()
                    .fill(Color.accentColor)
                    .frame(height: 2)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onActivate)
        .onHover { hovering in
            isHovering = hovering
        }
    }

    private var fileIcon: String {
        switch file.language {
        case "swift": return "swift"
        case "typescript", "javascript": return "curlybraces"
        case "python": return "chevron.left.forwardslash.chevron.right"
        case "json", "markdown": return "doc.text"
        default: return "doc"
        }
    }
}

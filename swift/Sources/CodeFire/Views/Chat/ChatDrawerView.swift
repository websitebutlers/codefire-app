import SwiftUI
import GRDB

struct ChatDrawerView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var claudeService = ClaudeService()
    @Binding var isOpen: Bool

    @State private var conversations: [ChatConversation] = []
    @State private var currentConversation: ChatConversation?
    @State private var messages: [ChatMessage] = []
    @State private var inputText = ""
    @State private var showSettings = false
    @FocusState private var isInputFocused: Bool

    private var projectId: String? {
        appState.currentProject?.id
    }

    private var contextLabel: String {
        appState.currentProject?.name ?? "All Projects"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            header
            Divider()

            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if messages.isEmpty && !claudeService.isGenerating {
                            emptyState
                        }
                        ForEach(messages) { msg in
                            ChatMessageView(
                                message: msg,
                                projectId: projectId,
                                onCreateTask: { content in createTask(from: content) },
                                onAddToNotes: { content in addToNotes(content) },
                                onSendToTerminal: { content in sendToTerminal(content) }
                            )
                            .id(msg.id)
                        }
                        if claudeService.isGenerating {
                            ThinkingIndicator()
                                .padding(.horizontal, 12)
                                .id("loading")
                        }
                    }
                    .padding(12)
                }
                .onChange(of: messages.count) { _, _ in
                    if let lastId = messages.last?.id {
                        withAnimation { proxy.scrollTo(lastId, anchor: .bottom) }
                    }
                }
                .onChange(of: claudeService.isGenerating) { _, isGenerating in
                    if isGenerating {
                        withAnimation {
                            proxy.scrollTo("loading", anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            // Input bar
            inputBar
        }
        .frame(width: 380)
        .background(Color(nsColor: .controlBackgroundColor))
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(Color(nsColor: .separatorColor).opacity(0.5))
                .frame(width: 1)
        }
        .shadow(color: .black.opacity(0.3), radius: 12, x: -4, y: 0)
        .onAppear { loadConversations() }
        .onChange(of: appState.currentProject?.id) { _, _ in
            loadConversations()
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Chat")
                    .font(.system(size: 13, weight: .semibold))
                Text(contextLabel)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Conversation picker
            if conversations.count > 1 {
                Menu {
                    ForEach(conversations) { conv in
                        Button {
                            selectConversation(conv)
                        } label: {
                            Text(conv.title)
                        }
                    }
                } label: {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 11))
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help("Previous conversations")
            }

            Button {
                newConversation()
            } label: {
                Image(systemName: "plus.bubble")
                    .font(.system(size: 11))
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("New conversation")

            Button {
                showSettings.toggle()
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 11))
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundColor(.secondary)
            .help("Chat settings")
            .popover(isPresented: $showSettings) {
                ChatSettingsPopover()
            }

            Button {
                isOpen = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .medium))
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundColor(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "bubble.right")
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)
            Text("Ask anything about \(contextLabel)")
                .font(.system(size: 12))
                .foregroundStyle(.tertiary)
            Text("Tasks, sessions, architecture, code flows...")
                .font(.system(size: 10))
                .foregroundStyle(.quaternary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("Ask about \(contextLabel)...", text: $inputText, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.system(size: 12))
                .lineLimit(1...5)
                .focused($isInputFocused)
                .onSubmit {
                    if !NSEvent.modifierFlags.contains(.shift) {
                        sendMessage()
                    }
                }

            Button {
                sendMessage()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 20))
                    .foregroundColor(
                        inputText.trimmingCharacters(in: .whitespaces).isEmpty || claudeService.isGenerating
                        ? .secondary.opacity(0.3)
                        : .accentColor
                    )
            }
            .buttonStyle(.plain)
            .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty || claudeService.isGenerating)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Data Operations

    private func loadConversations() {
        let pid = projectId
        do {
            conversations = try DatabaseService.shared.dbQueue.read { db in
                if let pid = pid {
                    return try ChatConversation
                        .filter(Column("projectId") == pid)
                        .order(Column("updatedAt").desc)
                        .limit(20)
                        .fetchAll(db)
                } else {
                    return try ChatConversation
                        .filter(Column("projectId") == nil)
                        .order(Column("updatedAt").desc)
                        .limit(20)
                        .fetchAll(db)
                }
            }
            if let first = conversations.first {
                selectConversation(first)
            } else {
                currentConversation = nil
                messages = []
            }
        } catch {
            print("ChatDrawer: failed to load conversations: \(error)")
        }
    }

    private func selectConversation(_ conversation: ChatConversation) {
        currentConversation = conversation
        do {
            messages = try DatabaseService.shared.dbQueue.read { db in
                try ChatMessage
                    .filter(Column("conversationId") == conversation.id!)
                    .order(Column("createdAt").asc)
                    .fetchAll(db)
            }
        } catch {
            print("ChatDrawer: failed to load messages: \(error)")
        }
    }

    private func newConversation() {
        currentConversation = nil
        messages = []
        inputText = ""
        isInputFocused = true
    }

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, !claudeService.isGenerating else { return }
        inputText = ""

        Task {
            // Create conversation if needed
            if currentConversation == nil {
                let title = String(text.prefix(60)) + (text.count > 60 ? "..." : "")
                var conv = ChatConversation(
                    projectId: projectId,
                    title: title,
                    createdAt: Date(),
                    updatedAt: Date()
                )
                do {
                    try await DatabaseService.shared.dbQueue.write { db in
                        try conv.insert(db)
                    }
                    currentConversation = conv
                    conversations.insert(conv, at: 0)
                } catch {
                    print("ChatDrawer: failed to create conversation: \(error)")
                    return
                }
            }

            guard let convId = currentConversation?.id else { return }

            // Save user message
            var userMsg = ChatMessage(
                conversationId: convId,
                role: "user",
                content: text,
                createdAt: Date()
            )
            do {
                try await DatabaseService.shared.dbQueue.write { db in
                    try userMsg.insert(db)
                }
                messages.append(userMsg)
            } catch {
                print("ChatDrawer: failed to save user message: \(error)")
                return
            }

            // Assemble context (with RAG codebase search for project chats)
            let context: String
            if let project = appState.currentProject {
                context = await ContextAssembler.projectContextWithRAG(
                    projectId: project.id,
                    projectName: project.name,
                    projectPath: project.path,
                    projectProfile: appState.projectProfile,
                    query: text
                )
            } else {
                context = ContextAssembler.globalContext()
            }

            // Build message history for Claude
            let history = messages.map { (role: $0.role, content: $0.content) }

            // Call Claude
            guard let response = await claudeService.chat(messages: history, context: context) else {
                // Save error as assistant message
                let errorText = claudeService.lastError ?? "Failed to get response from Claude."
                var errorMsg = ChatMessage(
                    conversationId: convId,
                    role: "assistant",
                    content: "Failed: \(errorText)",
                    createdAt: Date()
                )
                try? await DatabaseService.shared.dbQueue.write { db in
                    try errorMsg.insert(db)
                }
                messages.append(errorMsg)
                return
            }

            // Save assistant message
            var assistantMsg = ChatMessage(
                conversationId: convId,
                role: "assistant",
                content: response,
                createdAt: Date()
            )
            do {
                try await DatabaseService.shared.dbQueue.write { db in
                    try assistantMsg.insert(db)
                }
                messages.append(assistantMsg)

                // Update conversation timestamp
                try await DatabaseService.shared.dbQueue.write { db in
                    try db.execute(
                        sql: "UPDATE chatConversations SET updatedAt = ? WHERE id = ?",
                        arguments: [Date(), convId]
                    )
                }
            } catch {
                print("ChatDrawer: failed to save assistant message: \(error)")
            }
        }
    }

    // MARK: - Action Handlers

    private func createTask(from content: String) {
        let title = "Chat: " + String(content.prefix(60)).replacingOccurrences(of: "\n", with: " ")
        var task = TaskItem(
            id: nil,
            projectId: appState.currentProject?.id ?? "__global__",
            title: title,
            description: content,
            status: "todo",
            priority: 2,
            sourceSession: nil,
            source: "chat",
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
            print("ChatDrawer: failed to create task: \(error)")
        }
    }

    private func addToNotes(_ content: String) {
        let title = "Chat: " + String(content.prefix(60)).replacingOccurrences(of: "\n", with: " ")
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
            print("ChatDrawer: failed to create note: \(error)")
        }
    }

    private func sendToTerminal(_ content: String) {
        NotificationCenter.default.post(
            name: .pasteToTerminal,
            object: nil,
            userInfo: ["text": content]
        )
    }
}

// MARK: - Chat Settings Popover

struct ChatSettingsPopover: View {
    private let modelsService = OpenRouterModelsService.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Chat Settings")
                .font(.system(size: 13, weight: .semibold))

            GroupBox("Model") {
                VStack(alignment: .leading, spacing: 4) {
                    Text(modelsService.displayName(for: ClaudeService.openRouterModel))
                        .font(.system(size: 12, weight: .medium))
                    Text(ClaudeService.openRouterModel)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Text("Configure in Settings \u{2192} CodeFire Engine")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
                .padding(4)
            }

            GroupBox("API Key") {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Circle()
                            .fill(ClaudeService.openRouterAPIKey?.isEmpty == false ? Color.green : Color.red)
                            .frame(width: 8, height: 8)
                        Text(ClaudeService.openRouterAPIKey?.isEmpty == false ? "API key configured" : "No API key set")
                            .font(.system(size: 11))
                    }
                    Text("Configure in Settings \u{2192} CodeFire Engine")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
                .padding(4)
            }
        }
        .padding(12)
        .frame(width: 260)
    }
}

// MARK: - Thinking Indicator

struct ThinkingIndicator: View {
    private static let phrases = [
        "Thinking...",
        "Searching the codebase...",
        "Digging through files...",
        "Scouring memories...",
        "Connecting the dots...",
        "Reading the source...",
        "Pulling context together...",
        "Checking notes and tasks...",
        "Almost there...",
    ]

    @State private var currentIndex = 0
    @State private var opacity: Double = 1.0

    var body: some View {
        HStack(spacing: 6) {
            ProgressView()
                .controlSize(.small)
                .scaleEffect(0.7)
            Text(Self.phrases[currentIndex])
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .opacity(opacity)
        }
        .onAppear {
            startCycling()
        }
    }

    private func startCycling() {
        // Advance every 2.5s with a fade transition
        Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { timer in
            withAnimation(.easeOut(duration: 0.3)) {
                opacity = 0
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                currentIndex = (currentIndex + 1) % Self.phrases.count
                withAnimation(.easeIn(duration: 0.3)) {
                    opacity = 1
                }
            }
        }
    }
}

extension Notification.Name {
    static let pasteToTerminal = Notification.Name("pasteToTerminal")
}

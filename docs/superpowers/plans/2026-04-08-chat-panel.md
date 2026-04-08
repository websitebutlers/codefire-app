# Chat Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the terminal panel in the main window with a context-aware AI chat panel that uses OpenRouter and has access to the user's tasks, notes, sessions, and indexed codebase.

**Architecture:** Extract the chat logic from the existing `ChatDrawerView` (drawer overlay) into a new `ChatPanelView` (resizable HSplitView column). Swap `TerminalTabView` for `ChatPanelView` in `MainSplitView`. Remove the chat drawer overlay from `GUIPanelView` since the chat is now always visible.

**Tech Stack:** SwiftUI, GRDB, OpenRouter API (via ClaudeService), ContextAssembler (RAG)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `Views/Chat/ChatPanelView.swift` | Create | Main chat panel adapted for HSplitView column |
| `Views/MainSplitView.swift` | Modify | Swap TerminalTabView → ChatPanelView |
| `Views/GUIPanelView.swift` | Modify | Remove drawer overlay and chat button |

Unchanged files (reused as-is):
- `Views/Chat/ChatMessageView.swift` — bubble UI + action buttons + markdown
- `Views/Chat/ChatDrawerView.swift` — kept for project windows
- `Services/ClaudeService.swift` — OpenRouter API
- `Services/ContextAssembler.swift` — RAG pipeline
- `Models/ChatMessage.swift`, `Models/ChatConversation.swift` — GRDB models

---

### Task 1: Create ChatPanelView

**Files:**
- Create: `swift/Sources/CodeFire/Views/Chat/ChatPanelView.swift`

- [ ] **Step 1: Create the ChatPanelView file**

This is adapted from `ChatDrawerView` with these differences:
- No `@Binding var isOpen` (always visible)
- No fixed width (uses HSplitView frame constraints)
- No shadow/overlay/separator (HSplitView handles dividers)
- No close button in header
- Header title says "CodeFire Chat" with green dot instead of just "Chat"

```swift
import SwiftUI
import GRDB

struct ChatPanelView: View {
    @EnvironmentObject var appState: AppState

    @StateObject private var claudeService = ClaudeService()

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
            header
            Divider()

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
                        withAnimation { proxy.scrollTo("loading", anchor: .bottom) }
                    }
                }
            }

            Divider()

            inputBar
        }
        .background(Color(nsColor: .controlBackgroundColor))
        .onAppear { loadConversations() }
        .onChange(of: appState.currentProject?.id) { _, _ in
            loadConversations()
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Color.green)
                .frame(width: 7, height: 7)

            VStack(alignment: .leading, spacing: 1) {
                Text("CodeFire Chat")
                    .font(.system(size: 13, weight: .semibold))
                Text(contextLabel)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }

            Spacer()

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
            print("ChatPanel: failed to load conversations: \(error)")
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
            print("ChatPanel: failed to load messages: \(error)")
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
                    print("ChatPanel: failed to create conversation: \(error)")
                    return
                }
            }

            guard let convId = currentConversation?.id else { return }

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
                print("ChatPanel: failed to save user message: \(error)")
                return
            }

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

            let history = messages.map { (role: $0.role, content: $0.content) }

            guard let response = await claudeService.chat(messages: history, context: context) else {
                let errorText = claudeService.lastError ?? "Failed to get response."
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

                try await DatabaseService.shared.dbQueue.write { db in
                    try db.execute(
                        sql: "UPDATE chatConversations SET updatedAt = ? WHERE id = ?",
                        arguments: [Date(), convId]
                    )
                }
            } catch {
                print("ChatPanel: failed to save assistant message: \(error)")
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
            print("ChatPanel: failed to create task: \(error)")
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
            print("ChatPanel: failed to create note: \(error)")
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
```

Note: `ChatSettingsPopover` and `ThinkingIndicator` are `private` in `ChatDrawerView.swift`. They need to be accessible from `ChatPanelView` too. The simplest approach: make them `internal` (remove `private`).

- [ ] **Step 2: Make ChatSettingsPopover and ThinkingIndicator accessible**

In `swift/Sources/CodeFire/Views/Chat/ChatDrawerView.swift`, change the visibility of `ChatSettingsPopover` and `ThinkingIndicator` from `private` to `internal` (the default).

Change line 436:
```swift
// Before:
private struct ChatSettingsPopover: View {
// After:
struct ChatSettingsPopover: View {
```

Change line 487:
```swift
// Before:
private struct ThinkingIndicator: View {
// After:
struct ThinkingIndicator: View {
```

- [ ] **Step 3: Build to verify ChatPanelView compiles**

Run: `cd swift && swift build`
Expected: Build succeeds. ChatPanelView compiles but isn't used yet.

- [ ] **Step 4: Commit**

```bash
git add swift/Sources/CodeFire/Views/Chat/ChatPanelView.swift swift/Sources/CodeFire/Views/Chat/ChatDrawerView.swift
git commit -m "feat: add ChatPanelView extracted from ChatDrawerView"
```

---

### Task 2: Wire ChatPanelView into MainSplitView

**Files:**
- Modify: `swift/Sources/CodeFire/Views/MainSplitView.swift`

- [ ] **Step 1: Replace TerminalTabView with ChatPanelView**

In `MainSplitView.swift`, replace the terminal section with the chat panel. The full body becomes:

```swift
var body: some View {
    HSplitView {
        ProjectSidebarView()
            .frame(minWidth: 160, maxWidth: 240)

        ChatPanelView()
            .frame(minWidth: 280, idealWidth: 400, maxWidth: 550)

        GUIPanelView()
            .frame(minWidth: 420, idealWidth: 720)
    }
    .background(Color(nsColor: .windowBackgroundColor))
    .ignoresSafeArea()
    .background(WindowConfigurator())
}
```

This removes:
- The `@State private var projectPath` property (no longer needed)
- The `if appState.showTerminal` conditional
- The `TerminalTabView` reference
- The `.onChange(of: appState.currentProject)` that set `projectPath`

- [ ] **Step 2: Build to verify**

Run: `cd swift && swift build`
Expected: Build succeeds. MainSplitView now renders Sidebar | Chat | Tabs.

- [ ] **Step 3: Commit**

```bash
git add swift/Sources/CodeFire/Views/MainSplitView.swift
git commit -m "feat: replace terminal with chat panel in main window"
```

---

### Task 3: Remove chat drawer overlay from GUIPanelView

**Files:**
- Modify: `swift/Sources/CodeFire/Views/GUIPanelView.swift`

- [ ] **Step 1: Remove showChatDrawer state**

Remove this line from the state declarations:
```swift
@State private var showChatDrawer = false
```

- [ ] **Step 2: Remove the chat button from the home view header**

In the home view header HStack (around line 115), remove `chatButton`:
```swift
// Before:
Spacer()
chatButton
MCPIndicator(connections: mcpMonitor.connections, currentProjectId: nil)

// After:
Spacer()
MCPIndicator(connections: mcpMonitor.connections, currentProjectId: nil)
```

- [ ] **Step 3: Remove the chat button from the project header**

In the `projectHeader` computed property, remove `chatButton` from the HStack (around line 258):
```swift
// Before:
NotificationBellView()
chatButton
IndexIndicator(

// After:
NotificationBellView()
IndexIndicator(
```

- [ ] **Step 4: Remove the drawer overlay**

Remove the entire `.overlay(alignment: .trailing)` block:
```swift
// Remove this entire block:
.overlay(alignment: .trailing) {
    if showChatDrawer {
        HStack(spacing: 0) {
            Color.black.opacity(0.15)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showChatDrawer = false
                    }
                }
            ChatDrawerView(isOpen: $showChatDrawer)
                .transition(.move(edge: .trailing))
        }
    }
}
```

- [ ] **Step 5: Remove the chatButton computed property**

Remove the entire `// MARK: - Chat Button` section (the `chatButton` computed property and its body).

- [ ] **Step 6: Remove the showBriefingDrawer state if unused**

Check if `showBriefingDrawer` is still referenced. If not, remove:
```swift
@State private var showBriefingDrawer = false
```

- [ ] **Step 7: Build to verify**

Run: `cd swift && swift build`
Expected: Build succeeds with no errors. No references to `showChatDrawer` or `chatButton` remain.

- [ ] **Step 8: Commit**

```bash
git add swift/Sources/CodeFire/Views/GUIPanelView.swift
git commit -m "feat: remove chat drawer overlay from main window (chat is now a panel)"
```

---

### Task 4: Clean up terminal toggle for main window

**Files:**
- Modify: `swift/Sources/CodeFire/Views/GUIPanelView.swift`
- Modify: `swift/Sources/CodeFire/ViewModels/AppState.swift`

The terminal toggle in the project header no longer makes sense in the main window since the terminal has been replaced. However, `ProjectWindowView` still uses `showTerminal` for its terminal. We should remove the toggle from the main window header only.

- [ ] **Step 1: Remove terminalToggle from the project header**

In the `projectHeader` computed property, remove `terminalToggle`:
```swift
// Before:
PresenceAvatarsView(projectId: appState.currentProject?.id)
terminalToggle
openInMenu

// After:
PresenceAvatarsView(projectId: appState.currentProject?.id)
openInMenu
```

Note: Keep the `terminalToggle` computed property and `AppState.showTerminal` — they're still used by `ProjectWindowView`.

- [ ] **Step 2: Build to verify**

Run: `cd swift && swift build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add swift/Sources/CodeFire/Views/GUIPanelView.swift
git commit -m "chore: remove terminal toggle from main window header"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full build**

Run: `cd swift && swift build`
Expected: Clean build, no new warnings from our changes.

- [ ] **Step 2: Verify no dead code**

Check that `ChatDrawerView` is still referenced by `ProjectWindowView`:
```bash
grep -rn "ChatDrawerView" swift/Sources/CodeFire/Views/
```
Expected: At least one reference in `ProjectWindowView.swift` (drawer still used there) and the definition in `ChatDrawerView.swift`.

- [ ] **Step 3: Verify ChatPanelView is referenced**

```bash
grep -rn "ChatPanelView" swift/Sources/CodeFire/Views/
```
Expected: Referenced in `MainSplitView.swift` and defined in `ChatPanelView.swift`.

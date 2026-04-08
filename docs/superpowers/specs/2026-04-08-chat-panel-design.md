# Replace Terminal with Chat Panel

## Context

CodeFire's main window has a 3-panel layout: Sidebar | Terminal | GUI Tabs. The embedded terminal takes permanent screen space but most users prefer their native terminal or IDE. We're replacing it with a context-aware AI chat panel that uses OpenRouter and has access to the user's tasks, notes, sessions, and indexed codebase via RAG.

## Architecture

The `MainSplitView` HSplitView keeps its 3-panel structure: **Sidebar | ChatPanelView | GUIPanelView**. The `TerminalTabView` is removed from the main window.

### Refactoring Strategy

Extract shared chat logic from `ChatDrawerView` (537 lines) into a new `ChatPanelView` adapted for the resizable HSplitView column. `ChatDrawerView` stays as-is for project windows.

### Reused Components (no changes needed)

- `ChatMessageView` — bubble UI with markdown rendering and action buttons
- `ClaudeService` — OpenRouter API integration
- `ContextAssembler` — RAG pipeline (tasks, notes, sessions, code chunks)
- `ChatMessage` / `ChatConversation` — GRDB models
- `ChatSettingsPopover` — model picker + API key (embedded in ChatDrawerView, will be extracted or duplicated)

## Components

### ChatPanelView (new: `Views/Chat/ChatPanelView.swift`)

Adapted from ChatDrawerView for panel use. Same functionality, different container.

**Header:**
- Green status dot + "CodeFire Chat" title
- Project context label (project name or "All Projects")
- New Conversation button
- History menu (conversation picker)
- Settings gear (model, API key)

**Messages area:**
- ScrollViewReader with lazy VStack
- ChatMessageView items (unchanged)
- Thinking indicator with rotating phrases
- Empty state with icon + prompt text

**Input bar:**
- Multi-line TextField (1-5 lines, Shift+Enter for newline)
- Send button (disabled when empty or generating)

**Action buttons on assistant messages (unchanged):**
- Create Task
- Add to Notes
- Copy
- Send to Terminal

**Frame constraints:** `minWidth: 280, idealWidth: 400, maxWidth: 550`

### MainSplitView Changes

```
Before: Sidebar | TerminalTabView | GUIPanelView
After:  Sidebar | ChatPanelView   | GUIPanelView
```

- Replace `TerminalTabView` with `ChatPanelView`
- Chat always visible (home view = global context, project view = project context)
- Remove `if appState.showTerminal` guard (chat is always shown)

### GUIPanelView Changes

- Remove chat drawer overlay (right-side drawer) from main window
- Remove chat button from project header bar
- Remove `showChatDrawer` state and related overlay code
- Keep terminal toggle (repurposed or removed — terminal accessible via "Open In" menu)

### ProjectWindowView — No Changes

Keep existing `ChatDrawerView` for project windows.

## Data Flow

Unchanged from existing chat:

1. User types message → saved to DB as `ChatMessage` (role: "user")
2. Context assembled via `ContextAssembler.projectContextWithRAG(query)` or `.globalContext()`
3. `ClaudeService.chat(messages: history, context: assembled)` calls OpenRouter
4. Response saved as `ChatMessage` (role: "assistant")
5. UI updates reactively via `@State` / `@Published`

## Preserved Functionality

- Conversation persistence in GRDB
- Multi-conversation support (history, new conversation)
- Project-scoped and global conversations
- RAG context injection (tasks, notes, sessions, code chunks)
- Markdown rendering (headings, bold, italic, code blocks, lists, links)
- Action buttons on responses
- Settings popover (model picker, API key config)
- Thinking indicator with rotating phrases
- OpenRouter model selection

## Files to Create

- `swift/Sources/CodeFire/Views/Chat/ChatPanelView.swift`

## Files to Modify

- `swift/Sources/CodeFire/Views/MainSplitView.swift` — swap TerminalTabView for ChatPanelView
- `swift/Sources/CodeFire/Views/GUIPanelView.swift` — remove drawer overlay and chat button

## Verification

1. `cd swift && swift build` — compiles without errors
2. Launch app — 3-panel layout shows Sidebar | Chat | Tabs
3. Home view shows chat in global mode
4. Select a project — chat switches to project context
5. Send a message — receives response with markdown rendering
6. Action buttons work (Create Task, Add to Notes, Copy)
7. Conversation history persists across project switches
8. Settings popover opens, model/API key configurable
9. Project windows still use ChatDrawerView correctly

# Dev Cockpit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add client-based project grouping, a persistent sidebar for navigation, and a global planner (kanban + notes) to transform Context into an all-in-one dev cockpit.

**Architecture:** New `clients` table + additive columns on `projects`/`taskItems`/`notes`. Three-pane layout: sidebar | terminal | GUI panel. Home view replaces tab content when no project is selected.

**Tech Stack:** Swift, SwiftUI, GRDB, SwiftTerm (existing stack — no new dependencies)

**Design doc:** `docs/plans/2026-02-20-dev-cockpit-design.md`

---

### Task 1: Database migrations — clients table and new columns

**Files:**
- Modify: `Context/Sources/Context/Services/DatabaseService.swift`
- Modify: `Context/Sources/Context/Models/Project.swift`
- Modify: `Context/Sources/Context/Models/TaskItem.swift`
- Modify: `Context/Sources/Context/Views/Notes/NoteListView.swift` (for Note model reference)
- Create: `Context/Sources/Context/Models/Client.swift`

**Step 1: Create the Client model**

Create `Context/Sources/Context/Models/Client.swift`:

```swift
import Foundation
import GRDB

struct Client: Codable, Identifiable, Equatable, FetchableRecord, MutablePersistableRecord {
    var id: String // UUID string
    var name: String
    var color: String // hex color, e.g. "#3B82F6"
    var sortOrder: Int
    var createdAt: Date

    static let databaseTableName = "clients"

    static let defaultColors = [
        "#3B82F6", // blue
        "#10B981", // green
        "#F59E0B", // amber
        "#EF4444", // red
        "#8B5CF6", // purple
        "#EC4899", // pink
        "#06B6D4", // cyan
        "#F97316", // orange
    ]
}
```

**Step 2: Add columns to Project model**

In `Context/Sources/Context/Models/Project.swift`, add after `createdAt`:

```swift
var clientId: String?
var tags: String? // JSON array
var sortOrder: Int?
```

Add to the `Columns` enum:

```swift
static let clientId = Column(CodingKeys.clientId)
static let tags = Column(CodingKeys.tags)
static let sortOrder = Column(CodingKeys.sortOrder)
```

Add helper methods:

```swift
var tagsArray: [String] {
    guard let json = tags,
          let data = json.data(using: .utf8),
          let array = try? JSONDecoder().decode([String].self, from: data)
    else { return [] }
    return array
}

mutating func setTags(_ newTags: [String]) {
    if newTags.isEmpty {
        tags = nil
    } else if let data = try? JSONEncoder().encode(newTags),
              let str = String(data: data, encoding: .utf8) {
        tags = str
    }
}
```

**Step 3: Add `isGlobal` to TaskItem model**

In `Context/Sources/Context/Models/TaskItem.swift`, add after `attachments`:

```swift
var isGlobal: Bool
```

**Step 4: Add `isGlobal` to Note model**

Find `Context/Sources/Context/Models/Note.swift` and add after `updatedAt`:

```swift
var isGlobal: Bool
```

**Step 5: Register database migrations**

In `Context/Sources/Context/Services/DatabaseService.swift`, add before `return migrator`:

```swift
migrator.registerMigration("v6_addClients") { db in
    try db.create(table: "clients") { t in
        t.primaryKey("id", .text)
        t.column("name", .text).notNull()
        t.column("color", .text).notNull().defaults(to: "#3B82F6")
        t.column("sortOrder", .integer).notNull().defaults(to: 0)
        t.column("createdAt", .datetime).notNull()
    }
}

migrator.registerMigration("v7_addProjectClientAndTags") { db in
    try db.alter(table: "projects") { t in
        t.add(column: "clientId", .text).references("clients", onDelete: .setNull)
        t.add(column: "tags", .text)
        t.add(column: "sortOrder", .integer).defaults(to: 0)
    }
}

migrator.registerMigration("v8_addGlobalFlags") { db in
    try db.alter(table: "taskItems") { t in
        t.add(column: "isGlobal", .boolean).notNull().defaults(to: false)
    }
    try db.alter(table: "notes") { t in
        t.add(column: "isGlobal", .boolean).notNull().defaults(to: false)
    }
}
```

**Step 6: Build and verify**

Run: `swift build`
Expected: Build succeeds with no errors. Existing data unchanged — all new columns have defaults.

**Step 7: Commit**

```bash
git add Context/Sources/Context/Models/Client.swift \
      Context/Sources/Context/Models/Project.swift \
      Context/Sources/Context/Models/TaskItem.swift \
      Context/Sources/Context/Models/Note.swift \
      Context/Sources/Context/Services/DatabaseService.swift
git commit -m "feat: add clients table, project tags, and global flags for tasks/notes"
```

---

### Task 2: AppState changes — add home view state and client loading

**Files:**
- Modify: `Context/Sources/Context/ViewModels/AppState.swift`

**Step 1: Add home view state and client management**

In `AppState`, add published properties:

```swift
@Published var isHomeView: Bool = true
@Published var clients: [Client] = []
```

Add methods:

```swift
func selectHome() {
    isHomeView = true
    currentProject = nil
}

// Override existing selectProject to also clear home view
// (modify existing method, add isHomeView = false at the top)

func loadClients() {
    do {
        clients = try DatabaseService.shared.dbQueue.read { db in
            try Client.order(Column("sortOrder").asc, Column("name").asc).fetchAll(db)
        }
    } catch {
        print("Failed to load clients: \(error)")
    }
}

func createClient(name: String, color: String) {
    let client = Client(
        id: UUID().uuidString,
        name: name,
        color: color,
        sortOrder: clients.count,
        createdAt: Date()
    )
    do {
        try DatabaseService.shared.dbQueue.write { db in
            try client.insert(db)
        }
        loadClients()
    } catch {
        print("Failed to create client: \(error)")
    }
}

func deleteClient(_ client: Client) {
    do {
        _ = try DatabaseService.shared.dbQueue.write { db in
            try client.delete(db)
        }
        loadClients()
        loadProjects() // refresh since projects may have lost their clientId
    } catch {
        print("Failed to delete client: \(error)")
    }
}

func updateProjectClient(_ project: Project, clientId: String?) {
    do {
        try DatabaseService.shared.dbQueue.write { db in
            var updated = project
            updated.clientId = clientId
            try updated.update(db)
        }
        loadProjects()
    } catch {
        print("Failed to update project client: \(error)")
    }
}

/// Projects grouped by client for the sidebar.
var projectsByClient: [(client: Client?, projects: [Project])] {
    var groups: [(client: Client?, projects: [Project])] = []

    for client in clients {
        let clientProjects = projects.filter { $0.clientId == client.id }
        if !clientProjects.isEmpty {
            groups.append((client: client, projects: clientProjects))
        }
    }

    let ungrouped = projects.filter { $0.clientId == nil }
    if !ungrouped.isEmpty {
        groups.append((client: nil, projects: ungrouped))
    }

    return groups
}
```

**Step 2: Modify existing `selectProject` method**

Add `isHomeView = false` as the first line inside `selectProject`:

```swift
func selectProject(_ project: Project) {
    isHomeView = false  // <-- add this line
    currentProject = project
    // ... rest unchanged
}
```

**Step 3: Add `loadClients()` call to `loadProjects()`**

At the end of `loadProjects()`, after setting `projects`, add:

```swift
loadClients()
```

**Step 4: Build and verify**

Run: `swift build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add Context/Sources/Context/ViewModels/AppState.swift
git commit -m "feat: add home view state, client management, and project grouping to AppState"
```

---

### Task 3: Project Sidebar view

**Files:**
- Create: `Context/Sources/Context/Views/Sidebar/ProjectSidebarView.swift`

**Step 1: Create the sidebar view**

Create `Context/Sources/Context/Views/Sidebar/ProjectSidebarView.swift`:

```swift
import SwiftUI

struct ProjectSidebarView: View {
    @EnvironmentObject var appState: AppState

    @State private var showingNewClient = false
    @State private var newClientName = ""
    @State private var newClientColor = Client.defaultColors[0]
    @State private var expandedClients: Set<String> = [] // client IDs

    var body: some View {
        VStack(spacing: 0) {
            // App title
            HStack(spacing: 6) {
                Image(systemName: "rectangle.grid.1x2.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.accentColor)
                Text("Context")
                    .font(.system(size: 13, weight: .bold))
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)

            Divider()

            ScrollView {
                VStack(spacing: 2) {
                    // Home / Planner button
                    SidebarItem(
                        icon: "house.fill",
                        label: "Planner",
                        isSelected: appState.isHomeView,
                        accentColor: .accentColor
                    ) {
                        appState.selectHome()
                    }
                    .padding(.horizontal, 8)
                    .padding(.top, 8)

                    Divider()
                        .padding(.vertical, 6)
                        .padding(.horizontal, 12)

                    // Client groups
                    ForEach(appState.projectsByClient, id: \.client?.id) { group in
                        if let client = group.client {
                            clientSection(client: client, projects: group.projects)
                        } else {
                            ungroupedSection(projects: group.projects)
                        }
                    }
                }
                .padding(.bottom, 8)
            }

            Divider()

            // Add client button
            Button {
                showingNewClient = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "plus")
                        .font(.system(size: 10, weight: .semibold))
                    Text("Add Client")
                        .font(.system(size: 11, weight: .medium))
                }
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
        }
        .frame(width: 200)
        .background(Color(nsColor: .windowBackgroundColor))
        .sheet(isPresented: $showingNewClient) {
            NewClientSheet(
                isPresented: $showingNewClient,
                name: $newClientName,
                color: $newClientColor,
                onCreate: {
                    appState.createClient(name: newClientName, color: newClientColor)
                    newClientName = ""
                    newClientColor = Client.defaultColors[0]
                }
            )
        }
        .onAppear {
            // Expand all client groups by default
            for group in appState.projectsByClient {
                if let client = group.client {
                    expandedClients.insert(client.id)
                }
            }
        }
    }

    // MARK: - Client Section

    @ViewBuilder
    private func clientSection(client: Client, projects: [Project]) -> some View {
        VStack(spacing: 0) {
            // Client header (collapsible)
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    if expandedClients.contains(client.id) {
                        expandedClients.remove(client.id)
                    } else {
                        expandedClients.insert(client.id)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color(hex: client.color) ?? .blue)
                        .frame(width: 8, height: 8)
                    Text(client.name)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                        .textCase(.uppercase)
                    Spacer()
                    Image(systemName: expandedClients.contains(client.id) ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundColor(.tertiary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Rename...") { /* TODO: inline rename */ }
                Button("Delete", role: .destructive) {
                    appState.deleteClient(client)
                }
            }

            // Projects under this client
            if expandedClients.contains(client.id) {
                ForEach(projects) { project in
                    projectRow(project: project)
                }
            }
        }
    }

    // MARK: - Ungrouped Section

    @ViewBuilder
    private func ungroupedSection(projects: [Project]) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Circle()
                    .fill(Color.secondary.opacity(0.3))
                    .frame(width: 8, height: 8)
                Text("Ungrouped")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.secondary)
                    .textCase(.uppercase)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)

            ForEach(projects) { project in
                projectRow(project: project)
            }
        }
    }

    // MARK: - Project Row

    @ViewBuilder
    private func projectRow(project: Project) -> some View {
        let isSelected = !appState.isHomeView && appState.currentProject?.id == project.id

        SidebarItem(
            icon: "folder.fill",
            label: project.name,
            isSelected: isSelected,
            accentColor: .accentColor
        ) {
            appState.selectProject(project)
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .contextMenu {
            Menu("Set Client") {
                Button("None") {
                    appState.updateProjectClient(project, clientId: nil)
                }
                Divider()
                ForEach(appState.clients) { client in
                    Button(client.name) {
                        appState.updateProjectClient(project, clientId: client.id)
                    }
                }
            }
        }
    }
}

// MARK: - Sidebar Item

struct SidebarItem: View {
    let icon: String
    let label: String
    let isSelected: Bool
    let accentColor: Color
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: isSelected ? .semibold : .regular))
                    .foregroundColor(isSelected ? accentColor : .secondary)
                    .frame(width: 16)
                Text(label)
                    .font(.system(size: 12, weight: isSelected ? .medium : .regular))
                    .foregroundColor(isSelected ? .primary : .secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(isSelected
                          ? accentColor.opacity(0.12)
                          : isHovering ? Color(nsColor: .controlBackgroundColor).opacity(0.5) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in isHovering = hovering }
    }
}

// MARK: - New Client Sheet

struct NewClientSheet: View {
    @Binding var isPresented: Bool
    @Binding var name: String
    @Binding var color: String
    let onCreate: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("New Client")
                .font(.system(size: 15, weight: .semibold))

            TextField("Client name", text: $name)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 13))
                .frame(width: 260)

            // Color picker
            HStack(spacing: 6) {
                ForEach(Client.defaultColors, id: \.self) { hex in
                    Circle()
                        .fill(Color(hex: hex) ?? .blue)
                        .frame(width: 22, height: 22)
                        .overlay(
                            Circle()
                                .strokeBorder(Color.white, lineWidth: color == hex ? 2 : 0)
                        )
                        .shadow(color: color == hex ? .accentColor.opacity(0.4) : .clear, radius: 3)
                        .onTapGesture { color = hex }
                }
            }

            HStack(spacing: 12) {
                Button("Cancel") { isPresented = false }
                    .keyboardShortcut(.cancelAction)
                Button("Create") {
                    if !name.trimmingCharacters(in: .whitespaces).isEmpty {
                        onCreate()
                        isPresented = false
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(24)
    }
}

// MARK: - Color from Hex

extension Color {
    init?(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6,
              let val = UInt64(h, radix: 16) else { return nil }
        self.init(
            red: Double((val >> 16) & 0xFF) / 255,
            green: Double((val >> 8) & 0xFF) / 255,
            blue: Double(val & 0xFF) / 255
        )
    }
}
```

**Step 2: Build and verify**

Run: `swift build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Sidebar/ProjectSidebarView.swift
git commit -m "feat: add project sidebar with client groups and home navigation"
```

---

### Task 4: Wire sidebar into MainSplitView and update GUIPanelView

**Files:**
- Modify: `Context/Sources/Context/Views/MainSplitView.swift`
- Modify: `Context/Sources/Context/Views/GUIPanelView.swift`

**Step 1: Update MainSplitView to three-pane layout**

Replace the contents of `MainSplitView.swift`:

```swift
import SwiftUI

struct MainSplitView: View {
    @EnvironmentObject var appState: AppState
    @State private var projectPath: String = ""

    var body: some View {
        HSplitView {
            ProjectSidebarView()
                .frame(minWidth: 160, maxWidth: 240)

            TerminalTabView(projectPath: $projectPath)
                .frame(minWidth: 400, idealWidth: 600)

            GUIPanelView()
                .frame(minWidth: 400, idealWidth: 600)
        }
        .onChange(of: appState.currentProject) { _, project in
            if let project = project {
                projectPath = project.path
            }
        }
    }
}
```

**Step 2: Update GUIPanelView — remove project picker, add home/project branching**

In `GUIPanelView.swift`, modify `body` to branch on `appState.isHomeView`:

Replace the body with:

```swift
var body: some View {
    VStack(spacing: 0) {
        if appState.isHomeView {
            // Home view header
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.accentColor.gradient)
                    .frame(width: 28, height: 28)
                    .overlay(
                        Image(systemName: "house.fill")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.white)
                    )
                VStack(alignment: .leading, spacing: 1) {
                    Text("Planner")
                        .font(.system(size: 13, weight: .semibold))
                    Text("Global tasks & notes")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
                Spacer()
                MCPIndicator(connections: mcpMonitor.connections, currentProjectId: nil)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color(nsColor: .windowBackgroundColor).opacity(0.6))

            Divider()

            // Home content
            HomeView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            // Project header (simplified — no dropdown picker)
            projectHeader
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color(nsColor: .windowBackgroundColor).opacity(0.6))

            Divider()

            // Tab bar
            tabBar
                .padding(.horizontal, 12)
                .padding(.vertical, 8)

            Divider()

            // Tab content
            Group {
                switch appState.selectedTab {
                case .dashboard:
                    DashboardView()
                case .sessions:
                    SessionListView()
                case .tasks:
                    KanbanBoard()
                case .notes:
                    NoteListView()
                case .memory:
                    MemoryEditorView()
                case .rules:
                    ClaudeMdEditorView()
                case .visualize:
                    VisualizerView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
    .background(Color(nsColor: .underPageBackgroundColor))
    .onAppear { mcpMonitor.startPolling() }
    .onDisappear { mcpMonitor.stopPolling() }
}
```

Remove the `Menu` project picker from `projectHeader`. Keep the project name/path display and MCP indicator. The simplified `projectHeader` becomes:

```swift
private var projectHeader: some View {
    HStack(spacing: 10) {
        if let project = appState.currentProject {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color.accentColor.gradient)
                .frame(width: 28, height: 28)
                .overlay(
                    Image(systemName: "folder.fill")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white)
                )

            VStack(alignment: .leading, spacing: 1) {
                Text(project.name)
                    .font(.system(size: 13, weight: .semibold))
                Text(project.path)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }

        Spacer()

        MCPIndicator(connections: mcpMonitor.connections, currentProjectId: appState.currentProject?.id)
    }
}
```

**Step 3: Build and verify**

Run: `swift build`
Expected: Build succeeds (HomeView doesn't exist yet — create a placeholder in next task).

**Step 4: Commit**

```bash
git add Context/Sources/Context/Views/MainSplitView.swift \
      Context/Sources/Context/Views/GUIPanelView.swift
git commit -m "feat: wire three-pane layout with sidebar and home/project branching"
```

---

### Task 5: Home View — global kanban + notes

**Files:**
- Create: `Context/Sources/Context/Views/Home/HomeView.swift`
- Modify: `Context/Sources/Context/Views/Tasks/KanbanBoard.swift`
- Modify: `Context/Sources/Context/Views/Notes/NoteListView.swift`

**Step 1: Add `isGlobal` mode to KanbanBoard**

Add a property to `KanbanBoard`:

```swift
var globalMode: Bool = false
```

Modify `loadTasks()` to handle global mode:

```swift
private func loadTasks() {
    do {
        let allTasks: [TaskItem]
        if globalMode {
            allTasks = try DatabaseService.shared.dbQueue.read { db in
                try TaskItem
                    .filter(Column("isGlobal") == true)
                    .order(Column("priority").desc, Column("createdAt").desc)
                    .fetchAll(db)
            }
        } else {
            guard let project = appState.currentProject else {
                todoTasks = []; inProgressTasks = []; doneTasks = []
                return
            }
            allTasks = try DatabaseService.shared.dbQueue.read { db in
                try TaskItem
                    .filter(Column("projectId") == project.id)
                    .filter(Column("isGlobal") == false)
                    .order(Column("priority").desc, Column("createdAt").desc)
                    .fetchAll(db)
            }
        }
        todoTasks = allTasks.filter { $0.status == "todo" }
        inProgressTasks = allTasks.filter { $0.status == "in_progress" }
        doneTasks = allTasks.filter { $0.status == "done" }
    } catch {
        print("KanbanBoard: failed to load tasks: \(error)")
    }
}
```

Also modify `createTask` to set `isGlobal` when in global mode:

```swift
private func createTask(_ task: TaskItem) {
    var newTask = task
    if globalMode {
        newTask.isGlobal = true
    }
    // ... rest unchanged
}
```

**Step 2: Add `isGlobal` mode to NoteListView**

Add a property to `NoteListView`:

```swift
var globalMode: Bool = false
```

Modify `loadNotes()` similarly:

```swift
private func loadNotes() {
    do {
        if globalMode {
            notes = try DatabaseService.shared.dbQueue.read { db in
                try Note
                    .filter(Column("isGlobal") == true)
                    .order(Column("updatedAt").desc)
                    .fetchAll(db)
            }
        } else {
            guard let project = appState.currentProject else {
                notes = []
                return
            }
            notes = try DatabaseService.shared.dbQueue.read { db in
                try Note
                    .filter(Column("projectId") == project.id)
                    .filter(Column("isGlobal") == false)
                    .order(Column("updatedAt").desc)
                    .fetchAll(db)
            }
        }
    } catch {
        print("NoteListView: failed to load notes: \(error)")
    }
}
```

Also modify `createNote()` to set `isGlobal` and handle missing project:

```swift
private func createNote() {
    let projectId = globalMode ? "__global__" : (appState.currentProject?.id ?? "")
    guard globalMode || appState.currentProject != nil else { return }

    let now = Date()
    var note = Note(
        id: nil,
        projectId: projectId,
        title: "Untitled Note",
        content: "",
        pinned: false,
        sessionId: nil,
        createdAt: now,
        updatedAt: now,
        isGlobal: globalMode
    )
    // ... rest unchanged
}
```

**Step 3: Create HomeView**

Create `Context/Sources/Context/Views/Home/HomeView.swift`:

```swift
import SwiftUI

struct HomeView: View {
    var body: some View {
        VSplitView {
            KanbanBoard(globalMode: true)
                .frame(minHeight: 200)
            NoteListView(globalMode: true)
                .frame(minHeight: 150)
        }
    }
}
```

**Step 4: Build and verify**

Run: `swift build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add Context/Sources/Context/Views/Home/HomeView.swift \
      Context/Sources/Context/Views/Tasks/KanbanBoard.swift \
      Context/Sources/Context/Views/Notes/NoteListView.swift
git commit -m "feat: add HomeView with global kanban board and notes"
```

---

### Task 6: MCP server — add global flag and client tools

**Files:**
- Modify: `Context/Sources/ContextMCP/main.swift`

**Step 1: Update MCP models**

Add `isGlobal` to the MCP `TaskItem` struct:

```swift
var isGlobal: Bool
```

Add `isGlobal` to the MCP `Note` struct:

```swift
var isGlobal: Bool
```

Add a `Client` struct:

```swift
struct Client: Codable, FetchableRecord, TableRecord {
    var id: String
    var name: String
    var color: String
    var sortOrder: Int
    var createdAt: Date
    static let databaseTableName = "clients"
}
```

**Step 2: Add `global` parameter to tool schemas**

In `create_task` schema, add:
```swift
"global": ["type": "boolean", "description": "Set true to create a global planner task (visible on home board)"]
```

In `list_tasks` schema, add:
```swift
"global": ["type": "boolean", "description": "Set true to list global planner tasks instead of project tasks"]
```

Same for `create_note`, `list_notes`, `search_notes`.

**Step 3: Add `list_clients` and `create_client` tools**

Add tool definitions:

```swift
[
    "name": "list_clients",
    "description": "List all clients (used for project grouping).",
    "inputSchema": [
        "type": "object",
        "properties": [:] as [String: Any]
    ] as [String: Any]
],
[
    "name": "create_client",
    "description": "Create a new client for grouping projects.",
    "inputSchema": [
        "type": "object",
        "properties": [
            "name": ["type": "string", "description": "Client name"],
            "color": ["type": "string", "description": "Hex color (e.g. #3B82F6). Optional."]
        ] as [String: Any],
        "required": ["name"]
    ] as [String: Any]
]
```

**Step 4: Implement tool handlers**

Add routing in `handleToolCall`:

```swift
case "list_clients": return try listClients()
case "create_client": return try createClient(args)
```

Add handler for global flag in `createTask`:

```swift
let isGlobal = args["global"] as? Bool ?? false
// When creating: set task.isGlobal = isGlobal
```

Similar for `listTasks`:

```swift
let isGlobal = args["global"] as? Bool ?? false
if isGlobal {
    // filter by isGlobal == true, no project filter
} else {
    // existing project-based filter
}
```

Implement `listClients()` and `createClient()` methods.

**Step 5: Build and verify**

Run: `swift build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add Context/Sources/ContextMCP/main.swift
git commit -m "feat: add global task/note support and client tools to MCP server"
```

---

### Task 7: Build, package, install, and verify

**Files:**
- No code changes — build and integration testing.

**Step 1: Full build**

Run: `swift build`
Expected: Clean build, no warnings.

**Step 2: Package**

Run: `bash scripts/package-app.sh`

**Step 3: Install**

Run: `rsync -a --delete build/Context.app/ /Applications/Context.app/`

**Step 4: Manual verification checklist**

1. Launch Context.app — should open to Planner (home view)
2. Sidebar shows "Planner" (selected) and projects under "Ungrouped"
3. Click "Add Client" — create a client with a name and color
4. Right-click a project → "Set Client" → assign to the new client
5. Sidebar now shows client group with project nested
6. Click project — GUI panel switches to project tabs (Tasks, Dashboard, etc.)
7. Click "Planner" — returns to home view with global kanban + notes
8. Create a global task and note on the home board
9. Switch to a project — global items don't appear in project boards
10. Close app with Cmd+Q — should exit cleanly

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: dev cockpit — project sidebar, client tags, and global planner"
```

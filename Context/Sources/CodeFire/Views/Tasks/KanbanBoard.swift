import SwiftUI
import GRDB
import UniformTypeIdentifiers

struct KanbanBoard: View {
    var globalMode: Bool = false
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var appSettings: AppSettings
    @State private var todoTasks: [TaskItem] = []
    @State private var inProgressTasks: [TaskItem] = []
    @State private var doneTasks: [TaskItem] = []
    @State private var showingNewTask = false
    @State private var selectedTask: TaskItem?

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack {
                Text("Task Board")
                    .font(.system(size: 13, weight: .semibold))

                Spacer()

                // Task counts
                HStack(spacing: 8) {
                    Label("\(todoTasks.count + inProgressTasks.count) open", systemImage: "circle.dotted")
                    Label("\(doneTasks.count) done", systemImage: "checkmark.circle")
                }
                .font(.system(size: 10))
                .foregroundColor(.secondary)

                Button {
                    showingNewTask = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                            .font(.system(size: 10, weight: .semibold))
                        Text("New Task")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.accentColor.opacity(0.15))
                    .foregroundColor(.accentColor)
                    .cornerRadius(6)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.accentColor.opacity(0.2), lineWidth: 0.5)
                    )
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            Divider()

            // Three-column Kanban with drag-and-drop
            HStack(alignment: .top, spacing: 10) {
                KanbanColumn(
                    title: "Todo",
                    icon: "circle",
                    color: .orange,
                    status: "todo",
                    tasks: todoTasks,
                    onTapTask: { openDetail($0) },
                    onDropTask: { taskId in moveTaskById(taskId, to: "todo") },
                    projectLookup: globalMode ? projectLookup : [:],
                    onProjectBadgeTap: globalMode ? { navigateToProject($0) } : nil,
                    contextMenuItems: { task in
                        Button("Move to In Progress") { moveTask(task, to: "in_progress") }
                        Button("Launch as Claude Session") { launchTask(task) }
                        Divider()
                        Button("Delete", role: .destructive) { deleteTask(task) }
                    }
                )
                KanbanColumn(
                    title: "In Progress",
                    icon: "circle.lefthalf.filled",
                    color: .blue,
                    status: "in_progress",
                    tasks: inProgressTasks,
                    onTapTask: { openDetail($0) },
                    onDropTask: { taskId in moveTaskById(taskId, to: "in_progress") },
                    projectLookup: globalMode ? projectLookup : [:],
                    onProjectBadgeTap: globalMode ? { navigateToProject($0) } : nil,
                    contextMenuItems: { task in
                        Button("Move to Done") { moveTask(task, to: "done") }
                        Button("Move back to Todo") { moveTask(task, to: "todo") }
                        Button("Launch as Claude Session") { launchTask(task) }
                        Divider()
                        Button("Delete", role: .destructive) { deleteTask(task) }
                    }
                )
                KanbanColumn(
                    title: "Done",
                    icon: "checkmark.circle.fill",
                    color: .green,
                    status: "done",
                    tasks: doneTasks,
                    onTapTask: { openDetail($0) },
                    onDropTask: { taskId in moveTaskById(taskId, to: "done") },
                    projectLookup: globalMode ? projectLookup : [:],
                    onProjectBadgeTap: globalMode ? { navigateToProject($0) } : nil,
                    contextMenuItems: { task in
                        Button("Move back to In Progress") { moveTask(task, to: "in_progress") }
                        Divider()
                        Button("Delete", role: .destructive) { deleteTask(task) }
                    }
                )
            }
            .padding(12)
        }
        .sheet(isPresented: $showingNewTask) {
            NewTaskSheet(isPresented: $showingNewTask, onCreate: { task in
                createTask(task)
            })
        }
        .sheet(item: $selectedTask) { task in
            TaskDetailView(
                task: task,
                onSave: { updated in
                    saveTask(updated)
                },
                onDelete: { task in
                    deleteTask(task)
                },
                onDismiss: {
                    selectedTask = nil
                }
            )
        }
        .onAppear { loadTasks() }
        .onChange(of: appState.currentProject) { _, _ in loadTasks() }
        .onReceive(Timer.publish(every: 2, on: .main, in: .common).autoconnect()) { _ in
            loadTasks()
        }
    }

    // MARK: - Project Lookup (for global mode badges)

    private var projectLookup: [String: String] {
        Dictionary(uniqueKeysWithValues: appState.projects.map { ($0.id, $0.name) })
    }

    private func navigateToProject(_ projectId: String) {
        guard let project = appState.projects.first(where: { $0.id == projectId }) else { return }
        appState.selectedTab = .tasks
        appState.selectProject(project)
    }

    // MARK: - Actions

    private func openDetail(_ task: TaskItem) {
        selectedTask = task
    }

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

    private func moveTask(_ task: TaskItem, to newStatus: String) {
        var updated = task
        updated.status = newStatus
        if newStatus == "done" {
            updated.completedAt = Date()
        } else {
            updated.completedAt = nil
        }
        saveTask(updated)
    }

    private func moveTaskById(_ taskId: Int64, to newStatus: String) {
        let allTasks = todoTasks + inProgressTasks + doneTasks
        guard let task = allTasks.first(where: { $0.id == taskId }) else { return }
        moveTask(task, to: newStatus)
    }

    private func createTask(_ task: TaskItem) {
        var newTask = task
        if globalMode {
            newTask.isGlobal = true
        }
        do {
            try DatabaseService.shared.dbQueue.write { db in
                try newTask.insert(db)
            }
            loadTasks()
            NotificationCenter.default.post(name: .tasksDidChange, object: nil)
        } catch {
            print("KanbanBoard: failed to create task: \(error)")
        }
    }

    private func saveTask(_ task: TaskItem) {
        do {
            try DatabaseService.shared.dbQueue.write { db in
                try task.update(db)
            }
            loadTasks()
            NotificationCenter.default.post(name: .tasksDidChange, object: nil)
        } catch {
            print("KanbanBoard: failed to save task: \(error)")
        }
    }

    private func deleteTask(_ task: TaskItem) {
        do {
            _ = try DatabaseService.shared.dbQueue.write { db in
                try task.delete(db)
            }
            loadTasks()
            NotificationCenter.default.post(name: .tasksDidChange, object: nil)
        } catch {
            print("KanbanBoard: failed to delete task: \(error)")
        }
    }

    private func launchTask(_ task: TaskItem) {
        var prompt = task.title
        if let desc = task.description, !desc.isEmpty {
            prompt += "\n\n" + desc
        }
        let images = task.attachmentsArray
        if !images.isEmpty {
            prompt += "\n\nAttached images:"
            for path in images {
                prompt += "\n- \(path)"
            }
        }
        let escaped = prompt
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "$", with: "\\$")
            .replacingOccurrences(of: "`", with: "\\`")
            .replacingOccurrences(of: "\n", with: "\\n")
        NotificationCenter.default.post(
            name: .launchTask,
            object: nil,
            userInfo: [
                LaunchTaskKey.title: "Task: \(task.title)",
                LaunchTaskKey.command: "\(appSettings.commandWithArgs(for: .claude)) \"\(escaped)\"",
                LaunchTaskKey.projectId: appState.currentProject?.id ?? ""
            ]
        )
    }
}

// MARK: - Kanban Column (with drop target)

struct KanbanColumn<MenuContent: View>: View {
    let title: String
    let icon: String
    let color: Color
    let status: String
    let tasks: [TaskItem]
    let onTapTask: (TaskItem) -> Void
    let onDropTask: (Int64) -> Void
    var projectLookup: [String: String] = [:]
    var onProjectBadgeTap: ((String) -> Void)? = nil
    @ViewBuilder let contextMenuItems: (TaskItem) -> MenuContent

    @State private var isDropTargeted = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(color)
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                Spacer()
                Text("\(tasks.count)")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(
                        Capsule()
                            .fill(Color(nsColor: .separatorColor).opacity(0.15))
                    )
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)

            // Thin colored accent bar
            Rectangle()
                .fill(color.opacity(0.4))
                .frame(height: 1.5)

            // Task list (drop target)
            ScrollView {
                if tasks.isEmpty {
                    Text("No tasks")
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                } else {
                    LazyVStack(spacing: 6) {
                        ForEach(tasks) { task in
                            TaskCardView(
                                task: task,
                                projectName: task.projectId != "__global__" ? projectLookup[task.projectId] : nil,
                                onProjectTap: task.projectId != "__global__" ? { onProjectBadgeTap?(task.projectId) } : nil
                            ) {
                                onTapTask(task)
                            }
                            .onDrag {
                                NSItemProvider(object: "\(task.id ?? 0)" as NSString)
                            }
                            .contextMenu {
                                contextMenuItems(task)
                            }
                        }
                    }
                    .padding(8)
                }
            }
            .frame(maxHeight: .infinity)
            .onDrop(of: [.plainText], isTargeted: $isDropTargeted) { providers in
                guard let provider = providers.first else { return false }
                provider.loadObject(ofClass: NSString.self) { item, _ in
                    guard let idString = item as? String,
                          let taskId = Int64(idString) else { return }
                    DispatchQueue.main.async {
                        onDropTask(taskId)
                    }
                }
                return true
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(isDropTargeted
                      ? color.opacity(0.06)
                      : Color(nsColor: .underPageBackgroundColor).opacity(0.5))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(isDropTargeted ? color.opacity(0.35) : Color.clear, lineWidth: 1.5)
        )
        .animation(.easeInOut(duration: 0.15), value: isDropTargeted)
    }
}

// MARK: - New Task Sheet (Rich)

struct NewTaskSheet: View {
    @Binding var isPresented: Bool
    let onCreate: (TaskItem) -> Void

    @EnvironmentObject var appState: AppState

    @State private var title: String = ""
    @State private var description: String = ""
    @State private var priority: Int = 0
    @State private var selectedLabels: Set<String> = []

    var body: some View {
        VStack(spacing: 16) {
            Text("New Task")
                .font(.system(size: 15, weight: .semibold))

            VStack(alignment: .leading, spacing: 10) {
                TextField("Task title", text: $title)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 13))

                // Description
                TextEditor(text: $description)
                    .font(.system(size: 12))
                    .scrollContentBackground(.hidden)
                    .padding(6)
                    .frame(height: 80)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color(nsColor: .textBackgroundColor).opacity(0.5))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(Color(nsColor: .separatorColor).opacity(0.2), lineWidth: 0.5)
                    )

                // Priority
                HStack(spacing: 4) {
                    Text("Priority:")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                    ForEach(TaskItem.Priority.allCases, id: \.rawValue) { level in
                        Button {
                            priority = level.rawValue
                        } label: {
                            Text(level.label)
                                .font(.system(size: 10, weight: .medium))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(
                                    Capsule()
                                        .fill(priority == level.rawValue
                                              ? level.color.opacity(0.15)
                                              : Color.clear)
                                )
                                .foregroundColor(priority == level.rawValue ? level.color : .secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }

                // Labels
                HStack(spacing: 4) {
                    Text("Labels:")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                    ForEach(TaskItem.predefinedLabels.prefix(6), id: \.self) { label in
                        Button {
                            if selectedLabels.contains(label) {
                                selectedLabels.remove(label)
                            } else {
                                selectedLabels.insert(label)
                            }
                        } label: {
                            Text(label)
                                .font(.system(size: 9, weight: .semibold))
                                .textCase(.uppercase)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(
                                    Capsule()
                                        .fill(selectedLabels.contains(label)
                                              ? TaskItem.labelColor(for: label).opacity(0.15)
                                              : Color(nsColor: .separatorColor).opacity(0.1))
                                )
                                .foregroundColor(selectedLabels.contains(label)
                                                 ? TaskItem.labelColor(for: label)
                                                 : .secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(width: 400)

            HStack(spacing: 12) {
                Button("Cancel") {
                    isPresented = false
                }
                .keyboardShortcut(.cancelAction)

                Button("Create") {
                    if !title.trimmingCharacters(in: .whitespaces).isEmpty {
                        var task = TaskItem(
                            id: nil,
                            projectId: appState.currentProject?.id ?? "__global__",
                            title: title.trimmingCharacters(in: .whitespaces),
                            description: description.isEmpty ? nil : description,
                            status: "todo",
                            priority: priority,
                            sourceSession: nil,
                            source: "manual",
                            createdAt: Date(),
                            completedAt: nil,
                            labels: nil,
                            attachments: nil
                        )
                        task.setLabels(Array(selectedLabels).sorted())
                        onCreate(task)
                        isPresented = false
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(24)
    }
}

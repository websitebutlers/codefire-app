import SwiftUI
import GRDB

struct KanbanBoard: View {
    @EnvironmentObject var appState: AppState
    @State private var todoTasks: [TaskItem] = []
    @State private var inProgressTasks: [TaskItem] = []
    @State private var doneTasks: [TaskItem] = []
    @State private var showingNewTask = false

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack {
                Text("Task Board")
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
                Button {
                    showingNewTask = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                            .font(.system(size: 11))
                        Text("New Task")
                            .font(.system(size: 12))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.accentColor.opacity(0.15))
                    .foregroundColor(.accentColor)
                    .cornerRadius(5)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            // Three-column Kanban
            HStack(alignment: .top, spacing: 8) {
                KanbanColumn(
                    title: "Todo",
                    color: .orange,
                    tasks: todoTasks,
                    onMoveForward: { task in moveTask(task, to: "in_progress") }
                )
                KanbanColumn(
                    title: "In Progress",
                    color: .blue,
                    tasks: inProgressTasks,
                    onMoveForward: { task in moveTask(task, to: "done") }
                )
                KanbanColumn(
                    title: "Done",
                    color: .green,
                    tasks: doneTasks,
                    onMoveForward: nil
                )
            }
            .padding(8)
        }
        .sheet(isPresented: $showingNewTask) {
            NewTaskSheet(isPresented: $showingNewTask, onCreate: { title in
                createTask(title: title)
            })
        }
        .onAppear { loadTasks() }
        .onChange(of: appState.currentProject) { _, _ in loadTasks() }
    }

    private func loadTasks() {
        guard let project = appState.currentProject else {
            todoTasks = []
            inProgressTasks = []
            doneTasks = []
            return
        }

        do {
            let allTasks = try DatabaseService.shared.dbQueue.read { db in
                try TaskItem
                    .filter(Column("projectId") == project.id)
                    .order(Column("priority").desc, Column("createdAt").desc)
                    .fetchAll(db)
            }

            todoTasks = allTasks.filter { $0.status == "todo" }
            inProgressTasks = allTasks.filter { $0.status == "in_progress" }
            doneTasks = allTasks.filter { $0.status == "done" }
        } catch {
            print("KanbanBoard: failed to load tasks: \(error)")
        }
    }

    private func moveTask(_ task: TaskItem, to newStatus: String) {
        guard var updated = task as TaskItem? else { return }
        updated.status = newStatus
        if newStatus == "done" {
            updated.completedAt = Date()
        }

        do {
            try DatabaseService.shared.dbQueue.write { db in
                try updated.update(db)
            }
            loadTasks()
        } catch {
            print("KanbanBoard: failed to move task: \(error)")
        }
    }

    private func createTask(title: String) {
        guard let project = appState.currentProject else { return }

        var task = TaskItem(
            id: nil,
            projectId: project.id,
            title: title,
            description: nil,
            status: "todo",
            priority: 0,
            sourceSession: nil,
            source: "manual",
            createdAt: Date(),
            completedAt: nil
        )

        do {
            try DatabaseService.shared.dbQueue.write { db in
                try task.insert(db)
            }
            loadTasks()
        } catch {
            print("KanbanBoard: failed to create task: \(error)")
        }
    }
}

// MARK: - Kanban Column

struct KanbanColumn: View {
    let title: String
    let color: Color
    let tasks: [TaskItem]
    let onMoveForward: ((TaskItem) -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(spacing: 6) {
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                Text("\(tasks.count)")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)

            Divider()

            // Task list
            ScrollView {
                LazyVStack(spacing: 6) {
                    ForEach(tasks) { task in
                        if let moveAction = onMoveForward {
                            TaskCardView(task: task)
                                .contextMenu {
                                    Button("Move Forward") {
                                        moveAction(task)
                                    }
                                }
                        } else {
                            TaskCardView(task: task)
                        }
                    }
                }
                .padding(6)
            }
        }
        .background(Color(nsColor: .windowBackgroundColor).opacity(0.5))
        .cornerRadius(8)
    }
}

// MARK: - New Task Sheet

struct NewTaskSheet: View {
    @Binding var isPresented: Bool
    let onCreate: (String) -> Void
    @State private var title: String = ""

    var body: some View {
        VStack(spacing: 16) {
            Text("New Task")
                .font(.headline)

            TextField("Task title", text: $title)
                .textFieldStyle(.roundedBorder)
                .frame(width: 300)

            HStack(spacing: 12) {
                Button("Cancel") {
                    isPresented = false
                }
                .keyboardShortcut(.cancelAction)

                Button("Create") {
                    if !title.trimmingCharacters(in: .whitespaces).isEmpty {
                        onCreate(title.trimmingCharacters(in: .whitespaces))
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

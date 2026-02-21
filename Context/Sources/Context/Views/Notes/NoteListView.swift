import SwiftUI
import GRDB

struct NoteListView: View {
    var globalMode: Bool = false
    @EnvironmentObject var appState: AppState
    @State private var notes: [Note] = []
    @State private var selectedNote: Note?

    var body: some View {
        HSplitView {
            // Left sidebar: note list
            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("Notes")
                        .font(.system(size: 13, weight: .semibold))
                    Spacer()
                    Button {
                        createNote()
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)
                            .frame(width: 22, height: 22)
                            .background(Color(nsColor: .controlBackgroundColor))
                            .cornerRadius(5)
                    }
                    .buttonStyle(.plain)
                    .help("New note")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)

                Divider()

                // Note list
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(sortedNotes) { note in
                            NoteRow(note: note, isSelected: selectedNote?.id == note.id)
                                .onTapGesture {
                                    selectedNote = note
                                }
                        }
                    }
                    .padding(.vertical, 4)
                    .padding(.horizontal, 4)
                }
            }
            .frame(minWidth: 200, idealWidth: 240)

            // Right: editor or placeholder
            if let note = selectedNote {
                NoteEditorView(
                    note: note,
                    onSave: { title, content in
                        saveNote(note: note, title: title, content: content)
                    },
                    onDelete: {
                        deleteNote(note: note)
                    },
                    onTogglePin: {
                        togglePin(note: note)
                    }
                )
                .frame(minWidth: 300)
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "note.text")
                        .font(.system(size: 28))
                        .foregroundStyle(.tertiary)
                    Text("Select or create a note")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.secondary)
                    Text("Use notes to capture project context")
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear { loadNotes() }
        .onChange(of: appState.currentProject) { _, _ in
            selectedNote = nil
            loadNotes()
        }
        .onReceive(Timer.publish(every: 2, on: .main, in: .common).autoconnect()) { _ in
            loadNotes()
        }
    }

    // Pinned first, then by updatedAt descending
    private var sortedNotes: [Note] {
        notes.sorted { a, b in
            if a.pinned != b.pinned {
                return a.pinned
            }
            return a.updatedAt > b.updatedAt
        }
    }

    // MARK: - CRUD

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

    private func createNote() {
        let projectId: String
        if globalMode {
            projectId = "__global__"
        } else {
            guard let project = appState.currentProject else { return }
            projectId = project.id
        }

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

        do {
            try DatabaseService.shared.dbQueue.write { db in
                try note.insert(db)
            }
            loadNotes()
            selectedNote = notes.first { $0.id == note.id }
        } catch {
            print("NoteListView: failed to create note: \(error)")
        }
    }

    private func saveNote(note: Note, title: String, content: String) {
        guard var updated = notes.first(where: { $0.id == note.id }) else { return }
        updated.title = title
        updated.content = content
        updated.updatedAt = Date()

        do {
            try DatabaseService.shared.dbQueue.write { db in
                try updated.update(db)
            }
            loadNotes()
            selectedNote = notes.first { $0.id == updated.id }
        } catch {
            print("NoteListView: failed to save note: \(error)")
        }
    }

    private func deleteNote(note: Note) {
        do {
            try DatabaseService.shared.dbQueue.write { db in
                _ = try Note.deleteOne(db, id: note.id)
            }
            if selectedNote?.id == note.id {
                selectedNote = nil
            }
            loadNotes()
        } catch {
            print("NoteListView: failed to delete note: \(error)")
        }
    }

    private func togglePin(note: Note) {
        guard var updated = notes.first(where: { $0.id == note.id }) else { return }
        updated.pinned.toggle()
        updated.updatedAt = Date()

        do {
            try DatabaseService.shared.dbQueue.write { db in
                try updated.update(db)
            }
            loadNotes()
            selectedNote = notes.first { $0.id == updated.id }
        } catch {
            print("NoteListView: failed to toggle pin: \(error)")
        }
    }
}

// MARK: - Note Row

struct NoteRow: View {
    let note: Note
    let isSelected: Bool
    @State private var isHovering = false

    var body: some View {
        HStack(spacing: 6) {
            if note.pinned {
                Image(systemName: "pin.fill")
                    .font(.system(size: 9))
                    .foregroundColor(.orange)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(note.title)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)

                Text(note.updatedAt, style: .relative)
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }

            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isSelected
                      ? Color.accentColor.opacity(0.15)
                      : isHovering ? Color(nsColor: .controlBackgroundColor).opacity(0.5) : Color.clear)
        )
        .contentShape(Rectangle())
        .onHover { hovering in
            isHovering = hovering
        }
    }
}

import SwiftUI

struct NoteEditorView: View {
    let note: Note
    let onSave: (String, String) -> Void
    let onDelete: () -> Void
    let onTogglePin: () -> Void

    @State private var title: String = ""
    @State private var content: String = ""

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack(spacing: 8) {
                TextField("Title", text: $title)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium))

                Spacer()

                Button {
                    onTogglePin()
                } label: {
                    Image(systemName: note.pinned ? "pin.fill" : "pin")
                        .font(.system(size: 12))
                        .foregroundColor(note.pinned ? .orange : .secondary)
                }
                .buttonStyle(.plain)
                .help(note.pinned ? "Unpin note" : "Pin note")

                Button {
                    onSave(title, content)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "square.and.arrow.down")
                            .font(.system(size: 11))
                        Text("Save")
                            .font(.system(size: 12))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.accentColor.opacity(0.15))
                    .foregroundColor(.accentColor)
                    .cornerRadius(5)
                }
                .buttonStyle(.plain)

                Button {
                    onDelete()
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 12))
                        .foregroundColor(.red.opacity(0.8))
                }
                .buttonStyle(.plain)
                .help("Delete note")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            // Content editor
            TextEditor(text: $content)
                .font(.system(size: 13, design: .monospaced))
                .scrollContentBackground(.hidden)
                .padding(8)
        }
        .onAppear {
            title = note.title
            content = note.content
        }
        .onChange(of: note.id) { _, _ in
            title = note.title
            content = note.content
        }
    }
}

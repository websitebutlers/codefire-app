import SwiftUI

enum NoteViewMode: String, CaseIterable {
    case edit
    case preview
}

struct NoteEditorView: View {
    let note: Note
    let onSave: (String, String) -> Void
    let onDelete: () -> Void
    let onTogglePin: () -> Void

    @EnvironmentObject var settings: AppSettings
    @State private var title: String = ""
    @State private var content: String = ""
    @State private var viewMode: NoteViewMode = .preview

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack(spacing: 8) {
                if settings.demoMode {
                    Text(DemoContent.shared.mask(note.title, as: .note))
                        .font(.system(size: 14, weight: .medium))
                } else {
                    TextField("Title", text: $title)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .medium))
                }

                Spacer()

                // Edit / Preview segmented toggle
                if !settings.demoMode {
                    Picker("", selection: $viewMode) {
                        Text("Edit").tag(NoteViewMode.edit)
                        Text("Preview").tag(NoteViewMode.preview)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 140)
                    .help("Toggle between raw markdown and rendered preview")
                }

                Button {
                    onTogglePin()
                } label: {
                    Image(systemName: note.pinned ? "pin.fill" : "pin")
                        .font(.system(size: 12))
                        .foregroundColor(note.pinned ? .orange : .secondary)
                        .frame(width: 26, height: 26)
                        .background(Color(nsColor: .controlBackgroundColor).opacity(0.6))
                        .cornerRadius(6)
                }
                .buttonStyle(.plain)
                .help(note.pinned ? "Unpin note" : "Pin note")

                Button {
                    onSave(title, content)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "square.and.arrow.down")
                            .font(.system(size: 10))
                        Text("Save")
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

                Button {
                    onDelete()
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 11))
                        .foregroundColor(.red.opacity(0.7))
                        .frame(width: 26, height: 26)
                        .background(Color(nsColor: .controlBackgroundColor).opacity(0.6))
                        .cornerRadius(6)
                }
                .buttonStyle(.plain)
                .help("Delete note")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            Divider()

            // Content area — demo / edit / preview
            if settings.demoMode {
                ScrollView {
                    Text(DemoContent.shared.mask(note.content.isEmpty ? "No content" : note.content, as: .snippet))
                        .font(.system(size: 13, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
            } else {
                switch viewMode {
                case .edit:
                    TextEditor(text: $content)
                        .font(.system(size: 13, design: .monospaced))
                        .scrollContentBackground(.hidden)
                        .padding(12)
                case .preview:
                    ScrollView {
                        if content.isEmpty {
                            VStack(spacing: 6) {
                                Image(systemName: "doc.text")
                                    .font(.system(size: 22))
                                    .foregroundStyle(.tertiary)
                                Text("Nothing to preview")
                                    .font(.system(size: 12))
                                    .foregroundStyle(.secondary)
                                Text("Switch to Edit to add content")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.tertiary)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                        } else {
                            MarkdownContentView(content: content)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                        }
                    }
                }
            }
        }
        .onAppear {
            title = note.title
            content = note.content
            viewMode = resolveInitialMode(for: note)
        }
        .onChange(of: note.id) { _, _ in
            title = note.title
            content = note.content
            viewMode = resolveInitialMode(for: note)
        }
    }

    private func resolveInitialMode(for note: Note) -> NoteViewMode {
        note.content.isEmpty ? .edit : .preview
    }
}

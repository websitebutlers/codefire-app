import SwiftUI
import AppKit
import UniformTypeIdentifiers
import GRDB

struct TaskDetailView: View {
    let task: TaskItem
    let onSave: (TaskItem) -> Void
    let onDelete: (TaskItem) -> Void
    var onDismiss: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var claudeService: ClaudeService
    @EnvironmentObject var settings: AppSettings

    @State private var title: String = ""
    @State private var description: String = ""
    @State private var priority: Int = 0
    @State private var selectedLabels: Set<String> = []
    @State private var customLabel: String = ""
    @State private var selectedProjectId: String = "__global__"
    @State private var enrichError: String?
    @State private var attachedImages: [String] = []
    @State private var isDropTargeted = false
    @State private var notes: [TaskNote] = []
    @State private var newNoteText: String = ""
    @State private var replyText = ""
    @State private var isSendingReply = false
    @State private var replySuccess: Bool?
    @State private var emailContext: ProcessedEmail?

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Task Details")
                    .font(.system(size: 14, weight: .semibold))
                Spacer()

                // Source badge
                Text(task.source.uppercased())
                    .font(.system(size: 9, weight: .bold))
                    .tracking(0.3)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        Capsule()
                            .fill(task.source == "claude" || task.source == "ai-extracted"
                                  ? Color.purple.opacity(0.12)
                                  : Color(nsColor: .separatorColor).opacity(0.15))
                    )
                    .foregroundColor(task.source == "claude" || task.source == "ai-extracted" ? .purple : .secondary)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Title
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Title")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.secondary)
                        TextField("Task title", text: $title)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 13))
                    }

                    // Project assignment
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Project")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.secondary)

                        Picker("Project", selection: $selectedProjectId) {
                            Text("None (Global only)")
                                .tag("__global__")
                            ForEach(appState.projects) { project in
                                Text(projectPickerLabel(project))
                                    .tag(project.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                    }

                    // Description
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Description")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(.secondary)
                            Spacer()

                            // AI Enrich button
                            if claudeService.isGenerating {
                                HStack(spacing: 4) {
                                    ProgressView()
                                        .scaleEffect(0.5)
                                    Text("Enriching...")
                                        .font(.system(size: 10))
                                        .foregroundColor(.secondary)
                                }
                            } else {
                                Button {
                                    enrichWithAI()
                                } label: {
                                    HStack(spacing: 3) {
                                        Image(systemName: "sparkles")
                                            .font(.system(size: 9, weight: .semibold))
                                        Text("Enrich with AI")
                                            .font(.system(size: 10, weight: .semibold))
                                    }
                                    .foregroundColor(.purple)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(Capsule().fill(Color.purple.opacity(0.1)))
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        TextEditor(text: $description)
                            .font(.system(size: 12, design: .monospaced))
                            .scrollContentBackground(.hidden)
                            .padding(8)
                            .frame(minHeight: 120)
                            .background(
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(Color(nsColor: .controlBackgroundColor).opacity(0.5))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
                            )

                        if let error = enrichError {
                            HStack(spacing: 4) {
                                Image(systemName: "exclamationmark.triangle")
                                    .font(.system(size: 10))
                                Text(error)
                                    .font(.system(size: 10))
                            }
                            .foregroundColor(.orange)
                        }
                    }

                    // Priority
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Priority")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.secondary)

                        HStack(spacing: 4) {
                            ForEach(TaskItem.Priority.allCases, id: \.rawValue) { level in
                                Button {
                                    priority = level.rawValue
                                } label: {
                                    HStack(spacing: 4) {
                                        Image(systemName: level.icon)
                                            .font(.system(size: 9, weight: .semibold))
                                        Text(level.label)
                                            .font(.system(size: 10, weight: .medium))
                                    }
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    .background(
                                        RoundedRectangle(cornerRadius: 5)
                                            .fill(priority == level.rawValue
                                                  ? level.color.opacity(0.15)
                                                  : Color(nsColor: .controlBackgroundColor).opacity(0.5))
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 5)
                                            .stroke(priority == level.rawValue
                                                    ? level.color.opacity(0.3)
                                                    : Color.clear, lineWidth: 0.5)
                                    )
                                    .foregroundColor(priority == level.rawValue ? level.color : .secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // Labels
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Labels")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.secondary)

                        // Predefined labels
                        FlowLayout(spacing: 4) {
                            ForEach(TaskItem.predefinedLabels, id: \.self) { label in
                                LabelChip(
                                    label: label,
                                    isSelected: selectedLabels.contains(label),
                                    color: TaskItem.labelColor(for: label)
                                ) {
                                    if selectedLabels.contains(label) {
                                        selectedLabels.remove(label)
                                    } else {
                                        selectedLabels.insert(label)
                                    }
                                }
                            }
                        }

                        // Custom label input
                        HStack(spacing: 6) {
                            TextField("Add custom label", text: $customLabel)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 11))
                                .frame(width: 150)
                                .onSubmit {
                                    addCustomLabel()
                                }

                            Button("Add") {
                                addCustomLabel()
                            }
                            .font(.system(size: 11))
                            .disabled(customLabel.trimmingCharacters(in: .whitespaces).isEmpty)
                        }

                        // Show custom labels that are selected but not predefined
                        let customSelected = selectedLabels.filter { !TaskItem.predefinedLabels.contains($0) }
                        if !customSelected.isEmpty {
                            HStack(spacing: 4) {
                                ForEach(Array(customSelected).sorted(), id: \.self) { label in
                                    LabelChip(label: label, isSelected: true, color: .secondary) {
                                        selectedLabels.remove(label)
                                    }
                                }
                            }
                        }
                    }

                    // Metadata
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Info")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.secondary)

                        HStack(spacing: 12) {
                            Label(task.createdAt.formatted(.dateTime.month(.abbreviated).day().hour().minute()), systemImage: "calendar")
                            if let session = task.sourceSession {
                                Label(String(session.prefix(8)), systemImage: "link")
                            }
                        }
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                    }

                    // Notes thread
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Notes")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(.secondary)
                            if !notes.isEmpty {
                                Text("(\(notes.count))")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.tertiary)
                            }
                        }

                        // Existing notes
                        if !notes.isEmpty {
                            VStack(spacing: 4) {
                                ForEach(notes) { note in
                                    HStack(alignment: .top, spacing: 6) {
                                        Image(systemName: noteIcon(note.source))
                                            .font(.system(size: 9))
                                            .foregroundColor(noteColor(note.source))
                                            .frame(width: 12, alignment: .center)
                                            .padding(.top, 2)

                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(settings.demoMode ? DemoContent.shared.mask(note.content, as: .snippet) : note.content)
                                                .font(.system(size: 11))
                                                .foregroundColor(.primary.opacity(0.85))

                                            Text(note.createdAt.formatted(.dateTime.month(.abbreviated).day().hour().minute()))
                                                .font(.system(size: 9))
                                                .foregroundStyle(.tertiary)
                                        }

                                        Spacer()

                                        Button {
                                            deleteNote(note)
                                        } label: {
                                            Image(systemName: "xmark")
                                                .font(.system(size: 8, weight: .bold))
                                                .foregroundStyle(.tertiary)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                    .padding(.vertical, 4)
                                    .padding(.horizontal, 6)
                                    .background(
                                        RoundedRectangle(cornerRadius: 4)
                                            .fill(Color(nsColor: .controlBackgroundColor).opacity(0.4))
                                    )
                                }
                            }
                        }

                        // Add note input
                        HStack(spacing: 6) {
                            TextField("Add a note...", text: $newNoteText)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 11))
                                .onSubmit { addNote() }

                            Button {
                                addNote()
                            } label: {
                                Image(systemName: "arrow.up.circle.fill")
                                    .font(.system(size: 16))
                                    .foregroundColor(newNoteText.trimmingCharacters(in: .whitespaces).isEmpty
                                                     ? .secondary : .accentColor)
                            }
                            .buttonStyle(.plain)
                            .disabled(newNoteText.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }

                    // Attachments
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Attachments")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(.secondary)
                            Spacer()
                            Button {
                                pickImages()
                            } label: {
                                HStack(spacing: 3) {
                                    Image(systemName: "plus")
                                        .font(.system(size: 9, weight: .bold))
                                    Text("Add Image")
                                        .font(.system(size: 10, weight: .medium))
                                }
                                .foregroundColor(.accentColor)
                            }
                            .buttonStyle(.plain)
                        }

                        // Drop zone + thumbnails
                        ZStack {
                            RoundedRectangle(cornerRadius: 8)
                                .fill(isDropTargeted
                                      ? Color.accentColor.opacity(0.08)
                                      : Color(nsColor: .controlBackgroundColor).opacity(0.3))
                            RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(
                                    style: StrokeStyle(lineWidth: 1, dash: [5, 3])
                                )
                                .foregroundColor(isDropTargeted ? .accentColor : Color(nsColor: .separatorColor).opacity(0.3))

                            if attachedImages.isEmpty {
                                VStack(spacing: 4) {
                                    Image(systemName: "photo.on.rectangle.angled")
                                        .font(.system(size: 16))
                                        .foregroundStyle(.tertiary)
                                    Text("Drop images here")
                                        .font(.system(size: 10))
                                        .foregroundStyle(.tertiary)
                                }
                            } else {
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 8) {
                                        ForEach(attachedImages, id: \.self) { path in
                                            AttachmentThumbnail(path: path) {
                                                attachedImages.removeAll { $0 == path }
                                            }
                                        }
                                    }
                                    .padding(8)
                                }
                            }
                        }
                        .frame(height: attachedImages.isEmpty ? 60 : 80)
                        .onDrop(of: [.fileURL, .image], isTargeted: $isDropTargeted) { providers in
                            handleDrop(providers)
                        }
                    }

                    // Email context + reply (for email-sourced tasks)
                    if task.gmailThreadId != nil {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Image(systemName: "envelope.fill")
                                    .font(.system(size: 11))
                                    .foregroundColor(.green)
                                Text("Email Source")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(.secondary)
                            }

                            if let email = emailContext {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text("From: \(settings.demoMode ? DemoContent.shared.mask(email.fromName ?? email.fromAddress, as: .email) : (email.fromName ?? email.fromAddress))")
                                            .font(.system(size: 11))
                                        Spacer()
                                        Text(email.receivedAt.formatted(.dateTime.month(.abbreviated).day().hour().minute()))
                                            .font(.system(size: 10))
                                            .foregroundStyle(.tertiary)
                                    }
                                    Text("Subject: \(settings.demoMode ? DemoContent.shared.mask(email.subject, as: .task) : email.subject)")
                                        .font(.system(size: 11))
                                        .foregroundColor(.secondary)

                                    if let snippet = email.snippet, !snippet.isEmpty {
                                        Text(settings.demoMode ? DemoContent.shared.mask(snippet, as: .snippet) : snippet)
                                            .font(.system(size: 11))
                                            .foregroundColor(.secondary)
                                            .lineLimit(3)
                                            .padding(8)
                                            .background(
                                                RoundedRectangle(cornerRadius: 4)
                                                    .fill(Color(nsColor: .controlBackgroundColor).opacity(0.4))
                                            )
                                    }
                                }

                                // Open in Gmail button
                                if let threadId = task.gmailThreadId {
                                    Button {
                                        if let url = URL(string: "https://mail.google.com/mail/u/0/#inbox/\(threadId)") {
                                            NSWorkspace.shared.open(url)
                                        }
                                    } label: {
                                        HStack(spacing: 4) {
                                            Image(systemName: "arrow.up.forward")
                                                .font(.system(size: 9))
                                            Text("Open in Gmail")
                                                .font(.system(size: 10, weight: .medium))
                                        }
                                        .foregroundColor(.blue)
                                    }
                                    .buttonStyle(.plain)
                                }

                                Divider()

                                // Reply composer
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("Reply")
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundColor(.secondary)

                                    TextEditor(text: $replyText)
                                        .font(.system(size: 12))
                                        .scrollContentBackground(.hidden)
                                        .padding(8)
                                        .frame(minHeight: 80)
                                        .background(
                                            RoundedRectangle(cornerRadius: 6)
                                                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.5))
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 6)
                                                .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
                                        )

                                    HStack {
                                        if let success = replySuccess {
                                            HStack(spacing: 4) {
                                                Image(systemName: success ? "checkmark.circle" : "xmark.circle")
                                                    .font(.system(size: 10))
                                                Text(success ? "Reply sent" : "Failed to send")
                                                    .font(.system(size: 10))
                                            }
                                            .foregroundColor(success ? .green : .red)
                                        }

                                        Spacer()

                                        Button {
                                            sendReply(email: email)
                                        } label: {
                                            HStack(spacing: 4) {
                                                if isSendingReply {
                                                    ProgressView()
                                                        .scaleEffect(0.5)
                                                }
                                                Image(systemName: "paperplane.fill")
                                                    .font(.system(size: 10))
                                                Text("Send Reply")
                                                    .font(.system(size: 11, weight: .medium))
                                            }
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 6)
                                            .background(Color.green.opacity(0.15))
                                            .foregroundColor(.green)
                                            .cornerRadius(6)
                                        }
                                        .buttonStyle(.plain)
                                        .disabled(replyText.trimmingCharacters(in: .whitespaces).isEmpty || isSendingReply)
                                    }
                                }
                            }
                        }
                    }

                    // Launch as Claude session
                    Button {
                        launchAsSession()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "play.fill")
                                .font(.system(size: 10))
                            Text("Launch as Claude Session")
                                .font(.system(size: 12, weight: .medium))
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Color.accentColor.opacity(0.15))
                        .foregroundColor(.accentColor)
                        .cornerRadius(7)
                        .overlay(
                            RoundedRectangle(cornerRadius: 7)
                                .stroke(Color.accentColor.opacity(0.25), lineWidth: 0.5)
                        )
                    }
                    .buttonStyle(.plain)
                }
                .padding(20)
            }

            Divider()

            // Bottom bar
            HStack {
                Button(role: .destructive) {
                    onDelete(task)
                    dismiss()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "trash")
                            .font(.system(size: 10))
                        Text("Delete")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .foregroundColor(.red)
                }
                .buttonStyle(.plain)

                Spacer()

                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                Button("Save") {
                    saveChanges()
                }
                .keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .frame(width: 520, height: 740)
        .onAppear {
            title = task.title
            description = task.description ?? ""
            priority = task.priority
            selectedProjectId = task.projectId
            selectedLabels = Set(task.labelsArray)
            attachedImages = task.attachmentsArray
            loadNotes()
            loadEmailContext()
        }
    }

    // MARK: - Actions

    private func saveChanges() {
        var updated = task
        updated.title = title.trimmingCharacters(in: .whitespaces)
        updated.description = description.isEmpty ? nil : description
        updated.priority = priority
        updated.projectId = selectedProjectId
        updated.setLabels(Array(selectedLabels).sorted())
        updated.setAttachments(attachedImages)
        onSave(updated)
        dismiss()
    }

    private func projectPickerLabel(_ project: Project) -> String {
        let name = settings.demoMode ? DemoContent.shared.mask(project.name, as: .project) : project.name
        let tags = project.tagsArray
        if tags.isEmpty { return name }
        let maskedTags = settings.demoMode ? tags.map { DemoContent.shared.mask($0, as: .project) } : tags
        return "\(name) (\(maskedTags.joined(separator: ", ")))"
    }

    private func addCustomLabel() {
        let label = customLabel.trimmingCharacters(in: .whitespaces).lowercased()
        if !label.isEmpty {
            selectedLabels.insert(label)
            customLabel = ""
        }
    }

    private func launchAsSession() {
        var prompt = title
        if let desc = task.description, !desc.isEmpty {
            prompt += "\n\n" + desc
        }

        // Include image attachment references
        if !attachedImages.isEmpty {
            prompt += "\n\nAttached images:"
            for path in attachedImages {
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
                LaunchTaskKey.title: "Task: \(title)",
                LaunchTaskKey.command: "claude \"\(escaped)\"",
                LaunchTaskKey.projectId: appState.currentProject?.id ?? ""
            ]
        )
        dismiss()
    }

    private func enrichWithAI() {
        enrichError = nil
        Task {
            if let result = await claudeService.enrichTask(title: title, currentDescription: description) {
                description = result
            } else {
                enrichError = claudeService.lastError ?? "Failed to enrich"
            }
        }
    }

    // MARK: - Notes

    private func loadNotes() {
        guard let taskId = task.id else { return }
        do {
            notes = try DatabaseService.shared.dbQueue.read { db in
                try TaskNote
                    .filter(Column("taskId") == taskId)
                    .order(Column("createdAt").asc)
                    .fetchAll(db)
            }
        } catch {
            print("TaskDetailView: failed to load notes: \(error)")
        }
    }

    private func addNote() {
        let text = newNoteText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, let taskId = task.id else { return }
        var note = TaskNote(
            id: nil,
            taskId: taskId,
            content: text,
            source: "manual",
            sessionId: nil,
            createdAt: Date()
        )
        do {
            try DatabaseService.shared.dbQueue.write { db in
                try note.insert(db)
            }
            newNoteText = ""
            loadNotes()
        } catch {
            print("TaskDetailView: failed to add note: \(error)")
        }
    }

    private func deleteNote(_ note: TaskNote) {
        do {
            _ = try DatabaseService.shared.dbQueue.write { db in
                try note.delete(db)
            }
            loadNotes()
        } catch {
            print("TaskDetailView: failed to delete note: \(error)")
        }
    }

    private func noteIcon(_ source: String) -> String {
        switch source {
        case "claude": return "sparkle"
        case "system": return "gear"
        default:       return "person"
        }
    }

    private func noteColor(_ source: String) -> Color {
        switch source {
        case "claude": return .purple
        case "system": return .secondary
        default:       return .blue
        }
    }

    // MARK: - Image Attachments

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        var handled = false
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { data, _ in
                    guard let data = data as? Data,
                          let url = URL(dataRepresentation: data, relativeTo: nil) else { return }
                    let ext = url.pathExtension.lowercased()
                    let imageExts = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "heic"]
                    guard imageExts.contains(ext) else { return }
                    DispatchQueue.main.async {
                        if !attachedImages.contains(url.path) {
                            attachedImages.append(url.path)
                        }
                    }
                }
                handled = true
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                    guard let data = data else { return }
                    let fileName = "task-img-\(Int(Date().timeIntervalSince1970)).png"
                    let dir = FileManager.default.temporaryDirectory
                        .appendingPathComponent("codefire-task-images", isDirectory: true)
                    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    let fileURL = dir.appendingPathComponent(fileName)
                    if let rep = NSBitmapImageRep(data: data),
                       let png = rep.representation(using: .png, properties: [:]) {
                        try? png.write(to: fileURL)
                        DispatchQueue.main.async {
                            attachedImages.append(fileURL.path)
                        }
                    }
                }
                handled = true
            }
        }
        return handled
    }

    private func pickImages() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .gif, .webP, .bmp, .tiff, .heic]
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.title = "Attach Images"
        if panel.runModal() == .OK {
            for url in panel.urls {
                if !attachedImages.contains(url.path) {
                    attachedImages.append(url.path)
                }
            }
        }
    }

    // MARK: - Email Reply

    private func loadEmailContext() {
        guard let msgId = task.gmailMessageId else { return }
        do {
            emailContext = try DatabaseService.shared.dbQueue.read { db in
                try ProcessedEmail
                    .filter(Column("gmailMessageId") == msgId)
                    .fetchOne(db)
            }
        } catch {
            print("TaskDetailView: failed to load email context: \(error)")
        }
    }

    private func sendReply(email: ProcessedEmail) {
        guard !replyText.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        isSendingReply = true
        replySuccess = nil

        Task {
            let oauth = GoogleOAuthManager()
            let api = GmailAPIService(oauthManager: oauth)

            let success = await api.sendReply(
                accountId: email.gmailAccountId,
                threadId: email.gmailThreadId,
                inReplyTo: email.gmailMessageId,
                to: email.fromAddress,
                subject: email.subject,
                body: replyText
            )

            isSendingReply = false
            replySuccess = success
            if success {
                replyText = ""
                // Mark as replied
                try? await DatabaseService.shared.dbQueue.write { db in
                    try db.execute(
                        sql: "UPDATE processedEmails SET repliedAt = ? WHERE gmailMessageId = ?",
                        arguments: [Date(), email.gmailMessageId]
                    )
                }
            }
        }
    }
}

// MARK: - Label Chip

struct LabelChip: View {
    let label: String
    let isSelected: Bool
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(
                    Capsule()
                        .fill(isSelected ? color.opacity(0.15) : Color(nsColor: .controlBackgroundColor).opacity(0.5))
                )
                .overlay(
                    Capsule()
                        .stroke(isSelected ? color.opacity(0.3) : Color(nsColor: .separatorColor).opacity(0.2), lineWidth: 0.5)
                )
                .foregroundColor(isSelected ? color : .secondary)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Attachment Thumbnail

struct AttachmentThumbnail: View {
    let path: String
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if let nsImage = NSImage(contentsOfFile: path) {
                Image(nsImage: nsImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
                    )
            } else {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color(nsColor: .controlBackgroundColor))
                    .frame(width: 64, height: 64)
                    .overlay {
                        VStack(spacing: 2) {
                            Image(systemName: "photo")
                                .font(.system(size: 14))
                                .foregroundStyle(.tertiary)
                            Text((path as NSString).lastPathComponent)
                                .font(.system(size: 7))
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                    }
            }

            // Remove button
            Button {
                onRemove()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(.white, .red)
            }
            .buttonStyle(.plain)
            .offset(x: 4, y: -4)
        }
        .help((path as NSString).lastPathComponent)
    }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(subviews: subviews, in: proposal.width ?? 0)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(subviews: subviews, in: bounds.width)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: ProposedViewSize(subviews[index].sizeThatFits(.unspecified))
            )
        }
    }

    private func arrange(subviews: Subviews, in width: CGFloat) -> (positions: [CGPoint], size: CGSize) {
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > width && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            maxWidth = max(maxWidth, x)
        }

        return (positions, CGSize(width: maxWidth, height: y + rowHeight))
    }
}

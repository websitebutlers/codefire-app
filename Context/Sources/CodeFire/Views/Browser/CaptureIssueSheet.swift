import SwiftUI
import GRDB

struct CaptureIssueSheet: View {
    let screenshotImage: NSImage
    let pageURL: String?
    let pageTitle: String?
    let consoleLogs: [ConsoleLogEntry]
    let projectId: String
    let onDismiss: () -> Void

    enum Phase {
        case annotate
        case issueForm
    }

    @State private var phase: Phase = .annotate
    @State private var annotatedImage: NSImage?

    // Issue form state
    @State private var title: String = ""
    @State private var description: String = ""
    @State private var priority: Int = 2
    @State private var selectedLabels: Set<String> = ["bug"]
    @State private var includeConsoleLogs = true

    var body: some View {
        Group {
            switch phase {
            case .annotate:
                ScreenshotAnnotationView(
                    image: screenshotImage,
                    onSave: { finalImage in
                        annotatedImage = finalImage
                        title = "Bug: \(pageTitle ?? "Untitled")"
                        description = pageURL ?? ""
                        phase = .issueForm
                    },
                    onCancel: {
                        onDismiss()
                    }
                )

            case .issueForm:
                issueFormView
            }
        }
    }

    // MARK: - Issue Form

    private var issueFormView: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Capture Issue")
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // Page info
                    if let url = pageURL {
                        HStack(spacing: 6) {
                            Image(systemName: "globe")
                                .font(.system(size: 10))
                                .foregroundStyle(.tertiary)
                            Text(url)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 6)
                                .fill(Color(nsColor: .controlBackgroundColor))
                        )
                    }

                    // Screenshot preview
                    if let img = annotatedImage {
                        HStack {
                            Image(nsImage: img)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 120, height: 80)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
                                )

                            VStack(alignment: .leading, spacing: 2) {
                                Text("Screenshot attached")
                                    .font(.system(size: 11, weight: .medium))
                                Text("Will be saved with the issue")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.leading, 8)

                            Spacer()
                        }
                    }

                    // Title
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Title")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)
                        TextField("Issue title", text: $title)
                            .textFieldStyle(.plain)
                            .font(.system(size: 13))
                            .padding(8)
                            .background(
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(Color(nsColor: .textBackgroundColor))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color(nsColor: .separatorColor).opacity(0.5), lineWidth: 0.5)
                            )
                    }

                    // Description
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Description")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)
                        TextEditor(text: $description)
                            .font(.system(size: 12))
                            .frame(height: 80)
                            .padding(4)
                            .background(
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(Color(nsColor: .textBackgroundColor))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color(nsColor: .separatorColor).opacity(0.5), lineWidth: 0.5)
                            )
                            .scrollContentBackground(.hidden)
                    }

                    // Console logs toggle
                    if !consoleLogs.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Toggle(isOn: $includeConsoleLogs) {
                                HStack(spacing: 4) {
                                    Text("Include console logs")
                                        .font(.system(size: 11, weight: .medium))
                                    Text("(\(consoleLogs.count) entries)")
                                        .font(.system(size: 10))
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .toggleStyle(.checkbox)

                            if includeConsoleLogs {
                                ScrollView {
                                    VStack(alignment: .leading, spacing: 2) {
                                        ForEach(consoleLogs.suffix(50)) { entry in
                                            HStack(alignment: .top, spacing: 4) {
                                                Image(systemName: entry.icon)
                                                    .font(.system(size: 8))
                                                    .foregroundColor(entry.color)
                                                    .frame(width: 10)
                                                    .padding(.top, 2)
                                                Text(entry.message)
                                                    .font(.system(size: 10, design: .monospaced))
                                                    .lineLimit(2)
                                            }
                                        }
                                    }
                                    .padding(6)
                                }
                                .frame(height: 100)
                                .background(
                                    RoundedRectangle(cornerRadius: 6)
                                        .fill(Color(nsColor: .controlBackgroundColor))
                                )
                            }
                        }
                    }

                    // Priority
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Priority")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)
                        Picker("", selection: $priority) {
                            ForEach(TaskItem.Priority.allCases, id: \.rawValue) { p in
                                Text(p.label).tag(p.rawValue)
                            }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                    }

                    // Labels
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Labels")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)

                        FlowLayout(spacing: 4) {
                            ForEach(TaskItem.predefinedLabels, id: \.self) { label in
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
                                        .tracking(0.2)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
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
                }
                .padding(16)
            }

            Divider()

            // Bottom bar
            HStack(spacing: 12) {
                Button("Cancel") {
                    onDismiss()
                }
                .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Create Issue") {
                    createIssue()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .frame(width: 500, height: 600)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - Create Issue

    private func createIssue() {
        let trimmedTitle = title.trimmingCharacters(in: .whitespaces)
        guard !trimmedTitle.isEmpty else { return }

        // 1. Save screenshot to disk
        let imageToSave = annotatedImage ?? screenshotImage
        guard let tiffData = imageToSave.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiffData),
              let pngData = bitmap.representation(using: .png, properties: [:])
        else {
            print("CaptureIssueSheet: failed to convert image")
            onDismiss()
            return
        }

        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!.appendingPathComponent("CodeFire/browser-screenshots", isDirectory: true)

        do {
            try FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        } catch {
            print("CaptureIssueSheet: failed to create directory: \(error)")
        }

        let filename = "screenshot-\(ISO8601DateFormatter().string(from: Date())).png"
            .replacingOccurrences(of: ":", with: "-")
        let fileURL = appSupport.appendingPathComponent(filename)

        do {
            try pngData.write(to: fileURL)
        } catch {
            print("CaptureIssueSheet: failed to write screenshot: \(error)")
        }

        // 2. Insert BrowserScreenshot DB record
        var screenshot = BrowserScreenshot(
            projectId: projectId,
            filePath: fileURL.path,
            pageURL: pageURL,
            pageTitle: pageTitle,
            createdAt: Date()
        )

        do {
            try DatabaseService.shared.dbQueue.write { db in
                try screenshot.insert(db)
            }
        } catch {
            print("CaptureIssueSheet: failed to save screenshot record: \(error)")
        }

        // 3. Build task description
        var fullDescription = description
        if includeConsoleLogs && !consoleLogs.isEmpty {
            fullDescription += "\n\n---\n**Console Logs:**\n```\n"
            for entry in consoleLogs.suffix(50) {
                fullDescription += "[\(entry.level.uppercased())] \(entry.message)\n"
            }
            fullDescription += "```"
        }

        // 4. Create TaskItem
        var task = TaskItem(
            id: nil,
            projectId: projectId,
            title: trimmedTitle,
            description: fullDescription.isEmpty ? nil : fullDescription,
            status: "todo",
            priority: priority,
            sourceSession: nil,
            source: "browser",
            createdAt: Date(),
            completedAt: nil,
            labels: nil,
            attachments: nil
        )
        task.setLabels(Array(selectedLabels).sorted())
        task.setAttachments([fileURL.path])

        do {
            try DatabaseService.shared.dbQueue.write { db in
                try task.insert(db)
            }
        } catch {
            print("CaptureIssueSheet: failed to create task: \(error)")
        }

        // 5. Notify
        NotificationCenter.default.post(name: .tasksDidChange, object: nil)
        NotificationCenter.default.post(name: .screenshotsDidChange, object: nil)

        onDismiss()
    }
}


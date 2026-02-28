import SwiftUI
import GRDB

struct RecordingDetailView: View {
    @Binding var recording: Recording
    @EnvironmentObject var appState: AppState
    @State private var extractedTasks: [TaskItem] = []
    @State private var isEditingTitle = false
    @State private var editableTitle: String = ""
    @State private var acceptedTaskIds: Set<Int64> = []
    @State private var dismissedTaskIds: Set<Int64> = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerSection
                Divider()

                if FileManager.default.fileExists(atPath: recording.audioPath) {
                    AudioPlayerView(audioPath: recording.audioPath)
                }

                statusSection

                if let transcript = recording.transcript {
                    transcriptSection(transcript)
                }

                if recording.status == Recording.Status.ready.rawValue && !extractedTasks.isEmpty {
                    extractedTasksSection
                }
            }
            .padding(16)
        }
        .onAppear {
            editableTitle = recording.title
            loadExtractedTasks()
        }
        .onChange(of: recording.status) { _, _ in
            loadExtractedTasks()
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            if isEditingTitle {
                TextField("Recording title", text: $editableTitle, onCommit: { saveTitle() })
                    .textFieldStyle(.plain)
                    .font(.system(size: 18, weight: .semibold))
            } else {
                Text(recording.title)
                    .font(.system(size: 18, weight: .semibold))
                    .onTapGesture { isEditingTitle = true; editableTitle = recording.title }
            }

            HStack(spacing: 12) {
                Label(recording.createdAt.formatted(date: .abbreviated, time: .shortened), systemImage: "calendar")
                Label(formatDuration(recording.duration), systemImage: "clock")
            }
            .font(.system(size: 12))
            .foregroundColor(.secondary)
        }
    }

    // MARK: - Status

    private var statusSection: some View {
        Group {
            switch recording.status {
            case Recording.Status.transcribing.rawValue:
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Transcribing audio...").font(.system(size: 13)).foregroundColor(.secondary)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.blue.opacity(0.1)).cornerRadius(8)

            case Recording.Status.extracting.rawValue:
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Extracting tasks...").font(.system(size: 13)).foregroundColor(.secondary)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.purple.opacity(0.1)).cornerRadius(8)

            case Recording.Status.error.rawValue:
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.red)
                    Text(recording.errorMessage ?? "An error occurred").font(.system(size: 13)).foregroundColor(.red)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.1)).cornerRadius(8)

            default:
                EmptyView()
            }
        }
    }

    // MARK: - Transcript

    private func transcriptSection(_ transcript: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Transcript").font(.system(size: 14, weight: .semibold))
            Text(transcript)
                .font(.system(size: 13))
                .textSelection(.enabled)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(8)
        }
    }

    // MARK: - Extracted Tasks

    private var extractedTasksSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Extracted Tasks").font(.system(size: 14, weight: .semibold))
                Spacer()
                Button("Accept All") { acceptAllTasks() }
                    .buttonStyle(.borderedProminent).controlSize(.small)
            }

            let visible = extractedTasks.filter { task in
                guard let id = task.id else { return true }
                return !acceptedTaskIds.contains(id) && !dismissedTaskIds.contains(id)
            }

            if visible.isEmpty {
                Text("All tasks have been reviewed.")
                    .font(.system(size: 13)).foregroundColor(.secondary)
                    .padding(12).frame(maxWidth: .infinity)
                    .background(Color(nsColor: .controlBackgroundColor)).cornerRadius(8)
            } else {
                ForEach(visible) { task in
                    taskCard(task)
                }
            }
        }
    }

    private func taskCard(_ task: TaskItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: task.priorityLevel.icon)
                    .foregroundColor(task.priorityLevel.color)
                    .font(.system(size: 11))
                Text(task.title).font(.system(size: 13, weight: .medium))
                Spacer()
            }

            if let desc = task.description {
                Text(desc).font(.system(size: 12)).foregroundColor(.secondary).lineLimit(2)
            }

            HStack(spacing: 8) {
                Spacer()
                Button("Dismiss") {
                    if let id = task.id { dismissedTaskIds.insert(id) }
                    deleteTask(task)
                }
                .buttonStyle(.plain).foregroundColor(.secondary).controlSize(.small)

                Button("Accept") {
                    if let id = task.id { acceptedTaskIds.insert(id) }
                    // Task is already in DB from pipeline -- it stays as-is
                }
                .buttonStyle(.borderedProminent).controlSize(.small)
            }
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }

    // MARK: - Actions

    private func saveTitle() {
        isEditingTitle = false
        recording.title = editableTitle
        try? DatabaseService.shared.dbQueue.write { db in try recording.update(db) }
    }

    private func deleteTask(_ task: TaskItem) {
        _ = try? DatabaseService.shared.dbQueue.write { db in
            try task.delete(db)
        }
    }

    private func acceptAllTasks() {
        for task in extractedTasks {
            if let id = task.id { acceptedTaskIds.insert(id) }
        }
    }

    private func loadExtractedTasks() {
        extractedTasks = (try? DatabaseService.shared.dbQueue.read { db in
            try TaskItem
                .filter(Column("recordingId") == recording.id)
                .fetchAll(db)
        }) ?? []
    }

    private func formatDuration(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

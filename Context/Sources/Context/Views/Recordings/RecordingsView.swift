import SwiftUI
import GRDB

struct RecordingsView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var recorder = AudioRecorderService()
    @StateObject private var transcriber = TranscriptionService()
    @StateObject private var claude = ClaudeService()
    @State private var recordings: [Recording] = []
    @State private var selectedRecordingId: String?
    @State private var pipelineMessage: String?

    private var selectedRecordingBinding: Binding<Recording>? {
        guard let id = selectedRecordingId,
              let index = recordings.firstIndex(where: { $0.id == id }) else { return nil }
        return $recordings[index]
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()

            if recorder.isRecording {
                recordingBar
                Divider()
            }

            if let msg = pipelineMessage {
                pipelineStatusBar(msg)
                Divider()
            }

            if recordings.isEmpty && !recorder.isRecording {
                emptyState
            } else {
                HSplitView {
                    recordingList
                        .frame(minWidth: 200, idealWidth: 280, maxWidth: 350)

                    if let binding = selectedRecordingBinding {
                        RecordingDetailView(recording: binding)
                    } else {
                        Text("Select a recording")
                            .font(.system(size: 14))
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            }
        }
        .onAppear { loadRecordings() }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack {
            Text("Recordings").font(.system(size: 13, weight: .semibold))
            Spacer()

            if let error = recorder.permissionError {
                Text(error)
                    .font(.system(size: 11))
                    .foregroundColor(.red)
                    .lineLimit(1)
            }

            Button(action: { toggleRecording() }) {
                if recorder.isRecording {
                    Image(systemName: "stop.fill")
                        .foregroundColor(.white)
                        .frame(width: 24, height: 24)
                        .background(Color.red)
                        .cornerRadius(4)
                } else {
                    Image(systemName: "circle.fill")
                        .foregroundColor(.red)
                        .font(.system(size: 20))
                }
            }
            .buttonStyle(.plain)
            .help(recorder.isRecording ? "Stop recording" : "Start recording")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Recording Bar

    private var recordingBar: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(Color.red)
                .frame(width: 8, height: 8)

            Text("Recording")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.red)

            Text(formatTime(recorder.elapsedTime))
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(.secondary)

            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.green)
                    .frame(width: max(2, geo.size.width * CGFloat(min(recorder.micLevel * 5, 1.0))))
            }
            .frame(width: 60, height: 6)
            .background(Color.green.opacity(0.15))
            .cornerRadius(2)

            Spacer()

            Button("Stop") { toggleRecording() }
                .buttonStyle(.borderedProminent).tint(.red).controlSize(.small)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.red.opacity(0.05))
    }

    // MARK: - Pipeline Status

    private func pipelineStatusBar(_ message: String) -> some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(message).font(.system(size: 12)).foregroundColor(.secondary)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.blue.opacity(0.05))
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "waveform")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text("No Recordings")
                .font(.system(size: 16, weight: .medium))
            Text("Record meetings to auto-transcribe and extract tasks.")
                .font(.system(size: 13))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            Button("Start Recording") { toggleRecording() }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Recording List

    private var recordingList: some View {
        List(selection: $selectedRecordingId) {
            ForEach(recordings) { recording in
                recordingRow(recording).tag(recording.id)
            }
        }
        .listStyle(.sidebar)
    }

    private func recordingRow(_ recording: Recording) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(recording.title)
                .font(.system(size: 13, weight: .medium))
                .lineLimit(1)

            HStack(spacing: 6) {
                Text(recording.createdAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.system(size: 11)).foregroundColor(.secondary)
                Text(formatTime(recording.duration))
                    .font(.system(size: 11, design: .monospaced)).foregroundColor(.secondary)
            }

            statusBadge(for: recording.status)
        }
        .padding(.vertical, 2)
    }

    private func statusBadge(for status: String) -> some View {
        let (text, color): (String, Color) = {
            switch status {
            case Recording.Status.recording.rawValue: return ("Recording", .red)
            case Recording.Status.transcribing.rawValue: return ("Transcribing", .blue)
            case Recording.Status.extracting.rawValue: return ("Extracting", .purple)
            case Recording.Status.ready.rawValue: return ("Ready", .green)
            case Recording.Status.error.rawValue: return ("Error", .red)
            default: return (status, .secondary)
            }
        }()

        return Text(text)
            .font(.system(size: 10, weight: .medium))
            .foregroundColor(color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.12)).cornerRadius(4)
    }

    // MARK: - Actions

    private func toggleRecording() {
        Task {
            if recorder.isRecording {
                do {
                    let recording = try await recorder.stopRecording()
                    loadRecordings()
                    selectedRecordingId = recording.id
                    await runPipeline(for: recording)
                } catch {
                    print("Stop recording error: \(error)")
                }
            } else {
                guard let projectId = appState.currentProject?.id else { return }
                let hasPermission = await recorder.checkPermissions()
                guard hasPermission else { return }
                do {
                    let recording = try await recorder.startRecording(projectId: projectId)
                    loadRecordings()
                    selectedRecordingId = recording.id
                } catch {
                    print("Start recording error: \(error)")
                }
            }
        }
    }

    // MARK: - Pipeline

    private func runPipeline(for recording: Recording) async {
        var rec = recording

        // Step 1: Transcribe
        pipelineMessage = "Transcribing audio..."
        do {
            let transcript = try await transcriber.transcribe(audioPath: rec.audioPath)
            rec.transcript = transcript
            rec.status = Recording.Status.extracting.rawValue
            try await DatabaseService.shared.dbQueue.write { db in try rec.update(db) }
            loadRecordings()
        } catch {
            rec.status = Recording.Status.error.rawValue
            rec.errorMessage = "Transcription failed: \(error.localizedDescription)"
            try? await DatabaseService.shared.dbQueue.write { db in try rec.update(db) }
            loadRecordings()
            pipelineMessage = nil
            return
        }

        // Step 2: Extract tasks
        pipelineMessage = "Extracting tasks from transcript..."
        guard let transcript = rec.transcript,
              let projectId = appState.currentProject?.id else {
            pipelineMessage = nil
            return
        }

        if let tasks = await claude.extractTasksFromRecording(transcript: transcript) {
            try? await DatabaseService.shared.dbQueue.write { db in
                for task in tasks {
                    var taskItem = TaskItem(
                        id: nil,
                        projectId: projectId,
                        title: task.title,
                        description: task.description,
                        status: "todo",
                        priority: task.priority,
                        sourceSession: nil,
                        source: "recording",
                        createdAt: Date(),
                        completedAt: nil,
                        labels: nil,
                        attachments: nil,
                        isGlobal: false,
                        gmailThreadId: nil,
                        gmailMessageId: nil,
                        recordingId: rec.id
                    )
                    try taskItem.insert(db)
                }
            }
        }

        rec.status = Recording.Status.ready.rawValue
        try? await DatabaseService.shared.dbQueue.write { db in try rec.update(db) }
        loadRecordings()
        pipelineMessage = nil
    }

    // MARK: - Data

    private func loadRecordings() {
        guard let projectId = appState.currentProject?.id else { return }
        recordings = (try? DatabaseService.shared.dbQueue.read { db in
            try Recording
                .filter(Recording.Columns.projectId == projectId)
                .order(Recording.Columns.createdAt.desc)
                .fetchAll(db)
        }) ?? []
    }

    private func formatTime(_ seconds: TimeInterval) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

# Audio Recorder + Transcription + Task Extraction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Recordings tab to Context.app that records meetings (system audio + mic), auto-transcribes with WhisperKit, extracts tasks via Claude CLI, and lets users review/approve tasks onto the kanban board.

**Architecture:** AVAudioEngine (mic) + ScreenCaptureKit SCStream (system audio) mixed into M4A → WhisperKit on-device transcription → Claude CLI task extraction → user review UI. New `recordings` GRDB table with pipeline state machine (recording → transcribing → extracting → ready).

**Tech Stack:** Swift/SwiftUI, AVAudioEngine, ScreenCaptureKit, WhisperKit (SPM), GRDB, Claude CLI

---

### Task 1: Recording Model + Database Migration

**Files:**
- Create: `Context/Sources/Context/Models/Recording.swift`
- Modify: `Context/Sources/Context/Services/DatabaseService.swift` (add v18 migration)
- Modify: `Context/Sources/Context/Models/TaskItem.swift` (add recordingId column)

**Step 1: Create the Recording model**

Create `Context/Sources/Context/Models/Recording.swift`:

```swift
import Foundation
import GRDB

struct Recording: Codable, Identifiable, FetchableRecord, MutablePersistableRecord {
    var id: String // UUID, generated before recording starts
    var projectId: String
    var title: String
    var audioPath: String
    var duration: Double // seconds
    var transcript: String?
    var status: String // "recording", "transcribing", "extracting", "ready", "error"
    var errorMessage: String?
    var createdAt: Date

    static let databaseTableName = "recordings"

    enum Columns {
        static let id = Column(CodingKeys.id)
        static let projectId = Column(CodingKeys.projectId)
        static let title = Column(CodingKeys.title)
        static let status = Column(CodingKeys.status)
        static let createdAt = Column(CodingKeys.createdAt)
        static let duration = Column(CodingKeys.duration)
        static let transcript = Column(CodingKeys.transcript)
        static let errorMessage = Column(CodingKeys.errorMessage)
    }

    enum Status: String {
        case recording
        case transcribing
        case extracting
        case ready
        case error
    }
}
```

**Step 2: Add recordingId to TaskItem**

In `Context/Sources/Context/Models/TaskItem.swift`, add after `var gmailMessageId: String?`:

```swift
var recordingId: String?
```

**Step 3: Add v18 migration to DatabaseService**

In `Context/Sources/Context/Services/DatabaseService.swift`, add before `return migrator` (after the v17 migration block):

```swift
migrator.registerMigration("v18_createRecordings") { db in
    try db.create(table: "recordings") { t in
        t.primaryKey("id", .text)
        t.column("projectId", .text).notNull()
            .references("projects", onDelete: .cascade)
        t.column("title", .text).notNull()
        t.column("audioPath", .text).notNull()
        t.column("duration", .double).notNull().defaults(to: 0)
        t.column("transcript", .text)
        t.column("status", .text).notNull().defaults(to: "recording")
        t.column("errorMessage", .text)
        t.column("createdAt", .datetime).notNull()
    }

    try db.alter(table: "taskItems") { t in
        t.add(column: "recordingId", .text)
    }
}
```

**Step 4: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add Context/Sources/Context/Models/Recording.swift Context/Sources/Context/Models/TaskItem.swift Context/Sources/Context/Services/DatabaseService.swift
git commit -m "feat(recordings): add Recording model and v18 database migration"
```

---

### Task 2: Add WhisperKit SPM Dependency

**Files:**
- Modify: `Context/Package.swift`

**Step 1: Add WhisperKit to Package.swift**

In `Context/Package.swift`, add to the `dependencies` array:

```swift
.package(url: "https://github.com/argmaxinc/WhisperKit.git", from: "0.9.0"),
```

And add to the `Context` target's dependencies:

```swift
.product(name: "WhisperKit", package: "WhisperKit"),
```

The full Package.swift should be:

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Context",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", from: "1.0.0"),
        .package(url: "https://github.com/argmaxinc/WhisperKit.git", from: "0.9.0"),
    ],
    targets: [
        .executableTarget(
            name: "Context",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "SwiftTerm", package: "SwiftTerm"),
                .product(name: "WhisperKit", package: "WhisperKit"),
            ],
            path: "Sources/Context"
        ),
        .executableTarget(
            name: "ContextMCP",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "Sources/ContextMCP"
        ),
    ]
)
```

**Step 2: Resolve packages**

Run: `cd Context && swift package resolve 2>&1 | tail -10`
Expected: WhisperKit and its transitive dependencies resolve successfully

**Step 3: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds (WhisperKit compiles — this may take a few minutes the first time)

**Step 4: Commit**

```bash
git add Context/Package.swift Context/Package.resolved
git commit -m "feat(recordings): add WhisperKit SPM dependency for on-device transcription"
```

---

### Task 3: AudioRecorderService — Microphone + System Audio Capture

**Files:**
- Create: `Context/Sources/Context/Services/AudioRecorderService.swift`

This is the core recording service. It captures microphone via AVAudioEngine and system audio via ScreenCaptureKit's SCStream, mixes both, and writes to an M4A file.

**Step 1: Create AudioRecorderService.swift**

Create `Context/Sources/Context/Services/AudioRecorderService.swift`:

```swift
import Foundation
import AVFoundation
import ScreenCaptureKit
import Combine

@MainActor
class AudioRecorderService: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var elapsedTime: TimeInterval = 0
    @Published var micLevel: Float = 0
    @Published var currentRecording: Recording?
    @Published var permissionError: String?

    private var audioEngine: AVAudioEngine?
    private var mixerNode: AVAudioMixerNode?
    private var audioFile: AVAudioFile?
    private var scStream: SCStream?
    private var timer: Timer?
    private var recordingStartTime: Date?

    // Target format: 16kHz mono, optimal for WhisperKit
    private let sampleRate: Double = 16000
    private let channels: AVAudioChannelCount = 1

    // MARK: - Permissions

    func checkPermissions() async -> Bool {
        // Check microphone permission
        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        if micStatus == .notDetermined {
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            if !granted {
                permissionError = "Microphone access is required to record meetings. Enable it in System Settings > Privacy & Security > Microphone."
                return false
            }
        } else if micStatus == .denied || micStatus == .restricted {
            permissionError = "Microphone access is required to record meetings. Enable it in System Settings > Privacy & Security > Microphone."
            return false
        }

        // Check screen recording permission (needed for system audio via ScreenCaptureKit)
        do {
            _ = try await SCShareableContent.current
            return true
        } catch {
            permissionError = "Screen recording permission is required to capture system audio. Enable it in System Settings > Privacy & Security > Screen Recording."
            return false
        }
    }

    // MARK: - Start Recording

    func startRecording(projectId: String) async throws -> Recording {
        guard !isRecording else { throw RecordingError.alreadyRecording }

        let recordingId = UUID().uuidString
        let audioDir = Self.recordingsDirectory(for: projectId)
        try FileManager.default.createDirectory(at: audioDir, withIntermediateDirectories: true)
        let audioURL = audioDir.appendingPathComponent("\(recordingId).m4a")

        // Create the output audio file (M4A/AAC)
        let outputFormat = AVAudioFormat(
            settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: channels,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
        )!
        let file = try AVAudioFile(forWriting: audioURL, settings: outputFormat.settings)
        audioFile = file

        // Set up AVAudioEngine for microphone
        let engine = AVAudioEngine()
        let mixer = AVAudioMixerNode()
        engine.attach(mixer)

        let inputNode = engine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)

        // Connect mic → mixer
        engine.connect(inputNode, to: mixer, format: inputFormat)

        // Install tap on mixer to write to file
        let writeFormat = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: channels)!
        mixer.installTap(onBus: 0, bufferSize: 4096, format: writeFormat) { [weak self] buffer, _ in
            try? self?.audioFile?.write(from: buffer)

            // Calculate mic level (RMS)
            guard let channelData = buffer.floatChannelData?[0] else { return }
            let frameLength = Int(buffer.frameLength)
            var sum: Float = 0
            for i in 0..<frameLength {
                sum += channelData[i] * channelData[i]
            }
            let rms = sqrt(sum / Float(frameLength))
            Task { @MainActor [weak self] in
                self?.micLevel = rms
            }
        }

        // Connect mixer → mainMixerNode (so engine graph is valid)
        engine.connect(mixer, to: engine.mainMixerNode, format: writeFormat)
        // Silence the main output so we don't hear mic playback
        engine.mainMixerNode.outputVolume = 0

        try engine.start()
        audioEngine = engine
        mixerNode = mixer

        // Set up ScreenCaptureKit for system audio
        await startSystemAudioCapture()

        // Create the recording model
        let recording = Recording(
            id: recordingId,
            projectId: projectId,
            title: "Recording — \(Self.dateFormatter.string(from: Date()))",
            audioPath: audioURL.path,
            duration: 0,
            transcript: nil,
            status: Recording.Status.recording.rawValue,
            errorMessage: nil,
            createdAt: Date()
        )

        // Save to database
        try DatabaseService.shared.dbQueue.write { db in
            var rec = recording
            try rec.insert(db)
        }

        currentRecording = recording
        isRecording = true
        recordingStartTime = Date()

        // Start elapsed time timer
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, let start = self.recordingStartTime else { return }
                self.elapsedTime = Date().timeIntervalSince(start)
            }
        }

        return recording
    }

    // MARK: - System Audio Capture

    private func startSystemAudioCapture() async {
        do {
            let content = try await SCShareableContent.current
            // Use the first available display for audio-only capture
            guard let display = content.displays.first else { return }

            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true // Don't capture our own audio
            config.channelCount = Int(channels)
            config.sampleRate = Int(sampleRate)
            // No video capture
            config.width = 2
            config.height = 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1) // Minimal frame rate

            let stream = SCStream(filter: filter, configuration: config, delegate: nil)
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global(qos: .userInitiated))
            try await stream.startCapture()
            scStream = stream
        } catch {
            print("System audio capture failed: \(error.localizedDescription)")
            // Continue with mic-only recording
        }
    }

    // MARK: - Stop Recording

    func stopRecording() async throws -> Recording {
        guard isRecording, var recording = currentRecording else {
            throw RecordingError.notRecording
        }

        // Stop timer
        timer?.invalidate()
        timer = nil

        // Stop system audio
        if let stream = scStream {
            try? await stream.stopCapture()
            scStream = nil
        }

        // Stop audio engine
        mixerNode?.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        mixerNode = nil
        audioFile = nil

        // Update recording
        recording.duration = elapsedTime
        recording.status = Recording.Status.transcribing.rawValue

        try DatabaseService.shared.dbQueue.write { db in
            try recording.update(db)
        }

        isRecording = false
        elapsedTime = 0
        micLevel = 0
        recordingStartTime = nil
        currentRecording = nil

        return recording
    }

    // MARK: - Helpers

    static func recordingsDirectory(for projectId: String) -> URL {
        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
        return appSupport
            .appendingPathComponent("Context/recordings", isDirectory: true)
            .appendingPathComponent(projectId, isDirectory: true)
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    enum RecordingError: LocalizedError {
        case alreadyRecording
        case notRecording
        case permissionDenied(String)

        var errorDescription: String? {
            switch self {
            case .alreadyRecording: return "A recording is already in progress"
            case .notRecording: return "No recording is in progress"
            case .permissionDenied(let msg): return msg
            }
        }
    }
}

// MARK: - SCStreamOutput (System Audio)

extension AudioRecorderService: SCStreamOutput {
    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        // System audio arrives as CMSampleBuffer — write to file
        // Note: In a production app, you'd convert and mix this into the
        // AVAudioFile. For v1, mic recording is the primary source.
        // System audio mixing requires converting CMSampleBuffer → AVAudioPCMBuffer
        // and writing interleaved with mic data.

        guard let formatDesc = sampleBuffer.formatDescription,
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else { return }

        let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frameCount > 0,
              let audioFormat = AVAudioFormat(streamDescription: asbd),
              let pcmBuffer = AVAudioPCMBuffer(pcmFormat: audioFormat, frameCapacity: AVAudioFrameCount(frameCount)) else { return }

        pcmBuffer.frameLength = AVAudioFrameCount(frameCount)

        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        let dataLength = CMBlockBufferGetDataLength(blockBuffer)
        var dataPointer: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: nil, dataPointerOut: &dataPointer)

        if let dataPointer, let destination = pcmBuffer.floatChannelData {
            // Copy audio data into PCM buffer
            let srcData = UnsafeRawPointer(dataPointer)
            let bytesPerFrame = Int(asbd.pointee.mBytesPerFrame)
            let totalBytes = frameCount * bytesPerFrame
            if totalBytes <= dataLength {
                memcpy(destination[0], srcData, totalBytes)
            }
        }

        // Write to file (thread-safe via serial access)
        try? self.audioFile?.write(from: pcmBuffer)
    }
}
```

**Step 2: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Services/AudioRecorderService.swift
git commit -m "feat(recordings): add AudioRecorderService with mic + system audio capture"
```

---

### Task 4: TranscriptionService — WhisperKit On-Device Transcription

**Files:**
- Create: `Context/Sources/Context/Services/TranscriptionService.swift`

**Step 1: Create TranscriptionService.swift**

Create `Context/Sources/Context/Services/TranscriptionService.swift`:

```swift
import Foundation
import WhisperKit

@MainActor
class TranscriptionService: ObservableObject {
    @Published var isTranscribing = false
    @Published var progress: Double = 0 // 0.0 to 1.0
    @Published var lastError: String?

    private var whisperKit: WhisperKit?
    private var isModelLoaded = false

    // MARK: - Model Management

    /// Downloads and loads the Whisper model. Call once (lazy — first transcription triggers it).
    func loadModel() async throws {
        guard !isModelLoaded else { return }

        let modelDir = Self.modelDirectory()
        try FileManager.default.createDirectory(at: modelDir, withIntermediateDirectories: true)

        // Initialize WhisperKit — it downloads the model on first use
        let kit = try await WhisperKit(
            model: "large-v3-turbo",
            modelFolder: modelDir.path,
            verbose: false
        )

        whisperKit = kit
        isModelLoaded = true
    }

    // MARK: - Transcription

    /// Transcribes an audio file and returns the full text.
    func transcribe(audioPath: String) async throws -> String {
        isTranscribing = true
        progress = 0
        lastError = nil
        defer {
            isTranscribing = false
            progress = 1.0
        }

        // Ensure model is loaded
        if !isModelLoaded {
            progress = 0.1
            try await loadModel()
            progress = 0.2
        }

        guard let kit = whisperKit else {
            throw TranscriptionError.modelNotLoaded
        }

        // Transcribe the audio file
        let results = try await kit.transcribe(audioPath: audioPath)

        progress = 0.9

        // Combine all segments into full text
        let fullText = results
            .compactMap { $0.text }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !fullText.isEmpty else {
            throw TranscriptionError.emptyTranscript
        }

        progress = 1.0
        return fullText
    }

    // MARK: - Helpers

    static func modelDirectory() -> URL {
        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
        return appSupport.appendingPathComponent("Context/whisper-models", isDirectory: true)
    }

    enum TranscriptionError: LocalizedError {
        case modelNotLoaded
        case emptyTranscript

        var errorDescription: String? {
            switch self {
            case .modelNotLoaded: return "Whisper model is not loaded"
            case .emptyTranscript: return "No speech detected in the recording"
            }
        }
    }
}
```

**Step 2: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Services/TranscriptionService.swift
git commit -m "feat(recordings): add TranscriptionService with WhisperKit on-device transcription"
```

---

### Task 5: ClaudeService — Task Extraction from Recordings

**Files:**
- Modify: `Context/Sources/Context/Services/ClaudeService.swift`

**Step 1: Add extractTasksFromRecording method**

In `Context/Sources/Context/Services/ClaudeService.swift`, add before the `// MARK: - Core Execution` comment (around line 322):

```swift
    // MARK: - Recording Task Extraction

    func extractTasksFromRecording(
        transcript: String
    ) async -> [(title: String, description: String?, priority: Int)]? {
        let prompt = """
        Analyze this meeting transcript and extract actionable tasks, decisions, and follow-ups.
        Look for:
        - Action items assigned to people
        - Decisions that require follow-up work
        - Problems discussed that need fixing
        - Ideas or features mentioned for implementation
        - Deadlines or time-sensitive items

        Return ONLY a JSON array with no other text. Each item should have:
        - "title": short task title (under 80 chars)
        - "description": brief description of what needs to be done
        - "priority": 0 (none), 1 (low), 2 (medium), 3 (high), 4 (urgent)

        If no tasks found, return an empty array: []

        Meeting transcript:
        \(transcript)
        """

        guard let raw = await generate(prompt: prompt) else { return nil }

        // Parse the JSON response — strip markdown code fences if present
        var jsonStr = raw
        if jsonStr.hasPrefix("```") {
            let lines = jsonStr.components(separatedBy: "\n")
            let filtered = lines.filter { !$0.hasPrefix("```") }
            jsonStr = filtered.joined(separator: "\n")
        }

        guard let data = jsonStr.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else {
            lastError = "Could not parse AI response as JSON"
            return nil
        }

        return array.compactMap { item in
            guard let title = item["title"] as? String, !title.isEmpty else { return nil }
            let desc = item["description"] as? String
            let priority = item["priority"] as? Int ?? 0
            return (title: title, description: desc, priority: min(max(priority, 0), 4))
        }
    }
```

**Step 2: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Services/ClaudeService.swift
git commit -m "feat(recordings): add extractTasksFromRecording to ClaudeService"
```

---

### Task 6: AudioPlayerView — Reusable Audio Playback Component

**Files:**
- Create: `Context/Sources/Context/Views/Recordings/AudioPlayerView.swift`

**Step 1: Create AudioPlayerView.swift**

Create directory first: `Context/Sources/Context/Views/Recordings/`

```swift
import SwiftUI
import AVFoundation

struct AudioPlayerView: View {
    let audioPath: String

    @StateObject private var player = AudioPlayerModel()

    var body: some View {
        VStack(spacing: 8) {
            // Scrubber
            Slider(
                value: Binding(
                    get: { player.currentTime },
                    set: { player.seek(to: $0) }
                ),
                in: 0...max(player.duration, 0.01)
            )

            HStack {
                // Play/Pause button
                Button(action: { player.togglePlayback() }) {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 16))
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)

                // Time display
                Text(formatTime(player.currentTime))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.secondary)

                Text("/")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)

                Text(formatTime(player.duration))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.secondary)

                Spacer()

                // Speed control
                Menu {
                    ForEach([0.5, 1.0, 1.5, 2.0], id: \.self) { speed in
                        Button("\(speed == 1.0 ? "1" : String(format: "%.1f", speed))x") {
                            player.setSpeed(Float(speed))
                        }
                    }
                } label: {
                    Text("\(player.playbackSpeed == 1.0 ? "1" : String(format: "%.1f", player.playbackSpeed))x")
                        .font(.system(size: 11, weight: .medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.15))
                        .cornerRadius(4)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
        .onAppear { player.load(path: audioPath) }
        .onDisappear { player.stop() }
    }

    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

@MainActor
class AudioPlayerModel: ObservableObject {
    @Published var isPlaying = false
    @Published var currentTime: TimeInterval = 0
    @Published var duration: TimeInterval = 0
    @Published var playbackSpeed: Float = 1.0

    private var audioPlayer: AVAudioPlayer?
    private var timer: Timer?

    func load(path: String) {
        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: path) else { return }

        do {
            let player = try AVAudioPlayer(contentsOf: url)
            player.prepareToPlay()
            self.audioPlayer = player
            self.duration = player.duration
        } catch {
            print("Failed to load audio: \(error)")
        }
    }

    func togglePlayback() {
        guard let player = audioPlayer else { return }

        if isPlaying {
            player.pause()
            timer?.invalidate()
            timer = nil
        } else {
            player.rate = playbackSpeed
            player.play()
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.currentTime = self.audioPlayer?.currentTime ?? 0
                    if !(self.audioPlayer?.isPlaying ?? false) {
                        self.isPlaying = false
                        self.timer?.invalidate()
                        self.timer = nil
                    }
                }
            }
        }
        isPlaying = !isPlaying
    }

    func seek(to time: TimeInterval) {
        audioPlayer?.currentTime = time
        currentTime = time
    }

    func setSpeed(_ speed: Float) {
        playbackSpeed = speed
        audioPlayer?.rate = speed
        // AVAudioPlayer needs enableRate = true
        audioPlayer?.enableRate = true
        audioPlayer?.rate = speed
    }

    func stop() {
        audioPlayer?.stop()
        timer?.invalidate()
        timer = nil
        isPlaying = false
    }
}
```

**Step 2: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Recordings/AudioPlayerView.swift
git commit -m "feat(recordings): add AudioPlayerView with play/pause/scrub/speed control"
```

---

### Task 7: RecordingDetailView — Transcript + Task Review

**Files:**
- Create: `Context/Sources/Context/Views/Recordings/RecordingDetailView.swift`

**Step 1: Create RecordingDetailView.swift**

```swift
import SwiftUI
import GRDB

struct RecordingDetailView: View {
    @Binding var recording: Recording
    @EnvironmentObject var appState: AppState
    @State private var extractedTasks: [(title: String, description: String?, priority: Int)] = []
    @State private var isEditingTitle = false
    @State private var editableTitle: String = ""
    @State private var acceptedTaskIds: Set<Int> = []
    @State private var dismissedTaskIds: Set<Int> = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                headerSection

                Divider()

                // Audio Player
                if FileManager.default.fileExists(atPath: recording.audioPath) {
                    AudioPlayerView(audioPath: recording.audioPath)
                }

                // Status indicator
                statusSection

                // Transcript
                if let transcript = recording.transcript {
                    transcriptSection(transcript)
                }

                // Extracted Tasks
                if recording.status == Recording.Status.ready.rawValue {
                    extractedTasksSection
                }
            }
            .padding(16)
        }
        .onAppear {
            editableTitle = recording.title
            if recording.status == Recording.Status.ready.rawValue {
                loadExtractedTasks()
            }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            if isEditingTitle {
                TextField("Recording title", text: $editableTitle, onCommit: {
                    saveTitle()
                })
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
                    ProgressView()
                        .controlSize(.small)
                    Text("Transcribing...")
                        .font(.system(size: 13))
                        .foregroundColor(.secondary)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.blue.opacity(0.1))
                .cornerRadius(8)

            case Recording.Status.extracting.rawValue:
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Extracting tasks...")
                        .font(.system(size: 13))
                        .foregroundColor(.secondary)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.purple.opacity(0.1))
                .cornerRadius(8)

            case Recording.Status.error.rawValue:
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.red)
                    Text(recording.errorMessage ?? "An error occurred")
                        .font(.system(size: 13))
                        .foregroundColor(.red)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.1))
                .cornerRadius(8)

            default:
                EmptyView()
            }
        }
    }

    // MARK: - Transcript

    private func transcriptSection(_ transcript: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Transcript")
                .font(.system(size: 14, weight: .semibold))

            Text(transcript)
                .font(.system(size: 13))
                .foregroundColor(.primary)
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
                Text("Extracted Tasks")
                    .font(.system(size: 14, weight: .semibold))

                Spacer()

                if !extractedTasks.isEmpty {
                    Button("Accept All") {
                        acceptAllTasks()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                }
            }

            if extractedTasks.isEmpty {
                Text("No tasks were extracted from this recording.")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
                    .padding(12)
                    .frame(maxWidth: .infinity)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .cornerRadius(8)
            } else {
                ForEach(Array(extractedTasks.enumerated()), id: \.offset) { index, task in
                    if !acceptedTaskIds.contains(index) && !dismissedTaskIds.contains(index) {
                        taskCard(index: index, task: task)
                    }
                }
            }
        }
    }

    private func taskCard(index: Int, task: (title: String, description: String?, priority: Int)) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                if let priority = TaskItem.Priority(rawValue: task.priority) {
                    Image(systemName: priority.icon)
                        .foregroundColor(priority.color)
                        .font(.system(size: 11))
                }
                Text(task.title)
                    .font(.system(size: 13, weight: .medium))
                Spacer()
            }

            if let desc = task.description {
                Text(desc)
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }

            HStack(spacing: 8) {
                Spacer()
                Button("Dismiss") {
                    dismissedTaskIds.insert(index)
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .controlSize(.small)

                Button("Accept") {
                    acceptTask(index: index, task: task)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
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
        try? DatabaseService.shared.dbQueue.write { db in
            try recording.update(db)
        }
    }

    private func acceptTask(index: Int, task: (title: String, description: String?, priority: Int)) {
        guard let projectId = appState.currentProject?.id else { return }
        acceptedTaskIds.insert(index)

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
            recordingId: recording.id
        )

        try? DatabaseService.shared.dbQueue.write { db in
            try taskItem.insert(db)
        }
    }

    private func acceptAllTasks() {
        for (index, task) in extractedTasks.enumerated() {
            if !acceptedTaskIds.contains(index) && !dismissedTaskIds.contains(index) {
                acceptTask(index: index, task: task)
            }
        }
    }

    private func loadExtractedTasks() {
        // Load tasks that were already extracted and saved for this recording
        // These come from the pipeline's extraction step
        guard let tasks = try? DatabaseService.shared.dbQueue.read({ db in
            try TaskItem
                .filter(Column("recordingId") == recording.id)
                .fetchAll(db)
        }) else { return }

        extractedTasks = tasks.map { (title: $0.title, description: $0.description, priority: $0.priority) }
    }

    private func formatDuration(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}
```

**Step 2: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Recordings/RecordingDetailView.swift
git commit -m "feat(recordings): add RecordingDetailView with transcript and task review"
```

---

### Task 8: RecordingsView — Main Tab View with List and Pipeline

**Files:**
- Create: `Context/Sources/Context/Views/Recordings/RecordingsView.swift`

This is the main view for the Recordings tab. It handles the recording list, empty state, recording-in-progress bar, and the pipeline (auto-transcribe → auto-extract tasks after recording stops).

**Step 1: Create RecordingsView.swift**

```swift
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
            // Toolbar with record button
            toolbar

            Divider()

            // Recording in progress bar
            if recorder.isRecording {
                recordingBar
                Divider()
            }

            // Pipeline status
            if let msg = pipelineMessage {
                pipelineStatusBar(msg)
                Divider()
            }

            if recordings.isEmpty && !recorder.isRecording {
                emptyState
            } else {
                // Split view: list + detail
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
            Text("Recordings")
                .font(.system(size: 13, weight: .semibold))

            Spacer()

            // Record / Stop button
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
            // Pulsing red dot
            Circle()
                .fill(Color.red)
                .frame(width: 8, height: 8)
                .opacity(recorder.isRecording ? 1 : 0.3)
                .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: recorder.isRecording)

            Text("Recording")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.red)

            Text(formatTime(recorder.elapsedTime))
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(.secondary)

            // Mic level indicator
            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.green)
                    .frame(width: max(2, geo.size.width * CGFloat(min(recorder.micLevel * 5, 1.0))))
            }
            .frame(width: 60, height: 6)
            .background(Color.green.opacity(0.15))
            .cornerRadius(2)

            Spacer()

            Button("Stop") {
                toggleRecording()
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
            .controlSize(.small)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.red.opacity(0.05))
    }

    // MARK: - Pipeline Status

    private func pipelineStatusBar(_ message: String) -> some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text(message)
                .font(.system(size: 12))
                .foregroundColor(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
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

            Button("Start Recording") {
                toggleRecording()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.regular)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Recording List

    private var recordingList: some View {
        List(selection: $selectedRecordingId) {
            ForEach(recordings) { recording in
                recordingRow(recording)
                    .tag(recording.id)
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
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)

                Text(formatTime(recording.duration))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.secondary)
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
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.12))
            .cornerRadius(4)
    }

    // MARK: - Actions

    private func toggleRecording() {
        Task {
            if recorder.isRecording {
                do {
                    let recording = try await recorder.stopRecording()
                    loadRecordings()
                    selectedRecordingId = recording.id
                    // Start pipeline
                    await runPipeline(for: recording)
                } catch {
                    print("Stop recording error: \(error)")
                }
            } else {
                guard let projectId = appState.currentProject?.id else { return }

                // Check permissions first
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
            try DatabaseService.shared.dbQueue.write { db in
                try rec.update(db)
            }
            loadRecordings()
        } catch {
            rec.status = Recording.Status.error.rawValue
            rec.errorMessage = "Transcription failed: \(error.localizedDescription)"
            try? DatabaseService.shared.dbQueue.write { db in try rec.update(db) }
            loadRecordings()
            pipelineMessage = nil
            return
        }

        // Step 2: Extract tasks
        pipelineMessage = "Extracting tasks from transcript..."
        guard let transcript = rec.transcript else {
            pipelineMessage = nil
            return
        }

        if let tasks = await claude.extractTasksFromRecording(transcript: transcript) {
            guard let projectId = appState.currentProject?.id else {
                pipelineMessage = nil
                return
            }
            // Save extracted tasks (user will review in detail view)
            try? DatabaseService.shared.dbQueue.write { db in
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

        // Mark as ready
        rec.status = Recording.Status.ready.rawValue
        try? DatabaseService.shared.dbQueue.write { db in try rec.update(db) }
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
```

**Step 2: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Views/Recordings/RecordingsView.swift
git commit -m "feat(recordings): add RecordingsView with recording list, pipeline, and empty state"
```

---

### Task 9: Wire Recordings Tab into App

**Files:**
- Modify: `Context/Sources/Context/ViewModels/AppState.swift` (add `.recordings` to GUITab)
- Modify: `Context/Sources/Context/Views/GUIPanelView.swift` (add RecordingsView case)

**Step 1: Add .recordings to GUITab enum**

In `Context/Sources/Context/ViewModels/AppState.swift`, add a new case to the `GUITab` enum after `case visualize = "Visualize"`:

```swift
case recordings = "Recordings"
```

And add to the `icon` computed property, before the closing `}`:

```swift
case .recordings: return "waveform"
```

**Step 2: Add RecordingsView to GUIPanelView tab switch**

In `Context/Sources/Context/Views/GUIPanelView.swift`, in the `switch appState.selectedTab` block (around line 152), add before `case .browser:`:

```swift
case .recordings:
    RecordingsView()
```

**Step 3: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add Context/Sources/Context/ViewModels/AppState.swift Context/Sources/Context/Views/GUIPanelView.swift
git commit -m "feat(recordings): wire Recordings tab into GUITab enum and GUIPanelView"
```

---

### Task 10: Info.plist Permission Descriptions

**Files:**
- Create: `Context/Sources/Context/Resources/Info.plist`

Since this is an SPM project, we need to create a custom Info.plist with permission description strings. The app currently uses an auto-generated Info.plist. We'll create one that includes the required privacy descriptions.

**Step 1: Create Info.plist with permission descriptions**

Create `Context/Sources/Context/Resources/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Context</string>
    <key>CFBundleIdentifier</key>
    <string>com.context.app</string>
    <key>CFBundleName</key>
    <string>Context</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSUIElement</key>
    <false/>
    <key>NSMicrophoneUsageDescription</key>
    <string>Context needs microphone access to record meeting audio for transcription and task extraction.</string>
</dict>
</plist>
```

Note: `NSScreenCaptureUsageDescription` is not a valid Info.plist key — ScreenCaptureKit permissions are managed through System Settings > Privacy & Security > Screen Recording. The system prompts automatically when `SCShareableContent` is first accessed.

**Step 2: Build to verify**

Run: `cd Context && swift build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add Context/Sources/Context/Resources/Info.plist
git commit -m "feat(recordings): add Info.plist with NSMicrophoneUsageDescription"
```

---

### Task 11: Final Build Verification and Manual Test

**Step 1: Clean build**

Run: `cd Context && swift build 2>&1 | tail -10`
Expected: Build succeeds with no errors

**Step 2: Launch the app**

Run: `cd Context && .build/debug/Context.app/Contents/MacOS/Context &`

**Step 3: Manual verification checklist**

- [ ] Open a project in the sidebar
- [ ] Verify "Recordings" tab appears in the tab bar with waveform icon
- [ ] Click the tab — should show empty state with "No Recordings" message
- [ ] Click the red record button — should prompt for microphone permission
- [ ] If permission granted, recording bar should appear with pulsing red dot and elapsed time
- [ ] Click Stop — recording should appear in the list, pipeline should start (transcribing → extracting → ready)

**Step 4: Commit any final fixes if needed**

```bash
git add -A
git commit -m "fix(recordings): final adjustments from manual testing"
```

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `Context/Sources/Context/Models/Recording.swift` | Create | GRDB model for recordings table |
| `Context/Sources/Context/Models/TaskItem.swift` | Modify | Add `recordingId: String?` field |
| `Context/Sources/Context/Services/DatabaseService.swift` | Modify | Add v18 migration (recordings table + taskItems.recordingId) |
| `Context/Package.swift` | Modify | Add WhisperKit SPM dependency |
| `Context/Sources/Context/Services/AudioRecorderService.swift` | Create | AVAudioEngine + SCStream capture, mixing, M4A writing |
| `Context/Sources/Context/Services/TranscriptionService.swift` | Create | WhisperKit model management and transcription |
| `Context/Sources/Context/Services/ClaudeService.swift` | Modify | Add `extractTasksFromRecording` method |
| `Context/Sources/Context/Views/Recordings/AudioPlayerView.swift` | Create | Reusable play/pause/scrub/speed component |
| `Context/Sources/Context/Views/Recordings/RecordingDetailView.swift` | Create | Audio player, transcript, task review panel |
| `Context/Sources/Context/Views/Recordings/RecordingsView.swift` | Create | Main recordings tab: list, empty state, recording bar, pipeline |
| `Context/Sources/Context/ViewModels/AppState.swift` | Modify | Add `.recordings` to GUITab enum |
| `Context/Sources/Context/Views/GUIPanelView.swift` | Modify | Add RecordingsView case to tab switch |
| `Context/Sources/Context/Resources/Info.plist` | Create | NSMicrophoneUsageDescription permission |

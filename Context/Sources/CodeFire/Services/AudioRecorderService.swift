import Foundation
import AVFoundation
import CoreMedia
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
    /// Thread-safe reference used by the nonisolated SCStreamOutput callback and the mic tap
    private nonisolated(unsafe) var activeAudioFile: AVAudioFile?
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
        activeAudioFile = file

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
            try? self?.activeAudioFile?.write(from: buffer)

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
        try await DatabaseService.shared.dbQueue.write { db in
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
            guard let display = content.displays.first else { return }

            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true
            config.channelCount = Int(channels)
            config.sampleRate = Int(sampleRate)
            // Minimal video (required by SCStream but we only want audio)
            config.width = 2
            config.height = 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

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

        timer?.invalidate()
        timer = nil

        if let stream = scStream {
            try? await stream.stopCapture()
            scStream = nil
        }

        mixerNode?.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        mixerNode = nil
        audioFile = nil
        activeAudioFile = nil

        recording.duration = elapsedTime
        recording.status = Recording.Status.transcribing.rawValue

        let updatedRecording = recording
        try await DatabaseService.shared.dbQueue.write { [updatedRecording] db in
            try updatedRecording.update(db)
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
            .appendingPathComponent("CodeFire/recordings", isDirectory: true)
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
            let bytesPerFrame = Int(asbd.pointee.mBytesPerFrame)
            let totalBytes = frameCount * bytesPerFrame
            if totalBytes <= dataLength {
                memcpy(destination[0], UnsafeRawPointer(dataPointer), totalBytes)
            }
        }

        try? self.activeAudioFile?.write(from: pcmBuffer)
    }
}

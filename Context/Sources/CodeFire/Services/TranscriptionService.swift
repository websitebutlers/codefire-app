import Foundation
import WhisperKit

@MainActor
class TranscriptionService: ObservableObject {
    @Published var isTranscribing = false
    @Published var progress: Double = 0
    @Published var lastError: String?

    private var whisperKit: WhisperKit?
    private var isModelLoaded = false

    // MARK: - Model Management

    func loadModel() async throws {
        guard !isModelLoaded else { return }

        let modelDir = Self.modelDirectory()
        try FileManager.default.createDirectory(at: modelDir, withIntermediateDirectories: true)

        let config = WhisperKitConfig(
            model: "large-v3-turbo",
            downloadBase: modelDir,
            verbose: true,
            load: true,
            download: true
        )
        let kit = try await WhisperKit(config)

        whisperKit = kit
        isModelLoaded = true
    }

    // MARK: - Transcription

    func transcribe(audioPath: String) async throws -> String {
        isTranscribing = true
        progress = 0
        lastError = nil
        defer {
            isTranscribing = false
            progress = 1.0
        }

        if !isModelLoaded {
            progress = 0.1
            try await loadModel()
            progress = 0.2
        }

        guard let kit = whisperKit else {
            throw TranscriptionError.modelNotLoaded
        }

        let results: [TranscriptionResult] = try await kit.transcribe(audioPath: audioPath)

        progress = 0.9

        let fullText = results
            .map { $0.text }
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
        return appSupport.appendingPathComponent("CodeFire/whisper-models", isDirectory: true)
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

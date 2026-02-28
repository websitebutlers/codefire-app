import SwiftUI
import AVFoundation

struct AudioPlayerView: View {
    let audioPath: String

    @StateObject private var player = AudioPlayerModel()

    var body: some View {
        VStack(spacing: 8) {
            Slider(
                value: Binding(
                    get: { player.currentTime },
                    set: { player.seek(to: $0) }
                ),
                in: 0...max(player.duration, 0.01)
            )

            HStack {
                Button(action: { player.togglePlayback() }) {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 16))
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)

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
            player.enableRate = true
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

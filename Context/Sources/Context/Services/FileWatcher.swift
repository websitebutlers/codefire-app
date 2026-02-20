import Foundation
import CoreServices

class FileWatcher {
    typealias Callback = ([String]) -> Void

    private var stream: FSEventStreamRef?
    private let paths: [String]
    private let callback: Callback
    private let debounceInterval: TimeInterval

    private var debounceTimer: Timer?
    private var pendingPaths: Set<String> = []

    init(paths: [String], debounceInterval: TimeInterval = 2.0, callback: @escaping Callback) {
        self.paths = paths
        self.callback = callback
        self.debounceInterval = debounceInterval
    }

    deinit {
        stop()
    }

    func start() {
        guard stream == nil else { return }

        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )

        let cfPaths = paths as CFArray

        let streamCallback: FSEventStreamCallback = {
            (streamRef: ConstFSEventStreamRef,
             clientCallbackInfo: UnsafeMutableRawPointer?,
             numEvents: Int,
             eventPaths: UnsafeMutableRawPointer,
             eventFlags: UnsafePointer<FSEventStreamEventFlags>,
             eventIds: UnsafePointer<FSEventStreamEventId>) in

            guard let info = clientCallbackInfo else { return }
            let watcher = Unmanaged<FileWatcher>.fromOpaque(info).takeUnretainedValue()

            let paths = Unmanaged<CFArray>.fromOpaque(eventPaths).takeUnretainedValue() as! [String]
            watcher.handleEvents(paths: paths)
        }

        let flags: FSEventStreamCreateFlags =
            UInt32(kFSEventStreamCreateFlagUseCFTypes) |
            UInt32(kFSEventStreamCreateFlagFileEvents) |
            UInt32(kFSEventStreamCreateFlagNoDefer)

        guard let newStream = FSEventStreamCreate(
            kCFAllocatorDefault,
            streamCallback,
            &context,
            cfPaths,
            FSEventsGetCurrentEventId(),
            1.0,
            flags
        ) else {
            return
        }

        stream = newStream
        FSEventStreamSetDispatchQueue(newStream, DispatchQueue.main)
        FSEventStreamStart(newStream)
    }

    func stop() {
        debounceTimer?.invalidate()
        debounceTimer = nil

        if let stream = stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            self.stream = nil
        }

        pendingPaths.removeAll()
    }

    private func handleEvents(paths: [String]) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            for path in paths {
                self.pendingPaths.insert(path)
            }

            self.debounceTimer?.invalidate()
            self.debounceTimer = Timer.scheduledTimer(
                withTimeInterval: self.debounceInterval,
                repeats: false
            ) { [weak self] _ in
                guard let self = self else { return }
                let changedPaths = Array(self.pendingPaths)
                self.pendingPaths.removeAll()
                self.callback(changedPaths)
            }
        }
    }
}

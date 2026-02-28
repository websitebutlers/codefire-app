# Audio Recorder + Transcription + Task Extraction — Design

## Problem

Meeting notes and action items get lost. You join a call, discuss tasks, make decisions, then have to manually remember and log everything afterward. Context.app already manages tasks and projects — if it could record meetings, transcribe them, and extract tasks automatically, the entire capture-to-action pipeline would be seamless.

## Solution

A new "Recordings" tab per project. Record system audio + microphone (full meeting capture), auto-transcribe on-device with WhisperKit, auto-extract tasks via Claude CLI, then review and approve tasks onto the kanban board.

## Architecture

```
Record (AVAudioEngine + SCStream)
    → M4A file saved to disk
    → WhisperKit transcription (on-device, background)
    → Claude CLI task extraction (same pattern as session task extraction)
    → User reviews & approves extracted tasks
    → Tasks land on project kanban board
```

## Data Model

### New `recordings` table

| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | UUID |
| projectId | TEXT FK | Which project this belongs to |
| title | TEXT | User-editable name (defaults to "Recording — {date}") |
| audioPath | TEXT | Path to M4A file in app support dir |
| duration | DOUBLE | Length in seconds |
| transcript | TEXT | Full transcription text (null until transcribed) |
| status | TEXT | recording → transcribing → extracting → ready / error |
| errorMessage | TEXT | Error details if status is error |
| createdAt | DATE | When recording started |

Audio files stored at: `~/Library/Application Support/Context/recordings/{projectId}/{recordingId}.m4a`

### Task linkage

New optional `recordingId` column on `taskItems` table. Extracted tasks saved with `source: "recording"` and linked back to the recording.

## Audio Capture

Two streams mixed into one file:

- **Microphone** — `AVAudioEngine` input node. Requires `NSMicrophoneUsageDescription`.
- **System audio** — `SCStream` from ScreenCaptureKit (audio-only, no screen content). Requires `NSScreenCaptureUsageDescription` (screen recording permission).

Both streams feed into an `AVAudioMixerNode`, output to `AVAudioFile` writing M4A (AAC codec, 16kHz mono — optimal for WhisperKit).

### AudioRecorderService

- `startRecording(projectId:)` — sets up both capture streams, starts writing
- `stopRecording()` — tears down streams, finalizes file, returns Recording model
- `@Published var isRecording: Bool`
- `@Published var elapsedTime: TimeInterval`
- `@Published var micLevel: Float` (for visual feedback)

Permission checks before recording: `AVCaptureDevice.authorizationStatus(for: .audio)` and `SCShareableContent.current`. Helpful message if denied.

## Transcription

- **WhisperKit** SPM dependency (argmaxinc/WhisperKit)
- Model: `whisper-large-v3-turbo` (~400MB, downloads on first use, cached in app support)
- `TranscriptionService` loads model lazily, transcribes M4A, returns text
- Runs on background thread with progress reporting
- ~10x real-time on Apple Silicon (60-min meeting ≈ 6 minutes)
- Transcript stored as plain text in `recordings.transcript`

## Task Extraction

- Claude CLI (`claude -p`), same pattern as `ClaudeService.extractTasksFromSession`
- Prompt: "Extract actionable tasks from this meeting transcript. Return JSON array of {title, description, priority}. Focus on action items, decisions, and follow-ups."
- Parse JSON response into task candidates
- Save as `taskItems` with `status: "todo"`, `source: "recording"`, `recordingId` linked

### Pipeline state machine

```
recording → transcribing → extracting → ready
                ↘ error       ↘ error
```

Each transition updates `recordings.status`. UI reacts via @Published properties.

Tasks don't silently appear — user reviews and approves each one before they land on the kanban board.

## UI — Recordings Tab

New `.recordings` case in `GUITab` enum (icon: `waveform`).

### Three states

**Empty state:** Centered message + "Start your first recording" button.

**Recording in progress:** Top bar with red pulsing dot, elapsed time, mic level meter, Stop button. Recording list visible below.

**Recording list + detail:** Left column lists recordings (title, date, duration, status badge). Right detail view shows:
- Header: editable title, date, duration
- Audio player: play/pause, scrubber, speed control (1x/1.5x/2x)
- Transcript section: scrollable text (or progress bar if transcribing)
- Extracted tasks: cards with Accept/Edit/Dismiss per task, "Accept All" at top
- Status indicator for pipeline stage

### Recording trigger

Red circle button in tab toolbar. Becomes stop button (red square) while recording.

No menu bar widget or global shortcut for v1.

## Files

| File | Change |
|------|--------|
| `AudioRecorderService.swift` | **New** — AVAudioEngine + SCStream capture, mixing, M4A writing |
| `TranscriptionService.swift` | **New** — WhisperKit model management and transcription |
| `Recording.swift` | **New** — GRDB model for recordings table |
| `RecordingsView.swift` | **New** — List + detail view for Recordings tab |
| `RecordingDetailView.swift` | **New** — Audio player, transcript, task review panel |
| `AudioPlayerView.swift` | **New** — Reusable play/pause/scrub/speed component |
| `DatabaseService.swift` | Add migration: recordings table + taskItems.recordingId |
| `ClaudeService.swift` | Add `extractTasksFromRecording` method |
| `AppState.swift` | Add `.recordings` to GUITab enum |
| `GUIPanelView.swift` | Add recordings tab case |
| `Package.swift` | Add WhisperKit dependency |
| `Info.plist` | Add NSMicrophoneUsageDescription, NSScreenCaptureUsageDescription |

## Constraints

- macOS 14+ (already the minimum, ScreenCaptureKit requires 13+)
- WhisperKit requires Apple Silicon for reasonable performance (Intel Macs would be very slow)
- First transcription requires ~400MB model download
- Screen recording permission prompt is system-level and can't be customized
- Audio files can be large (~1MB/min for M4A at 16kHz) — consider cleanup/export later

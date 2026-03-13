import { Mic, Square, Loader2, FileAudio, Monitor, MicIcon, ChevronDown } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useRecorder, type RecordingMode } from '@renderer/hooks/useRecorder'

interface RecordingBarProps {
  onRecordingComplete: (blob: Blob, title: string) => void
  onImportFile: () => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const MODES: { id: RecordingMode; label: string; icon: typeof Mic; hint: string }[] = [
  { id: 'mic', label: 'Mic', icon: MicIcon, hint: 'Microphone only' },
  { id: 'system', label: 'System', icon: Monitor, hint: 'System audio (what you hear)' },
  { id: 'both', label: 'Both', icon: Mic, hint: 'Microphone + system audio' },
]

/** Real-time audio level bar */
function AudioLevelMeter({ level }: { level: number }) {
  const bars = 12
  return (
    <div className="flex items-center gap-[2px] h-5">
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = (i + 1) / bars
        const active = level >= threshold
        const color = i < 8 ? 'bg-green-400' : i < 10 ? 'bg-yellow-400' : 'bg-red-400'
        return (
          <div
            key={i}
            className={`w-[3px] rounded-sm transition-all duration-75 ${
              active ? color : 'bg-neutral-700'
            }`}
            style={{ height: `${40 + (i / bars) * 60}%` }}
          />
        )
      })}
    </div>
  )
}

export default function RecordingBar({ onRecordingComplete, onImportFile }: RecordingBarProps) {
  const {
    isRecording,
    duration,
    audioLevel,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    startRecording,
    stopRecording,
  } = useRecorder()
  const [title, setTitle] = useState('')
  const [starting, setStarting] = useState(false)
  const [mode, setMode] = useState<RecordingMode>('mic')
  const [showDevices, setShowDevices] = useState(false)
  const deviceDropdownRef = useRef<HTMLDivElement>(null)

  // Close device dropdown on click outside
  useEffect(() => {
    if (!showDevices) return
    function handleClickOutside(e: MouseEvent) {
      if (deviceDropdownRef.current && !deviceDropdownRef.current.contains(e.target as Node)) {
        setShowDevices(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDevices])

  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId)
  const deviceLabel = selectedDevice?.label || 'Default microphone'

  async function handleStart() {
    setStarting(true)
    try {
      await startRecording(mode)
    } catch (err) {
      console.error('Failed to start recording:', err)
    }
    setStarting(false)
  }

  async function handleStop() {
    const blob = await stopRecording()
    if (blob) {
      const recordingTitle = title.trim() || `Recording ${new Date().toLocaleString()}`
      onRecordingComplete(blob, recordingTitle)
      setTitle('')
    }
  }

  return (
    <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-900 space-y-2">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Recording title..."
          disabled={isRecording}
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-codefire-orange/50 disabled:opacity-50"
        />

        {/* Mode selector — only visible when not recording */}
        {!isRecording && (
          <div className="flex items-center rounded border border-neutral-700 overflow-hidden">
            {MODES.map((m) => {
              const Icon = m.icon
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  title={m.hint}
                  className={`flex items-center gap-1 px-2 py-1.5 text-[11px] transition-colors ${
                    mode === m.id
                      ? 'bg-codefire-orange/20 text-codefire-orange'
                      : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
                  }`}
                >
                  <Icon size={12} />
                  {m.label}
                </button>
              )
            })}
          </div>
        )}

        {isRecording ? (
          <>
            <AudioLevelMeter level={audioLevel} />
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-mono text-red-400">
                {formatDuration(duration)}
              </span>
            </div>
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded text-sm transition-colors"
            >
              <Square size={14} />
              Stop
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleStart}
              disabled={starting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-codefire-orange/20 text-codefire-orange hover:bg-codefire-orange/30 rounded text-sm transition-colors disabled:opacity-50"
            >
              {starting ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
              Record
            </button>
            <button
              type="button"
              onClick={onImportFile}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 rounded text-sm transition-colors"
            >
              <FileAudio size={14} />
              Import File
            </button>
          </>
        )}
      </div>

      {/* Device selector row — visible when mic or both mode and not recording */}
      {!isRecording && mode !== 'system' && devices.length > 0 && (
        <div className="relative" ref={deviceDropdownRef}>
          <button
            type="button"
            onClick={() => setShowDevices(!showDevices)}
            className="flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            <MicIcon size={10} />
            <span className="truncate max-w-[300px]">{deviceLabel}</span>
            <ChevronDown size={10} className={`transition-transform ${showDevices ? 'rotate-180' : ''}`} />
          </button>
          {showDevices && (
            <div className="absolute top-full left-0 mt-1 z-20 bg-neutral-800 border border-neutral-700 rounded shadow-lg py-1 min-w-[260px] max-h-[200px] overflow-y-auto">
              {devices.map((d) => (
                <button
                  key={d.deviceId}
                  type="button"
                  onClick={() => {
                    setSelectedDeviceId(d.deviceId)
                    setShowDevices(false)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] truncate transition-colors ${
                    d.deviceId === selectedDeviceId
                      ? 'text-codefire-orange bg-codefire-orange/10'
                      : 'text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

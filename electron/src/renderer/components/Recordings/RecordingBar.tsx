import { Mic, Square, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useRecorder } from '@renderer/hooks/useRecorder'

interface RecordingBarProps {
  onRecordingComplete: (blob: Blob, title: string) => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function RecordingBar({ onRecordingComplete }: RecordingBarProps) {
  const { isRecording, duration, startRecording, stopRecording } = useRecorder()
  const [title, setTitle] = useState('')
  const [starting, setStarting] = useState(false)

  async function handleStart() {
    setStarting(true)
    try {
      await startRecording()
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
    <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 bg-neutral-900">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Recording title..."
        disabled={isRecording}
        className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-codefire-orange/50 disabled:opacity-50"
      />

      {isRecording ? (
        <>
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
        <button
          type="button"
          onClick={handleStart}
          disabled={starting}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-codefire-orange/20 text-codefire-orange hover:bg-codefire-orange/30 rounded text-sm transition-colors disabled:opacity-50"
        >
          {starting ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
          Record
        </button>
      )}
    </div>
  )
}

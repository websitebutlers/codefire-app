import { Mic, Play, Pause, Key, Loader2 } from 'lucide-react'
import { useState, useRef } from 'react'
import type { Recording } from '@shared/models'

interface RecordingDetailProps {
  recording: Recording | null
  onTranscribe: (id: string) => void
  isTranscribing: boolean
}

export default function RecordingDetail({
  recording,
  onTranscribe,
  isTranscribing,
}: RecordingDetailProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  if (!recording) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
        <Mic size={32} />
        <p className="text-sm">Select a recording</p>
      </div>
    )
  }

  function togglePlayback() {
    if (!audioRef.current) {
      audioRef.current = new Audio(`file://${recording!.audioPath}`)
      audioRef.current.onended = () => setIsPlaying(false)
    }

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800">
        <button
          type="button"
          onClick={togglePlayback}
          className="p-2 bg-codefire-orange/20 text-codefire-orange rounded-full hover:bg-codefire-orange/30 transition-colors"
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-neutral-200 font-medium truncate">
            {recording.title}
          </p>
          <p className="text-[10px] text-neutral-500">
            {Math.floor(recording.duration / 60)}m{' '}
            {Math.round(recording.duration % 60)}s —{' '}
            {new Date(recording.createdAt).toLocaleString()}
          </p>
        </div>

        {recording.status !== 'done' && recording.status !== 'transcribing' && (
          <button
            type="button"
            onClick={() => onTranscribe(recording.id)}
            disabled={isTranscribing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 rounded text-xs transition-colors disabled:opacity-50"
          >
            {isTranscribing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Key size={12} />
            )}
            Transcribe
          </button>
        )}
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-4">
        {recording.status === 'transcribing' && (
          <div className="flex items-center justify-center gap-2 py-8 text-neutral-500">
            <Loader2 size={16} className="animate-spin" />
            <p className="text-sm">Transcribing with Whisper...</p>
          </div>
        )}

        {recording.status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <p className="text-xs text-red-400">{recording.errorMessage}</p>
          </div>
        )}

        {recording.transcript ? (
          <div className="space-y-3">
            <p className="text-[10px] text-neutral-600 uppercase tracking-wider">
              Transcript
            </p>
            <p className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap">
              {recording.transcript}
            </p>
          </div>
        ) : (
          recording.status !== 'transcribing' &&
          recording.status !== 'error' && (
            <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
              <p className="text-xs">No transcript yet</p>
              <p className="text-[10px] text-neutral-600">
                Click &quot;Transcribe&quot; to generate one with OpenAI Whisper
              </p>
            </div>
          )
        )}
      </div>
    </div>
  )
}

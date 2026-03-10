import { Mic, Play, Pause, Key, Loader2, ListTodo, Check, Settings } from 'lucide-react'
import { useState, useRef, useEffect, useCallback } from 'react'
import type { Recording } from '@shared/models'
import { api } from '@renderer/lib/api'

interface RecordingDetailProps {
  recording: Recording | null
  onTranscribe: (id: string) => void
  isTranscribing: boolean
  projectId?: string
  hasOpenAiKey: boolean
}

export default function RecordingDetail({
  recording,
  onTranscribe,
  isTranscribing,
  projectId,
  hasOpenAiKey,
}: RecordingDetailProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackProgress, setPlaybackProgress] = useState(0)
  const [waveformData, setWaveformData] = useState<number[]>([])
  const [extracting, setExtracting] = useState(false)
  const [extractResult, setExtractResult] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const animFrameRef = useRef<number>(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Load waveform data when recording changes
  useEffect(() => {
    if (!recording?.audioPath) return
    setWaveformData([])
    setPlaybackProgress(0)

    const audioCtx = new AudioContext()
    fetch(`file://${recording.audioPath}`)
      .then((res) => res.arrayBuffer())
      .then((buf) => audioCtx.decodeAudioData(buf))
      .then((decoded) => {
        const raw = decoded.getChannelData(0)
        const bars = 80
        const blockSize = Math.floor(raw.length / bars)
        const samples: number[] = []
        for (let i = 0; i < bars; i++) {
          let sum = 0
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(raw[i * blockSize + j])
          }
          samples.push(sum / blockSize)
        }
        const max = Math.max(...samples, 0.01)
        setWaveformData(samples.map((s) => s / max))
      })
      .catch(() => {})
      .finally(() => audioCtx.close())
  }, [recording?.audioPath])

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || waveformData.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height
    const barW = w / waveformData.length
    const gap = 1

    ctx.clearRect(0, 0, w, h)

    for (let i = 0; i < waveformData.length; i++) {
      const barH = Math.max(2, waveformData[i] * (h - 4))
      const x = i * barW
      const y = (h - barH) / 2
      const progress = i / waveformData.length

      ctx.fillStyle = progress < playbackProgress
        ? 'rgba(249, 115, 22, 0.8)'  // orange for played
        : 'rgba(115, 115, 115, 0.4)' // grey for unplayed
      ctx.beginPath()
      ctx.roundRect(x + gap / 2, y, barW - gap, barH, 1)
      ctx.fill()
    }
  }, [waveformData, playbackProgress])

  // Track playback progress
  const trackProgress = useCallback(() => {
    if (audioRef.current && isPlaying) {
      const progress = audioRef.current.currentTime / audioRef.current.duration
      setPlaybackProgress(isNaN(progress) ? 0 : progress)
      animFrameRef.current = requestAnimationFrame(trackProgress)
    }
  }, [isPlaying])

  useEffect(() => {
    if (isPlaying) {
      animFrameRef.current = requestAnimationFrame(trackProgress)
    }
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [isPlaying, trackProgress])

  async function handleExtractTasks() {
    if (!recording?.transcript || !projectId) return
    setExtracting(true)
    setExtractResult(null)
    try {
      const config = (await window.api.invoke('settings:get')) as { openRouterKey?: string; chatModel?: string } | undefined
      const apiKey = config?.openRouterKey
      if (!apiKey) {
        setExtractResult('Set OpenRouter API key in Settings > Engine')
        return
      }
      const model = config?.chatModel || 'google/gemini-3.1-pro-preview'
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Extract actionable tasks from this voice note transcript. Return ONLY a JSON array of objects with "title" and "description" fields. Return empty array if no tasks found.' },
            { role: 'user', content: recording.transcript },
          ],
          max_tokens: 1500,
        }),
      })
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content ?? ''
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) { setExtractResult('No tasks found'); return }
      const tasks = JSON.parse(jsonMatch[0]) as { title: string; description?: string }[]
      let created = 0
      for (const t of tasks) {
        if (t.title) {
          await api.tasks.create({ projectId, title: t.title, description: t.description || '', priority: 2, source: 'ai-extracted' })
          created++
        }
      }
      setExtractResult(`Created ${created} task${created !== 1 ? 's' : ''}`)
    } catch (err) {
      setExtractResult(err instanceof Error ? err.message : 'Failed to extract tasks')
    } finally {
      setExtracting(false)
    }
  }

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
      audioRef.current.onended = () => {
        setIsPlaying(false)
        setPlaybackProgress(1)
      }
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
          hasOpenAiKey ? (
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
          ) : (
            <span
              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 text-neutral-500 rounded text-xs cursor-default"
              title="Add your OpenAI API key in Settings → Engine to enable transcription"
            >
              <Settings size={12} />
              Transcribe (no API key)
            </span>
          )
        )}
        {recording.transcript && projectId && (
          <button
            type="button"
            onClick={handleExtractTasks}
            disabled={extracting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded text-xs transition-colors disabled:opacity-50"
          >
            {extracting ? <Loader2 size={12} className="animate-spin" /> : <ListTodo size={12} />}
            Extract Tasks
          </button>
        )}
      </div>

      {/* Waveform */}
      {waveformData.length > 0 && (
        <div className="px-4 py-3 border-b border-neutral-800">
          <canvas
            ref={canvasRef}
            className="w-full h-12 rounded cursor-pointer"
            onClick={(e) => {
              if (!audioRef.current) return
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = (e.clientX - rect.left) / rect.width
              audioRef.current.currentTime = pct * audioRef.current.duration
              setPlaybackProgress(pct)
            }}
          />
        </div>
      )}

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-4">
        {extractResult && (
          <div className="mb-3 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded text-xs text-green-400 flex items-center gap-1.5">
            <Check size={12} />
            {extractResult}
          </div>
        )}
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
                {hasOpenAiKey
                  ? 'Click "Transcribe" to generate one with OpenAI Whisper'
                  : 'Add your OpenAI API key in Settings → Engine to enable transcription'}
              </p>
            </div>
          )
        )}
      </div>
    </div>
  )
}

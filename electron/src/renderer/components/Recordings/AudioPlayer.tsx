import { Play, Pause } from 'lucide-react'
import { useState, useRef, useEffect, useCallback } from 'react'

interface AudioPlayerProps {
  audioPath: string
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const SPEEDS = [0.5, 1, 1.5, 2] as const

export default function AudioPlayer({ audioPath }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const rafRef = useRef<number>(0)

  // Create / replace the audio element whenever the path changes
  useEffect(() => {
    const audio = new Audio(`file://${audioPath}`)
    audioRef.current = audio

    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration)
    })
    audio.addEventListener('ended', () => {
      setIsPlaying(false)
    })

    // Reset state
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setSpeed(1)

    return () => {
      audio.pause()
      audio.src = ''
      cancelAnimationFrame(rafRef.current)
    }
  }, [audioPath])

  // Progress tracking via requestAnimationFrame
  const tick = useCallback(() => {
    const audio = audioRef.current
    if (audio && !audio.paused) {
      setCurrentTime(audio.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [])

  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(tick)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying, tick])

  function togglePlayback() {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.playbackRate = speed
      audio.play()
      setIsPlaying(true)
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const time = Number(e.target.value)
    const audio = audioRef.current
    if (audio) {
      audio.currentTime = time
      setCurrentTime(time)
    }
  }

  function handleSpeedChange(newSpeed: number) {
    setSpeed(newSpeed)
    const audio = audioRef.current
    if (audio) {
      audio.playbackRate = newSpeed
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3 bg-neutral-800 border border-neutral-700 rounded-lg">
      {/* Seek slider */}
      <input
        type="range"
        min={0}
        max={duration || 0.01}
        step={0.1}
        value={currentTime}
        onChange={handleSeek}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer [accent-color:var(--color-codefire-orange)] bg-neutral-700"
      />

      {/* Controls row */}
      <div className="flex items-center gap-3">
        {/* Play / Pause */}
        <button
          type="button"
          onClick={togglePlayback}
          className="p-1.5 rounded-full bg-codefire-orange/20 text-codefire-orange hover:bg-codefire-orange/30 transition-colors"
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>

        {/* Time display */}
        <span className="font-mono text-[10px] text-neutral-500 select-none">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div className="flex-1" />

        {/* Speed buttons */}
        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSpeedChange(s)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                speed === s
                  ? 'bg-codefire-orange/20 text-codefire-orange'
                  : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {s === 1 ? '1' : s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

import { useState, useRef, useCallback, useEffect } from 'react'

export type RecordingMode = 'mic' | 'system' | 'both'

export interface AudioDevice {
  deviceId: string
  label: string
}

interface UseRecorderReturn {
  isRecording: boolean
  duration: number
  audioLevel: number
  devices: AudioDevice[]
  selectedDeviceId: string
  setSelectedDeviceId: (id: string) => void
  refreshDevices: () => Promise<void>
  startRecording: (mode?: RecordingMode) => Promise<void>
  stopRecording: () => Promise<Blob | null>
}

/**
 * Mix multiple audio streams into one using Web Audio API.
 * Returns { stream, cleanup } where cleanup stops all source tracks.
 */
function mixAudioStreams(streams: MediaStream[]): { stream: MediaStream; cleanup: () => void } {
  const audioCtx = new AudioContext()
  const destination = audioCtx.createMediaStreamDestination()

  for (const s of streams) {
    const source = audioCtx.createMediaStreamSource(s)
    source.connect(destination)
  }

  const cleanup = () => {
    for (const s of streams) {
      s.getTracks().forEach((t) => t.stop())
    }
    audioCtx.close()
  }

  return { stream: destination.stream, cleanup }
}

export function useRecorder(): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const cleanupRef = useRef<(() => void) | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const levelFrameRef = useRef<number>(0)

  const refreshDevices = useCallback(async () => {
    try {
      // Request permission first so labels are populated
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      tempStream.getTracks().forEach((t) => t.stop())

      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = allDevices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
        }))
      setDevices(audioInputs)
    } catch {
      // Permission denied or no devices
      setDevices([])
    }
  }, [])

  // Load devices on mount
  useEffect(() => {
    refreshDevices()
  }, [refreshDevices])

  // Audio level monitoring loop
  const updateAudioLevel = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) {
      setAudioLevel(0)
      return
    }

    const data = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(data)

    // Calculate RMS level
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const val = (data[i] - 128) / 128
      sum += val * val
    }
    const rms = Math.sqrt(sum / data.length)
    // Normalize to 0-1 range with some amplification
    const level = Math.min(1, rms * 3)
    setAudioLevel(level)

    levelFrameRef.current = requestAnimationFrame(updateAudioLevel)
  }, [])

  const startRecording = useCallback(async (mode: RecordingMode = 'mic') => {
    let stream: MediaStream

    const micConstraints: MediaStreamConstraints = {
      audio: selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId } }
        : true,
    }

    if (mode === 'mic') {
      stream = await navigator.mediaDevices.getUserMedia(micConstraints)
    } else if (mode === 'system') {
      // getDisplayMedia with audio captures system audio (WASAPI loopback on Windows)
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 1, height: 1, frameRate: 1 }, // minimal video (required by API)
      })
      // Drop the video track — we only want audio
      displayStream.getVideoTracks().forEach((t) => t.stop())
      const audioTracks = displayStream.getAudioTracks()
      if (audioTracks.length === 0) {
        throw new Error('No system audio track available. Make sure you selected "Share audio" in the dialog.')
      }
      stream = new MediaStream(audioTracks)
      cleanupRef.current = () => audioTracks.forEach((t) => t.stop())
    } else {
      // Both: mix mic + system audio
      const micStream = await navigator.mediaDevices.getUserMedia(micConstraints)
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 1, height: 1, frameRate: 1 },
      })
      displayStream.getVideoTracks().forEach((t) => t.stop())
      const systemAudioTracks = displayStream.getAudioTracks()
      if (systemAudioTracks.length === 0) {
        // Fall back to mic-only if no system audio
        stream = micStream
        cleanupRef.current = () => micStream.getTracks().forEach((t) => t.stop())
      } else {
        const systemStream = new MediaStream(systemAudioTracks)
        const mixed = mixAudioStreams([micStream, systemStream])
        stream = mixed.stream
        cleanupRef.current = mixed.cleanup
      }
    }

    // Set up audio level analyser
    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser
    audioCtxRef.current = audioCtx

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
    })

    chunksRef.current = []
    mediaRecorderRef.current = mediaRecorder

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    mediaRecorder.start(1000)
    startTimeRef.current = Date.now()
    setIsRecording(true)
    setDuration(0)

    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 500)

    // Start level monitoring
    levelFrameRef.current = requestAnimationFrame(updateAudioLevel)
  }, [selectedDeviceId, updateAudioLevel])

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    // Stop level monitoring
    cancelAnimationFrame(levelFrameRef.current)
    setAudioLevel(0)

    // Clean up analyser
    analyserRef.current = null
    if (audioCtxRef.current) {
      audioCtxRef.current.close()
      audioCtxRef.current = null
    }

    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        resolve(null)
        return
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        mediaRecorder.stream.getTracks().forEach((t) => t.stop())
        cleanupRef.current?.()
        cleanupRef.current = null
        if (timerRef.current) clearInterval(timerRef.current)
        setIsRecording(false)
        resolve(blob)
      }

      mediaRecorder.stop()
    })
  }, [])

  return {
    isRecording,
    duration,
    audioLevel,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    refreshDevices,
    startRecording,
    stopRecording,
  }
}

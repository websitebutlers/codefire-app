import { useState, useEffect } from 'react'
import { api } from '@renderer/lib/api'
import type { Recording } from '@shared/models'
import RecordingBar from '@renderer/components/Recordings/RecordingBar'
import RecordingsList from '@renderer/components/Recordings/RecordingsList'
import RecordingDetail from '@renderer/components/Recordings/RecordingDetail'

interface RecordingsViewProps {
  projectId: string
}

export default function RecordingsView({ projectId }: RecordingsViewProps) {
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [selected, setSelected] = useState<Recording | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)

  useEffect(() => {
    api.recordings.list(projectId).then((recs) => {
      setRecordings(recs)
      if (recs.length > 0) setSelected(recs[0])
    })
  }, [projectId])

  // Check for OpenRouter key on mount and periodically when window regains focus
  useEffect(() => {
    async function checkKey() {
      const config = await window.api.invoke('settings:get') as { openRouterKey?: string } | undefined
      setHasApiKey(!!config?.openRouterKey)
    }
    checkKey()
    window.addEventListener('focus', checkKey)
    return () => window.removeEventListener('focus', checkKey)
  }, [])

  async function autoTranscribeIfEnabled(id: string) {
    const config = await window.api.invoke('settings:get') as { autoTranscribe?: boolean; openRouterKey?: string } | undefined
    if (!config?.autoTranscribe || !config?.openRouterKey) return
    handleTranscribe(id)
  }

  async function handleRecordingComplete(blob: Blob, title: string) {
    const recording = await api.recordings.create({ projectId, title })
    const arrayBuffer = await blob.arrayBuffer()
    await api.recordings.saveAudio(recording.id, arrayBuffer)
    const updated = await api.recordings.update(recording.id, {
      status: 'recorded',
    })
    if (updated) {
      setRecordings((prev) => [updated, ...prev])
      setSelected(updated)
      autoTranscribeIfEnabled(updated.id)
    }
  }

  async function handleImportFile() {
    try {
      const recording = await api.recordings.importFile(projectId)
      if (recording) {
        const updated = await api.recordings.update(recording.id, { status: 'recorded' })
        if (updated) {
          setRecordings((prev) => [updated, ...prev])
          setSelected(updated)
          autoTranscribeIfEnabled(updated.id)
        }
      }
    } catch (err) {
      console.error('Failed to import audio file:', err)
    }
  }

  async function handleTranscribe(id: string) {
    setIsTranscribing(true)
    try {
      const updated = await api.recordings.transcribe(id)
      if (updated) {
        setRecordings((prev) =>
          prev.map((r) => (r.id === id ? updated : r))
        )
        setSelected(updated)
      }
    } catch (err) {
      console.error('Transcription failed:', err)
      const refreshed = await api.recordings.get(id)
      if (refreshed) {
        setRecordings((prev) =>
          prev.map((r) => (r.id === id ? refreshed : r))
        )
        setSelected(refreshed)
      }
    }
    setIsTranscribing(false)
  }

  function handleDelete(id: string) {
    api.recordings.delete(id).then((ok) => {
      if (ok) {
        setRecordings((prev) => prev.filter((r) => r.id !== id))
        if (selected?.id === id) {
          setSelected(recordings.find((r) => r.id !== id) ?? null)
        }
      }
    })
  }

  return (
    <div className="flex flex-col h-full">
      <RecordingBar onRecordingComplete={handleRecordingComplete} onImportFile={handleImportFile} />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 border-r border-neutral-800 flex flex-col shrink-0">
          <RecordingsList
            recordings={recordings}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            onDelete={handleDelete}
          />
        </div>
        <div className="flex-1">
          <RecordingDetail
            recording={selected}
            onTranscribe={handleTranscribe}
            isTranscribing={isTranscribing}
            projectId={projectId}
            hasApiKey={hasApiKey}
          />
        </div>
      </div>
    </div>
  )
}

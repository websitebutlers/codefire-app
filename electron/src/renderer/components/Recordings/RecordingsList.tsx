import { Mic, Trash2, Loader2, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import type { Recording } from '@shared/models'

interface RecordingsListProps {
  recordings: Recording[]
  selectedId: string | null
  onSelect: (recording: Recording) => void
  onDelete: (id: string) => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'recording':
      return <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
    case 'transcribing':
      return <Loader2 size={12} className="text-codefire-orange animate-spin" />
    case 'done':
      return <CheckCircle size={12} className="text-green-500" />
    case 'error':
      return <AlertCircle size={12} className="text-red-400" />
    default:
      return <Clock size={12} className="text-neutral-500" />
  }
}

export default function RecordingsList({
  recordings,
  selectedId,
  onSelect,
  onDelete,
}: RecordingsListProps) {
  if (recordings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
        <Mic size={24} />
        <p className="text-xs">No recordings</p>
        <p className="text-[10px] text-neutral-600">
          Use the recorder above to get started
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {recordings.map((rec) => (
        <button
          key={rec.id}
          type="button"
          onClick={() => onSelect(rec)}
          className={`w-full text-left px-3 py-2.5 border-b border-neutral-800/50 hover:bg-neutral-800/60 transition-colors group ${
            selectedId === rec.id ? 'bg-neutral-800/80' : ''
          }`}
        >
          <div className="flex items-center gap-2">
            <StatusIcon status={rec.status} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-neutral-300 truncate">{rec.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-neutral-600">
                  {formatDuration(rec.duration)}
                </span>
                <span className="text-[10px] text-neutral-600">
                  {new Date(rec.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(rec.id)
              }}
              className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition-all p-1"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </button>
      ))}
    </div>
  )
}

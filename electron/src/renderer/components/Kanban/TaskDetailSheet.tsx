import { useState } from 'react'
import { X, Calendar, Tag, MessageSquare, Send } from 'lucide-react'
import type { TaskItem } from '@shared/models'
import { useTaskNotes } from '@renderer/hooks/useTasks'

interface TaskDetailSheetProps {
  task: TaskItem | null
  onClose: () => void
  onUpdate: (
    id: number,
    data: {
      title?: string
      description?: string
      status?: string
      priority?: number
      labels?: string[]
    }
  ) => Promise<void>
  onDelete: (id: number) => Promise<void>
}

const PRIORITY_OPTIONS = [
  { value: 0, label: 'None', color: '' },
  { value: 1, label: 'Low', color: 'text-blue-400' },
  { value: 2, label: 'Medium', color: 'text-yellow-400' },
  { value: 3, label: 'High', color: 'text-orange-400' },
  { value: 4, label: 'Urgent', color: 'text-red-400' },
]

function parseLabels(labels: string | null): string[] {
  if (!labels) return []
  try {
    return JSON.parse(labels)
  } catch {
    return []
  }
}

export default function TaskDetailSheet({
  task,
  onClose,
  onUpdate,
  onDelete,
}: TaskDetailSheetProps) {
  const { notes, addNote } = useTaskNotes(task?.id ?? null)
  const [noteInput, setNoteInput] = useState('')
  const [sending, setSending] = useState(false)

  if (!task) return null

  const labels = parseLabels(task.labels)

  const handleAddNote = async () => {
    const content = noteInput.trim()
    if (!content || sending) return
    setSending(true)
    try {
      await addNote(content)
      setNoteInput('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="w-80 border-l border-neutral-800 bg-neutral-900 flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-800 shrink-0">
        <h3 className="text-sm text-neutral-200 font-medium truncate flex-1">Task Details</h3>
        <button
          className="text-neutral-500 hover:text-neutral-300 transition-colors"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Title */}
        <div>
          <label className="text-xs text-neutral-500 block mb-1">Title</label>
          <div className="text-sm text-neutral-200">{task.title}</div>
        </div>

        {/* Status */}
        <div>
          <label className="text-xs text-neutral-500 block mb-1">Status</label>
          <select
            className="w-full bg-neutral-800 border border-neutral-700 rounded-cf px-2 py-1.5
                       text-sm text-neutral-200 focus:outline-none focus:border-codefire-orange/50"
            value={task.status}
            onChange={(e) => onUpdate(task.id, { status: e.target.value })}
          >
            <option value="todo">Todo</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
        </div>

        {/* Priority */}
        <div>
          <label className="text-xs text-neutral-500 block mb-1">Priority</label>
          <select
            className="w-full bg-neutral-800 border border-neutral-700 rounded-cf px-2 py-1.5
                       text-sm text-neutral-200 focus:outline-none focus:border-codefire-orange/50"
            value={task.priority}
            onChange={(e) => onUpdate(task.id, { priority: Number(e.target.value) })}
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Labels */}
        {labels.length > 0 && (
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Labels</label>
            <div className="flex flex-wrap gap-1">
              {labels.map((label) => (
                <span
                  key={label}
                  className="text-xs px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 border border-neutral-600/50"
                >
                  <Tag size={10} className="inline mr-1" />
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        {task.description && (
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Description</label>
            <div className="text-sm text-neutral-400 leading-relaxed whitespace-pre-wrap">
              {task.description}
            </div>
          </div>
        )}

        {/* Created date */}
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <Calendar size={12} />
          <span>
            Created{' '}
            {new Date(task.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        </div>

        {/* Notes */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <MessageSquare size={14} className="text-neutral-500" />
            <label className="text-xs text-neutral-500">Notes ({notes.length})</label>
          </div>

          <div className="space-y-2 mb-3">
            {notes.map((note) => (
              <div
                key={note.id}
                className="bg-neutral-800/50 rounded-cf p-2 border border-neutral-700/30"
              >
                <p className="text-xs text-neutral-300 whitespace-pre-wrap">{note.content}</p>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs text-neutral-600">{note.source}</span>
                  <span className="text-xs text-neutral-600">
                    {new Date(note.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Add note input */}
          <div className="flex gap-1.5">
            <input
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded-cf px-2 py-1.5
                         text-xs text-neutral-200 placeholder-neutral-500
                         focus:outline-none focus:border-codefire-orange/50"
              placeholder="Add a note..."
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddNote()
              }}
              disabled={sending}
            />
            <button
              className="px-2 py-1.5 bg-codefire-orange/20 text-codefire-orange rounded-cf
                         hover:bg-codefire-orange/30 transition-colors disabled:opacity-50"
              onClick={handleAddNote}
              disabled={!noteInput.trim() || sending}
            >
              <Send size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-neutral-800 shrink-0">
        <button
          className="w-full text-xs text-red-400 hover:text-red-300 transition-colors py-1"
          onClick={() => {
            if (confirm('Delete this task?')) {
              onDelete(task.id)
              onClose()
            }
          }}
        >
          Delete Task
        </button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import {
  X, Circle, ArrowUp, ArrowUpRight, Flame, AlertTriangle, Tag,
} from 'lucide-react'

interface TaskCreateModalProps {
  open: boolean
  onClose: () => void
  onCreate: (data: {
    title: string
    description?: string
    status: string
    priority: number
    labels: string[]
  }) => void
  /** Which column's "+" was clicked — used as default status */
  defaultStatus?: string
}

const PRIORITY_OPTIONS = [
  { value: 0, label: 'None', color: 'text-neutral-500', bg: 'bg-neutral-700', icon: Circle },
  { value: 1, label: 'Low', color: 'text-neutral-400', bg: 'bg-neutral-500/20', icon: ArrowUp },
  { value: 2, label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/20', icon: ArrowUpRight },
  { value: 3, label: 'High', color: 'text-orange-400', bg: 'bg-orange-500/20', icon: Flame },
  { value: 4, label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/20', icon: AlertTriangle },
]

export default function TaskCreateModal({ open, onClose, onCreate, defaultStatus = 'todo' }: TaskCreateModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState(defaultStatus)
  const [priority, setPriority] = useState(0)
  const [labels, setLabels] = useState<string[]>([])
  const [labelInput, setLabelInput] = useState('')

  if (!open) return null

  const handleSubmit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    onCreate({
      title: trimmed,
      description: description.trim() || undefined,
      status,
      priority,
      labels,
    })
    // Reset form
    setTitle('')
    setDescription('')
    setStatus(defaultStatus)
    setPriority(0)
    setLabels([])
    setLabelInput('')
    onClose()
  }

  const handleAddLabel = () => {
    const trimmed = labelInput.trim()
    if (!trimmed || labels.includes(trimmed)) return
    setLabels([...labels, trimmed])
    setLabelInput('')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[480px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800 shrink-0">
          <h2 className="text-sm font-semibold text-neutral-200">New Task</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Title</label>
            <input
              autoFocus
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5
                         text-sm text-neutral-200 placeholder-neutral-500
                         focus:outline-none focus:border-codefire-orange/50"
              placeholder="Task title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Description</label>
            <textarea
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5
                         text-sm text-neutral-200 placeholder-neutral-500 leading-relaxed
                         focus:outline-none focus:border-codefire-orange/50 resize-y min-h-[60px]"
              placeholder="Add a description..."
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Status */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Status</label>
            <div className="flex gap-1">
              {(['todo', 'in_progress', 'done'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`flex-1 text-xs py-1.5 rounded border transition-colors ${
                    status === s
                      ? s === 'done'
                        ? 'bg-green-500/20 border-green-500/40 text-green-400'
                        : s === 'in_progress'
                        ? 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                        : 'bg-neutral-700 border-neutral-600 text-neutral-300'
                      : 'bg-neutral-800/50 border-neutral-700/50 text-neutral-500 hover:text-neutral-400'
                  }`}
                >
                  {s === 'todo' ? 'Todo' : s === 'in_progress' ? 'In Progress' : 'Done'}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Priority</label>
            <div className="flex gap-1">
              {PRIORITY_OPTIONS.map((opt) => {
                const Icon = opt.icon
                const isActive = priority === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPriority(opt.value)}
                    className={`flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded border transition-colors ${
                      isActive
                        ? `${opt.bg} border-current ${opt.color}`
                        : 'bg-neutral-800/50 border-neutral-700/50 text-neutral-500 hover:text-neutral-400'
                    }`}
                    title={opt.label}
                  >
                    <Icon size={12} />
                    <span className="hidden sm:inline">{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Labels */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">
              <Tag size={10} className="inline mr-1" />
              Labels
            </label>
            {labels.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {labels.map((label) => (
                  <span
                    key={label}
                    className="text-xs px-2 py-0.5 rounded-full border bg-neutral-700/80 text-neutral-300 border-neutral-600/50 flex items-center gap-1"
                  >
                    {label}
                    <button
                      onClick={() => setLabels(labels.filter((l) => l !== label))}
                      className="text-neutral-500 hover:text-neutral-300 leading-none ml-0.5"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1
                         text-xs text-neutral-200 placeholder-neutral-500
                         focus:outline-none focus:border-codefire-orange/50"
              placeholder="Add label and press Enter..."
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  handleAddLabel()
                }
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-800 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs text-neutral-400 hover:text-neutral-200
                       hover:bg-neutral-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="px-4 py-1.5 rounded text-xs bg-codefire-orange/20 text-codefire-orange
                       hover:bg-codefire-orange/30 transition-colors font-medium
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create Task
          </button>
        </div>
      </div>
    </div>
  )
}

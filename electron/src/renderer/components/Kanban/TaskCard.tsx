import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { MessageSquare, GripVertical } from 'lucide-react'
import type { TaskItem } from '@shared/models'

interface TaskCardProps {
  task: TaskItem
  onClick: () => void
  noteCount?: number
}

const PRIORITY_COLORS: Record<number, string> = {
  0: '',
  1: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  2: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  3: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  4: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const PRIORITY_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Med',
  3: 'High',
  4: 'Urgent',
}

function parseLabels(labels: string | null): string[] {
  if (!labels) return []
  try {
    return JSON.parse(labels)
  } catch {
    return []
  }
}

export default function TaskCard({ task, onClick, noteCount = 0 }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: String(task.id) })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const labels = parseLabels(task.labels)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-neutral-800 border border-neutral-700/50 rounded-cf p-2.5
        hover:border-neutral-600 transition-colors cursor-pointer group
        ${isDragging ? 'shadow-lg ring-1 ring-codefire-orange/30' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-1.5">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 text-neutral-600 hover:text-neutral-400 cursor-grab active:cursor-grabbing shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="text-sm text-neutral-200 leading-snug">{task.title}</div>

          {/* Priority + Labels row */}
          <div className="flex items-center flex-wrap gap-1 mt-1.5">
            {task.priority > 0 && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[task.priority] || ''}`}
              >
                {PRIORITY_LABELS[task.priority] || `P${task.priority}`}
              </span>
            )}
            {labels.map((label) => (
              <span
                key={label}
                className="text-xs px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 border border-neutral-600/50"
              >
                {label}
              </span>
            ))}
          </div>

          {/* Note count */}
          {noteCount > 0 && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-neutral-500">
              <MessageSquare size={10} />
              <span>{noteCount}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

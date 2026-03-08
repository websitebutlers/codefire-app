import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { MessageSquare, GripVertical, Bot, User, Mail, Cpu, FolderOpen } from 'lucide-react'
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

const SOURCE_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  claude: { label: 'CLAUDE', color: 'text-orange-300', bg: 'bg-orange-500/20' },
  'ai-extracted': { label: 'AI', color: 'text-purple-300', bg: 'bg-purple-500/20' },
  manual: { label: 'MANUAL', color: 'text-neutral-400', bg: 'bg-neutral-700' },
  email: { label: 'EMAIL', color: 'text-blue-300', bg: 'bg-blue-500/20' },
  mcp: { label: 'MCP', color: 'text-green-300', bg: 'bg-green-500/20' },
  browser: { label: 'BROWSER', color: 'text-cyan-300', bg: 'bg-cyan-500/20' },
  chat: { label: 'CHAT', color: 'text-pink-300', bg: 'bg-pink-500/20' },
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
          <div className="text-sm text-neutral-200 leading-snug line-clamp-2">{task.title}</div>

          {/* Description snippet */}
          {task.description && (
            <div className="text-xs text-neutral-500 mt-1 line-clamp-2 leading-relaxed">
              {task.description}
            </div>
          )}

          {/* Priority + Labels + Source row */}
          <div className="flex items-center flex-wrap gap-1 mt-1.5">
            {task.priority > 0 && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[task.priority] || ''}`}
              >
                {PRIORITY_LABELS[task.priority] || `P${task.priority}`}
              </span>
            )}
            {(() => {
              const badge = SOURCE_BADGES[task.source ?? 'manual']
              return badge && task.source !== 'manual' ? (
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${badge.bg} ${badge.color}`}>
                  {badge.label}
                </span>
              ) : null
            })()}
            {labels.slice(0, 3).map((label) => (
              <span
                key={label}
                className="text-xs px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 border border-neutral-600/50"
              >
                {label}
              </span>
            ))}
            {labels.length > 3 && (
              <span className="text-[10px] text-neutral-500">+{labels.length - 3}</span>
            )}
          </div>

          {/* Footer: note count + date */}
          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-neutral-500">
            {noteCount > 0 && (
              <div className="flex items-center gap-1">
                <MessageSquare size={10} />
                <span>{noteCount}</span>
              </div>
            )}
            <span>
              {new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

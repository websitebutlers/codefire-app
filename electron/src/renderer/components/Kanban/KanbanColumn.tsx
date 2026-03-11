import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, Expand, Circle, CircleDot, CheckCircle2 } from 'lucide-react'
import type { TaskItem } from '@shared/models'
import TaskCard from './TaskCard'
import logoIcon from '../../../../resources/icon.png'

const COLUMN_ICONS = {
  'circle': Circle,
  'circle-dot': CircleDot,
  'check-circle': CheckCircle2,
} as const

// Static maps so Tailwind JIT can detect every class name at build time
const DROP_BORDER: Record<string, string> = {
  'text-orange-400': 'border-orange-500/50',
  'text-blue-400': 'border-blue-500/50',
  'text-green-400': 'border-green-500/50',
}

const ACCENT_BAR: Record<string, string> = {
  'text-orange-400': 'bg-orange-400',
  'text-blue-400': 'bg-blue-400',
  'text-green-400': 'bg-green-400',
}

const DROP_EMPTY: Record<string, { text: string; bg: string; border: string }> = {
  'text-orange-400': { text: 'text-orange-500/70', bg: 'bg-orange-500/5', border: 'border-orange-500/30' },
  'text-blue-400': { text: 'text-blue-500/70', bg: 'bg-blue-500/5', border: 'border-blue-500/30' },
  'text-green-400': { text: 'text-green-500/70', bg: 'bg-green-500/5', border: 'border-green-500/30' },
}

interface KanbanColumnProps {
  id: string
  title: string
  tasks: TaskItem[]
  color: string
  icon?: keyof typeof COLUMN_ICONS
  isDropTarget?: boolean
  onTaskClick: (task: TaskItem) => void
  onAddTask: (title: string) => void
  onOpenCreateModal?: () => void
  onMoveTask?: (taskId: number, newStatus: string) => void
  onLaunchSession?: (task: TaskItem) => void
  onDeleteTask?: (taskId: number) => void
  projectNames?: Record<string, string>
}

export default function KanbanColumn({
  id,
  title,
  tasks,
  color,
  icon,
  isDropTarget,
  onTaskClick,
  onAddTask,
  onOpenCreateModal,
  onMoveTask,
  onLaunchSession,
  onDeleteTask,
  projectNames,
}: KanbanColumnProps) {
  const [newTitle, setNewTitle] = useState('')
  const [showInput, setShowInput] = useState(false)

  const { setNodeRef, isOver } = useDroppable({ id })

  const highlighted = isDropTarget || isOver

  const handleAdd = () => {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    onAddTask(trimmed)
    setNewTitle('')
    setShowInput(false)
  }

  return (
    <div
      className={`flex flex-col bg-[#111111] rounded-cf border transition-colors min-h-0 relative overflow-hidden
        ${highlighted ? `${DROP_BORDER[color] || 'border-neutral-500'} bg-neutral-800/30` : 'border-neutral-800'}`}
    >
      {/* Faint background logo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.015] select-none"
        style={{
          backgroundImage: `url(${logoIcon})`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          backgroundSize: 'auto 100%',
        }}
      />
      {/* Column header */}
      <div className="shrink-0">
        <div className="flex items-center gap-2 px-3 h-9">
          {(() => {
            const IconComponent = icon ? COLUMN_ICONS[icon] : null
            return IconComponent
              ? <IconComponent size={12} className={color} />
              : <div className={`w-2 h-2 rounded-full ${color}`} />
          })()}
          <span className="text-sm text-neutral-300 font-medium">{title}</span>
          <span className="text-xs text-neutral-500 ml-auto">{tasks.length}</span>
          {onOpenCreateModal && (
            <button
              className="text-neutral-500 hover:text-codefire-orange transition-colors"
              onClick={onOpenCreateModal}
              title="New task (full form)"
            >
              <Expand size={12} />
            </button>
          )}
          <button
            className="text-neutral-500 hover:text-codefire-orange transition-colors"
            onClick={() => setShowInput(true)}
            title="Quick add"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className={`h-0.5 mx-3 rounded-full ${ACCENT_BAR[color] || 'bg-neutral-600'}`} />
      </div>

      {/* Quick add input */}
      {showInput && (
        <div className="px-2 py-2 border-b border-neutral-800 shrink-0">
          <input
            autoFocus
            className="w-full bg-neutral-800 border border-neutral-700 rounded-cf px-2 py-1.5
                       text-sm text-neutral-200 placeholder-neutral-500
                       focus:outline-none focus:border-codefire-orange/50"
            placeholder="Task title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') {
                setNewTitle('')
                setShowInput(false)
              }
            }}
            onBlur={() => {
              if (!newTitle.trim()) setShowInput(false)
            }}
          />
        </div>
      )}

      {/* Task list */}
      <div ref={setNodeRef} className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[60px]">
        <SortableContext
          items={tasks.map((t) => String(t.id))}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task)}
              onMoveTask={onMoveTask}
              onLaunchSession={onLaunchSession}
              onDeleteTask={onDeleteTask}
              projectName={projectNames?.[task.projectId]}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && !showInput && (
          <div className={`text-xs text-center py-4 rounded-cf transition-colors
            ${highlighted ? `${DROP_EMPTY[color]?.text || 'text-neutral-400'} ${DROP_EMPTY[color]?.bg || 'bg-neutral-800/5'} border border-dashed ${DROP_EMPTY[color]?.border || 'border-neutral-500/30'}` : 'text-neutral-600'}`}>
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  )
}

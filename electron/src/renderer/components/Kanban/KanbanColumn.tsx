import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, Circle, CircleDot, CheckCircle2 } from 'lucide-react'
import type { TaskItem } from '@shared/models'
import TaskCard from './TaskCard'

const COLUMN_ICONS = {
  'circle': Circle,
  'circle-dot': CircleDot,
  'check-circle': CheckCircle2,
} as const

interface KanbanColumnProps {
  id: string
  title: string
  tasks: TaskItem[]
  color: string
  icon?: keyof typeof COLUMN_ICONS
  onTaskClick: (task: TaskItem) => void
  onAddTask: (title: string) => void
  projectNames?: Record<string, string>
}

export default function KanbanColumn({
  id,
  title,
  tasks,
  color,
  icon,
  onTaskClick,
  onAddTask,
  projectNames,
}: KanbanColumnProps) {
  const [newTitle, setNewTitle] = useState('')
  const [showInput, setShowInput] = useState(false)

  const { setNodeRef, isOver } = useDroppable({ id })

  const handleAdd = () => {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    onAddTask(trimmed)
    setNewTitle('')
    setShowInput(false)
  }

  return (
    <div
      className={`flex flex-col bg-neutral-900 rounded-cf border transition-colors min-h-0
        ${isOver ? 'border-codefire-orange/50 bg-neutral-800/30' : 'border-neutral-800'}`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-neutral-800 shrink-0">
        {(() => {
          const IconComponent = icon ? COLUMN_ICONS[icon] : null
          return IconComponent
            ? <IconComponent size={12} className={color} />
            : <div className={`w-2 h-2 rounded-full ${color}`} />
        })()}
        <span className="text-sm text-neutral-300 font-medium">{title}</span>
        <span className="text-xs text-neutral-500 ml-auto">{tasks.length}</span>
        <button
          className="text-neutral-500 hover:text-codefire-orange transition-colors"
          onClick={() => setShowInput(true)}
        >
          <Plus size={14} />
        </button>
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
              projectName={projectNames?.[task.projectId]}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && !showInput && (
          <div className="text-xs text-neutral-600 text-center py-4">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  )
}

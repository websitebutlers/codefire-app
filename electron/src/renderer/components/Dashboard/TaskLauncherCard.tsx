import { useState } from 'react'
import { CheckSquare, Plus } from 'lucide-react'

interface TaskLauncherCardProps {
  todoCount: number
  inProgressCount: number
  doneCount: number
  onAddTask: (title: string) => Promise<void>
  onNavigateToTasks: () => void
}

export default function TaskLauncherCard({
  todoCount,
  inProgressCount,
  doneCount,
  onAddTask,
  onNavigateToTasks,
}: TaskLauncherCardProps) {
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)

  const handleAdd = async () => {
    const title = newTitle.trim()
    if (!title || adding) return
    setAdding(true)
    try {
      await onAddTask(title)
      setNewTitle('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="bg-neutral-800/50 rounded-cf border border-neutral-700/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckSquare size={16} className="text-info" />
        <h3 className="text-title text-neutral-200 font-medium">Tasks</h3>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <StatPill label="Todo" count={todoCount} color="text-neutral-400" />
        <StatPill label="In Progress" count={inProgressCount} color="text-codefire-orange" />
        <StatPill label="Done" count={doneCount} color="text-success" />
      </div>

      {/* Quick add */}
      <div className="flex gap-2 mb-3">
        <input
          className="flex-1 bg-neutral-700/50 border border-neutral-600/50 rounded-cf px-2 py-1.5
                     text-sm text-neutral-200 placeholder-neutral-500
                     focus:outline-none focus:border-codefire-orange/50"
          placeholder="Quick add task..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
          disabled={adding}
        />
        <button
          className="px-2 py-1.5 bg-codefire-orange/20 text-codefire-orange rounded-cf
                     hover:bg-codefire-orange/30 transition-colors disabled:opacity-50"
          onClick={handleAdd}
          disabled={!newTitle.trim() || adding}
        >
          <Plus size={14} />
        </button>
      </div>

      <button
        className="w-full text-sm text-neutral-400 hover:text-codefire-orange transition-colors text-center py-1"
        onClick={onNavigateToTasks}
      >
        View Kanban Board &rarr;
      </button>
    </div>
  )
}

function StatPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="bg-neutral-700/30 rounded-cf p-2 text-center">
      <div className={`text-base font-semibold ${color}`}>{count}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
    </div>
  )
}

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTasks } from '@renderer/hooks/useTasks'
import KanbanBoard from '@renderer/components/Kanban/KanbanBoard'
import { SortControls, sortTasks, type SortOption } from '@renderer/components/Kanban/SortControls'

interface TasksViewProps {
  projectId: string
}

export default function TasksView({ projectId }: TasksViewProps) {
  const [sort, setSort] = useState<SortOption>({ field: 'recent', dir: 'desc' })
  const {
    todoTasks,
    inProgressTasks,
    doneTasks,
    loading,
    error,
    createTask,
    updateTask,
    deleteTask,
  } = useTasks(projectId)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-error">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-3">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h2 className="text-title text-neutral-200 font-medium">Tasks</h2>
        <div className="flex items-center gap-3">
          <SortControls sort={sort} onChange={setSort} />
          <span className="text-xs text-neutral-500">
            {todoTasks.length + inProgressTasks.length + doneTasks.length} total
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <KanbanBoard
          todoTasks={sortTasks(todoTasks, sort)}
          inProgressTasks={sortTasks(inProgressTasks, sort)}
          doneTasks={sortTasks(doneTasks, sort)}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onAddTask={createTask}
        />
      </div>
    </div>
  )
}

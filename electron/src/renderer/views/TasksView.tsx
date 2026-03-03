import { Loader2 } from 'lucide-react'
import { useTasks } from '@renderer/hooks/useTasks'
import KanbanBoard from '@renderer/components/Kanban/KanbanBoard'

interface TasksViewProps {
  projectId: string
}

export default function TasksView({ projectId }: TasksViewProps) {
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
        <span className="text-xs text-neutral-500">
          {todoTasks.length + inProgressTasks.length + doneTasks.length} total
        </span>
      </div>

      <div className="flex-1 min-h-0">
        <KanbanBoard
          todoTasks={todoTasks}
          inProgressTasks={inProgressTasks}
          doneTasks={doneTasks}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onAddTask={createTask}
        />
      </div>
    </div>
  )
}

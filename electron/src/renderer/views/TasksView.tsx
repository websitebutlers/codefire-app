import { useState } from 'react'
import { Loader2, ListTodo } from 'lucide-react'
import { useTasks } from '@renderer/hooks/useTasks'
import KanbanBoard from '@renderer/components/Kanban/KanbanBoard'
import { SortControls, sortTasks, type SortOption } from '@renderer/components/Kanban/SortControls'

interface TasksViewProps {
  projectId: string
  projectPath?: string
}

export default function TasksView({ projectId, projectPath }: TasksViewProps) {
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
    <div className="flex flex-col h-full bg-neutral-900">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-800 bg-neutral-950 shrink-0">
        <ListTodo size={16} className="text-codefire-orange" />
        <h2 className="text-sm font-semibold text-neutral-200">Tasks</h2>
        <span className="text-xs text-neutral-500">
          {todoTasks.length + inProgressTasks.length + doneTasks.length} total
        </span>
        <div className="flex-1" />
        <SortControls sort={sort} onChange={setSort} />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <KanbanBoard
          todoTasks={sortTasks(todoTasks, sort)}
          inProgressTasks={sortTasks(inProgressTasks, sort)}
          doneTasks={sortTasks(doneTasks, sort)}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onAddTask={createTask}
          projectPath={projectPath}
          projectId={projectId}
        />
      </div>
    </div>
  )
}

import { Loader2 } from 'lucide-react'
import { useSessions } from '@renderer/hooks/useSessions'
import { useTasks } from '@renderer/hooks/useTasks'
import CostSummaryCard from '@renderer/components/Dashboard/CostSummaryCard'
import LiveSessionCard from '@renderer/components/Dashboard/LiveSessionCard'
import TaskLauncherCard from '@renderer/components/Dashboard/TaskLauncherCard'

interface DashboardViewProps {
  projectId: string
  onTabChange?: (tab: string) => void
}

export default function DashboardView({ projectId, onTabChange }: DashboardViewProps) {
  const { sessions, recentSessions, loading: sessionsLoading, error: sessionsError } = useSessions(projectId)
  const {
    todoTasks,
    inProgressTasks,
    doneTasks,
    loading: tasksLoading,
    error: tasksError,
    createTask,
  } = useTasks(projectId)

  const loading = sessionsLoading || tasksLoading
  const error = sessionsError || tasksError

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
    <div className="p-4 overflow-y-auto h-full">
      <h2 className="text-title text-neutral-200 font-medium mb-4">Dashboard</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CostSummaryCard sessions={sessions} />

        <LiveSessionCard sessions={recentSessions} />

        <TaskLauncherCard
          todoCount={todoTasks.length}
          inProgressCount={inProgressTasks.length}
          doneCount={doneTasks.length}
          onAddTask={async (title) => {
            await createTask(title)
          }}
          onNavigateToTasks={() => onTabChange?.('Tasks')}
        />
      </div>
    </div>
  )
}

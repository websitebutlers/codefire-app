import { useState } from 'react'
import { Loader2, Play, RotateCcw, FolderOpen } from 'lucide-react'
import { useSessions } from '@renderer/hooks/useSessions'
import { useTasks } from '@renderer/hooks/useTasks'
import { api } from '@renderer/lib/api'
import CostSummaryCard from '@renderer/components/Dashboard/CostSummaryCard'
import LiveSessionView from '@renderer/components/Dashboard/LiveSessionView'
import TaskLauncherCard from '@renderer/components/Dashboard/TaskLauncherCard'
import DevToolsCard from '@renderer/components/Dashboard/DevToolsCard'

interface DashboardViewProps {
  projectId: string
  projectPath?: string
  onTabChange?: (tab: string) => void
}

export default function DashboardView({ projectId, projectPath, onTabChange }: DashboardViewProps) {
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessions(projectId)
  const {
    todoTasks,
    inProgressTasks,
    doneTasks,
    loading: tasksLoading,
    error: tasksError,
  } = useTasks(projectId)
  const [launching, setLaunching] = useState<string | null>(null)

  const loading = sessionsLoading || tasksLoading
  const error = sessionsError || tasksError

  async function launchSession(type: 'new' | 'continue') {
    setLaunching(type)
    try {
      const config = (await window.api.invoke('settings:get')) as
        | { preferredCLI?: string }
        | undefined
      const cli = config?.preferredCLI ?? 'claude'
      let command: string
      if (type === 'continue' && sessions.length > 0) {
        const lastSession = sessions[0]
        command = cli === 'claude'
          ? `claude --resume ${lastSession.id}`
          : `${cli} --resume ${lastSession.id}`
      } else {
        command = cli
      }
      window.api.send('terminal:writeToActive', command + '\n')
    } catch (err) {
      console.error('Failed to launch session:', err)
    } finally {
      setTimeout(() => setLaunching(null), 500)
    }
  }

  async function handleOpenInExplorer() {
    try {
      const project = await api.projects.get(projectId)
      if (project?.path) {
        await api.shell.showInExplorer(project.path)
      }
    } catch (err) {
      console.error('Failed to open explorer:', err)
    }
  }

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

      {/* Quick action buttons */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => launchSession('new')}
          disabled={launching === 'new'}
          className="flex items-center gap-2 px-4 py-2 rounded-cf
                     bg-codefire-orange text-white text-xs font-medium
                     hover:bg-codefire-orange/90 transition-colors disabled:opacity-50"
        >
          <Play size={12} />
          {launching === 'new' ? 'Launching...' : 'New Session'}
        </button>
        <button
          onClick={() => launchSession('continue')}
          disabled={launching === 'continue' || sessions.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-cf
                     bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs font-medium
                     hover:bg-neutral-700/50 hover:text-neutral-200 transition-colors disabled:opacity-40"
        >
          <RotateCcw size={12} />
          {launching === 'continue' ? 'Resuming...' : 'Continue Last Session'}
        </button>
        <button
          onClick={handleOpenInExplorer}
          className="flex items-center gap-2 px-4 py-2 rounded-cf
                     bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs font-medium
                     hover:bg-neutral-700/50 hover:text-neutral-200 transition-colors"
        >
          <FolderOpen size={12} />
          Open in Explorer
        </button>
      </div>

      {/* Dev Tools */}
      {projectPath && <DevToolsCard projectPath={projectPath} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CostSummaryCard sessions={sessions} />

        <LiveSessionView projectId={projectId} />

        <TaskLauncherCard projectId={projectId} />
      </div>
    </div>
  )
}

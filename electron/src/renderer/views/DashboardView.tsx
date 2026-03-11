import { useState } from 'react'
import {
  Loader2, Play, RotateCcw, FolderOpen, RefreshCw,
  Clock, CircleDotDashed, ArrowRightLeft,
  GitBranch, Cpu, MessageSquare, Wrench, DollarSign,
} from 'lucide-react'
import logoIcon from '../../../resources/icon.png'
import { useSessions, calculateSessionCost } from '@renderer/hooks/useSessions'
import { useTasks } from '@renderer/hooks/useTasks'
import { api } from '@renderer/lib/api'
import type { Session } from '@shared/models'
import { getSessionDisplayName } from '@renderer/components/Sessions/sessionUtils'
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
      // Create a dedicated terminal for this session
      const path = projectPath ?? '.'
      const termId = `session-${projectId}-${Date.now()}`
      await window.api.invoke('terminal:create', termId, path)
      // Brief delay for shell initialization, then write the command
      setTimeout(() => {
        window.api.send('terminal:write', termId, command + '\n')
      }, 300)
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
    <div className="p-4 overflow-y-auto h-full relative">
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
        <button
          onClick={async () => {
            try {
              await window.api.invoke('discovery:importSessions', projectId)
            } catch {}
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-cf
                     bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs font-medium
                     hover:bg-neutral-700/50 hover:text-neutral-200 transition-colors"
        >
          <RefreshCw size={12} />
          Rescan
        </button>
      </div>

      {/* Dev Tools */}
      {projectPath && <DevToolsCard projectPath={projectPath} />}

      {/* 2x2 Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top-left: Cost Summary */}
        <CostSummaryCard sessions={sessions} />

        {/* Top-right: Live Session */}
        <LiveSessionView projectId={projectId} />

        {/* Bottom-left: Task Launcher */}
        <TaskLauncherCard projectId={projectId} />

        {/* Bottom-right: Stat Cards */}
        <div className="flex gap-3 items-start">
          <StatCard
            icon={<Clock size={16} />}
            value={sessions.length}
            label="Sessions"
            color="text-blue-400"
            bgColor="bg-blue-500/10"
          />
          <StatCard
            icon={<CircleDotDashed size={16} />}
            value={todoTasks.length}
            label="Pending"
            color="text-codefire-orange"
            bgColor="bg-codefire-orange/10"
          />
          <StatCard
            icon={<ArrowRightLeft size={16} />}
            value={inProgressTasks.length}
            label="In Progress"
            color="text-green-400"
            bgColor="bg-green-500/10"
          />
        </div>
      </div>

      {/* Recent Sessions — matching Swift DashboardView */}
      <div className="mt-4">
        <h3 className="text-[13px] font-semibold text-neutral-200 mb-3">Recent Sessions</h3>
        {sessions.length > 0 ? (
          <div className="space-y-2">
            {sessions.slice(0, 10).map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center py-10 text-neutral-600">
            <Clock size={28} className="mb-2 opacity-40" />
            <p className="text-[13px] font-medium text-neutral-500">No sessions yet</p>
            <p className="text-[11px] text-neutral-600 mt-1">
              Start a coding session to see it here
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Stat Card ──────────────────────────────────────────────── */

function StatCard({
  icon,
  value,
  label,
  color,
  bgColor,
}: {
  icon: React.ReactNode
  value: number
  label: string
  color: string
  bgColor: string
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center w-[100px] h-[85px] rounded-[10px]
        ${bgColor} border border-neutral-700/30`}
    >
      <span className={color}>{icon}</span>
      <span className="text-xl font-bold text-neutral-200 mt-1">{value}</span>
      <span className="text-[11px] font-medium text-neutral-500">{label}</span>
    </div>
  )
}

/* ── Session Card ───────────────────────────────────────────── */

function SessionCard({ session }: { session: Session }) {
  const cost = calculateSessionCost(session)

  return (
    <div className="bg-neutral-800/70 rounded-lg p-3 border border-neutral-700/30 hover:bg-neutral-800 hover:shadow-[0_2px_8px_rgba(0,0,0,0.15)] transition-all duration-150">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold text-neutral-200 truncate">
          {getSessionDisplayName(session, 50)}
        </span>
        {session.startedAt && (
          <span className="text-[11px] text-neutral-600 shrink-0 ml-2">
            {new Date(session.startedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>

      {/* Metadata pills */}
      <div className="flex items-center flex-wrap gap-1.5">
        {session.gitBranch && (
          <MetadataPill icon={<GitBranch size={9} />} text={session.gitBranch} color="text-purple-400" bg="bg-purple-500/10" />
        )}
        {session.model && (
          <MetadataPill icon={<Cpu size={9} />} text={session.model} color="text-blue-400" bg="bg-blue-500/10" />
        )}
        <MetadataPill
          icon={<MessageSquare size={9} />}
          text={`${session.messageCount} msgs`}
          color="text-neutral-400"
          bg="bg-neutral-700/50"
        />
        <MetadataPill
          icon={<Wrench size={9} />}
          text={`${session.toolUseCount} tools`}
          color="text-neutral-400"
          bg="bg-neutral-700/50"
        />
        {cost > 0 && (
          <MetadataPill
            icon={<DollarSign size={9} />}
            text={`$${cost.toFixed(2)}`}
            color={cost > 1 ? 'text-orange-400' : 'text-green-400'}
            bg={cost > 1 ? 'bg-orange-500/10' : 'bg-green-500/10'}
          />
        )}
      </div>

      {/* Summary */}
      {session.summary && (
        <p className="text-xs text-neutral-400 mt-2 line-clamp-2 leading-relaxed">
          {session.summary}
        </p>
      )}
    </div>
  )
}

/* ── Metadata Pill ──────────────────────────────────────────── */

function MetadataPill({
  icon,
  text,
  color,
  bg,
}: {
  icon: React.ReactNode
  text: string
  color: string
  bg: string
}) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${color} ${bg}`}>
      {icon}
      <span className="truncate max-w-[120px]">{text}</span>
    </span>
  )
}

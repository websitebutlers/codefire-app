import { Folder, GitBranch, Search, Globe, FileText, ListTodo, StickyNote, Image, Monitor, Database, Zap } from 'lucide-react'
import MCPIndicator from './MCPIndicator'
import IndexIndicator from './IndexIndicator'
import { useAgentMonitor } from '../../hooks/useAgentMonitor'
import type { MCPActivity } from '@shared/models'

interface AgentStatusBarProps {
  projectId: string
  projectPath?: string
  mcpStatus?: 'connected' | 'disconnected' | 'error'
  mcpSessionCount?: number
  indexStatus?: 'idle' | 'indexing' | 'ready' | 'error'
  indexTotalChunks?: number
  indexProgress?: number
  indexLastError?: string
  onMCPConnect?: () => void
  onMCPDisconnect?: () => void
  onRequestIndex?: () => void
}

/** Truncate a file path to show only the last N segments. */
function truncatePath(path: string, maxSegments = 2): string {
  const sep = path.includes('\\') ? '\\' : '/'
  const segments = path.split(/[/\\]/).filter(Boolean)
  if (segments.length <= maxSegments) return path
  return '…' + sep + segments.slice(-maxSegments).join(sep)
}

/** Format elapsed seconds into a human-readable string. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

/** Icons for MCP activity categories */
const CATEGORY_ICONS: Record<string, typeof Zap> = {
  Git: GitBranch,
  Tasks: ListTodo,
  Notes: StickyNote,
  Search: Search,
  Browser: Globe,
  Images: Image,
  Sessions: FileText,
  Projects: Folder,
  System: Monitor,
  Clients: Database,
  Reading: FileText,
  Writing: FileText,
}

/** Compact pill showing an MCP activity category */
export function ActivityPill({ activity }: { activity: MCPActivity }) {
  const Icon = CATEGORY_ICONS[activity.category] || Zap
  const isActive = activity.isActive
  const dotClass = isActive ? 'bg-green-400' : 'bg-neutral-500'
  const textClass = isActive ? 'text-green-400' : 'text-neutral-500'
  const bgClass = isActive
    ? 'bg-green-400/10 border-green-400/25'
    : 'bg-neutral-700/30 border-neutral-600/20'

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border transition-all duration-500 ${bgClass}`}
      title={`${activity.category}: ${activity.callCount} call${activity.callCount !== 1 ? 's' : ''} (last: ${activity.toolName})`}
    >
      <Icon className={`w-[9px] h-[9px] ${textClass}`} />
      <span className={`text-[9px] font-semibold ${textClass}`}>{activity.category}</span>
      {activity.callCount > 1 && (
        <span className="text-[9px] font-mono text-neutral-500">×{activity.callCount}</span>
      )}
    </span>
  )
}

export default function AgentStatusBar({
  projectPath,
  mcpStatus = 'disconnected',
  mcpSessionCount,
  indexStatus = 'idle',
  indexTotalChunks,
  indexProgress,
  indexLastError,
  onMCPConnect,
  onMCPDisconnect,
  onRequestIndex,
}: AgentStatusBarProps) {
  const { claudeProcess, mcpActivity } = useAgentMonitor()

  return (
    <div
      className="
        w-full h-7 flex-shrink-0 flex items-center justify-between
        px-3 bg-neutral-950 border-t border-neutral-800
        no-drag
      "
    >
      {/* Left: MCP indicator + Claude Code + Activity */}
      <div className="flex items-center gap-2">
        <MCPIndicator
          status={mcpStatus}
          sessionCount={mcpSessionCount}
          onConnect={onMCPConnect}
          onDisconnect={onMCPDisconnect}
        />

        {/* Claude Code process indicator */}
        {claudeProcess && (
          <>
            <div className="w-px h-3 bg-neutral-700" />
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-[10px] font-medium text-neutral-400">
                Claude Code
              </span>
              <span className="text-[10px] font-mono text-neutral-500">
                {formatElapsed(claudeProcess.elapsedSeconds)}
              </span>
            </div>
          </>
        )}

        {/* MCP Activity pills */}
        {mcpActivity && mcpActivity.length > 0 && (
          <>
            <div className="w-px h-3 bg-neutral-700" />
            <div className="flex items-center gap-1">
              {mcpActivity.slice(0, 5).map((act) => (
                <ActivityPill key={act.category} activity={act} />
              ))}
              {mcpActivity.length > 5 && (
                <span className="text-[9px] text-neutral-500 px-1">
                  +{mcpActivity.length - 5}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Center: Index indicator */}
      <div className="flex items-center">
        <IndexIndicator
          status={indexStatus}
          totalChunks={indexTotalChunks}
          progress={indexProgress}
          lastError={indexLastError}
          onRequestIndex={onRequestIndex}
        />
      </div>

      {/* Right: Project path */}
      <div className="flex items-center gap-1.5 cursor-default min-w-0">
        {projectPath && (
          <>
            <Folder className="w-3 h-3 text-neutral-600 flex-shrink-0" />
            <span
              className="text-tiny text-neutral-600 font-mono truncate max-w-80"
              title={projectPath}
            >
              {truncatePath(projectPath)}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

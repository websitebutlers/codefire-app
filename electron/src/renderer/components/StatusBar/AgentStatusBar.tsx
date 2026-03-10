import { Folder, AlertTriangle } from 'lucide-react'
import MCPIndicator from './MCPIndicator'
import IndexIndicator from './IndexIndicator'
import { useAgentMonitor } from '../../hooks/useAgentMonitor'
import type { AgentInfo } from '@shared/models'

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
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

/** A compact pill showing a single agent's status. */
function AgentPill({ agent }: { agent: AgentInfo }) {
  const color = agent.isPotentiallyFrozen ? 'orange' : 'blue'
  const dotClass = agent.isPotentiallyFrozen ? 'bg-orange-400' : 'bg-blue-400'
  const textClass = agent.isPotentiallyFrozen ? 'text-orange-400' : 'text-blue-400'
  const bgClass = agent.isPotentiallyFrozen
    ? 'bg-orange-400/10 border-orange-400/25'
    : 'bg-blue-400/10 border-blue-400/25'

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border ${bgClass}`}
      title={`PID ${agent.pid} — ${formatElapsed(agent.elapsedSeconds)}${agent.isPotentiallyFrozen ? ' (may be frozen)' : ''}`}
    >
      <span className={`w-[5px] h-[5px] rounded-full ${dotClass}`} />
      <span className={`text-[9px] font-semibold ${textClass}`}>Agent</span>
      <span className="text-[9px] font-mono text-neutral-400">
        {formatElapsed(agent.elapsedSeconds)}
      </span>
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
  const { claudeProcess, agents } = useAgentMonitor()
  const hasFrozen = agents.some((a) => a.isPotentiallyFrozen)

  return (
    <div
      className="
        w-full h-7 flex-shrink-0 flex items-center justify-between
        px-3 bg-neutral-950 border-t border-neutral-800
        no-drag
      "
    >
      {/* Left: MCP indicator + Agent status */}
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

            {/* Agent pills */}
            {agents.length > 0 && (
              <>
                <div className="w-px h-3 bg-neutral-700" />
                <div className="flex items-center gap-1">
                  {agents.map((agent) => (
                    <AgentPill key={agent.pid} agent={agent} />
                  ))}
                </div>
              </>
            )}

            {/* Frozen warning */}
            {hasFrozen && (
              <>
                <div className="w-px h-3 bg-neutral-700" />
                <div className="flex items-center gap-1">
                  <AlertTriangle className="w-[9px] h-[9px] text-orange-400" />
                  <span className="text-[10px] font-medium text-orange-400">
                    Agent may be frozen
                  </span>
                </div>
              </>
            )}
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

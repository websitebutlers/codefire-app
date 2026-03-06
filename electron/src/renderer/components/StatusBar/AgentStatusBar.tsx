import { Folder } from 'lucide-react'
import MCPIndicator from './MCPIndicator'
import IndexIndicator from './IndexIndicator'

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
function truncatePath(path: string, maxSegments = 3): string {
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= maxSegments) return path
  return '.../' + segments.slice(-maxSegments).join('/')
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
  return (
    <div
      className="
        w-full h-7 flex-shrink-0 flex items-center justify-between
        px-3 bg-neutral-950 border-t border-neutral-800
        no-drag
      "
    >
      {/* Left: MCP indicator */}
      <div className="flex items-center">
        <MCPIndicator
          status={mcpStatus}
          sessionCount={mcpSessionCount}
          onConnect={onMCPConnect}
          onDisconnect={onMCPDisconnect}
        />
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
              className="text-tiny text-neutral-600 font-mono truncate max-w-48"
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

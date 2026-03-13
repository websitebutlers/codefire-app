import { useState } from 'react'
import { Folder, Radio, Code, FolderOpen, Target, AlertCircle } from 'lucide-react'

interface ProjectHeaderBarProps {
  projectName: string
  projectPath: string
  mcpStatus: 'connected' | 'disconnected' | 'error'
  mcpSessionCount: number
  indexStatus: 'idle' | 'indexing' | 'ready' | 'error'
  indexTotalChunks?: number
  indexProgress?: number
  indexLastError?: string
  onMCPConnect?: () => void
  onMCPDisconnect?: () => void
  onRequestIndex?: () => void
  onBriefingClick?: () => void
  briefingCount?: number
}

function truncatePath(p: string, maxLen = 50): string {
  if (p.length <= maxLen) return p
  const segments = p.replace(/\\/g, '/').split('/').filter(Boolean)
  if (segments.length <= 2) return p
  return '.../' + segments.slice(-2).join('/')
}

/**
 * Renders left (project name) and right (indicators) sections.
 * Parent must provide flex layout with a spacer between them.
 */
export function ProjectHeaderLeft({ projectName, projectPath, projectColor }: { projectName: string; projectPath: string; projectColor?: string | null }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-neutral-800/50" title={projectPath}>
      <Folder className={`w-3 h-3 ${projectColor ? '' : 'text-codefire-orange fill-codefire-orange'}`} style={projectColor ? { color: projectColor, fill: projectColor } : undefined} />
      <span className="text-[11px] font-medium text-neutral-300 max-w-32 truncate">{projectName}</span>
    </div>
  )
}

export function ProjectHeaderRight({
  mcpStatus,
  mcpSessionCount,
  indexStatus,
  indexTotalChunks,
  indexProgress,
  indexLastError,
  onMCPConnect,
  onMCPDisconnect,
  onRequestIndex,
  onBriefingClick,
  briefingCount,
}: Omit<ProjectHeaderBarProps, 'projectName' | 'projectPath'>) {
  return (
    <div className="flex items-center gap-1.5">
      <HeaderIndexIndicator
        status={indexStatus}
        totalChunks={indexTotalChunks}
        progress={indexProgress}
        lastError={indexLastError}
        onRequestIndex={onRequestIndex}
      />
      <HeaderFilesystemIndicator />
      <HeaderMCPIndicator
        status={mcpStatus}
        sessionCount={mcpSessionCount}
        onConnect={onMCPConnect}
        onDisconnect={onMCPDisconnect}
      />

      {/* Daily Briefing button */}
      {onBriefingClick && (
        <>
          <div className="w-px h-4 bg-neutral-700 mx-0.5" />
          <button
            onClick={onBriefingClick}
            className="p-1 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors relative"
            title="Daily Briefing"
          >
            <Target className="w-3.5 h-3.5" />
            {(briefingCount ?? 0) > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-codefire-orange text-white text-[7px] font-bold flex items-center justify-center">
                {briefingCount! > 9 ? '9+' : briefingCount}
              </span>
            )}
          </button>
        </>
      )}
    </div>
  )
}

/** Legacy default export — still works but prefer the split components */
export default function ProjectHeaderBar(props: ProjectHeaderBarProps) {
  return (
    <>
      <ProjectHeaderLeft projectName={props.projectName} projectPath={props.projectPath} />
      <div className="flex-1" />
      <ProjectHeaderRight {...props} />
    </>
  )
}

// --- Index Indicator (header pill style) ---

function HeaderIndexIndicator({
  status,
  totalChunks,
  progress,
  lastError,
  onRequestIndex,
}: {
  status: 'idle' | 'indexing' | 'ready' | 'error'
  totalChunks?: number
  progress?: number
  lastError?: string
  onRequestIndex?: () => void
}) {
  const [showError, setShowError] = useState(false)

  const colors = {
    idle: { text: 'text-codefire-orange', bg: 'bg-codefire-orange/10', border: 'border-codefire-orange/40' },
    indexing: { text: 'text-codefire-orange', bg: 'bg-codefire-orange/10', border: 'border-codefire-orange/30' },
    ready: { text: 'text-success', bg: 'bg-success/10', border: 'border-success/30' },
    error: { text: 'text-error', bg: 'bg-error/10', border: 'border-error/30' },
  }
  const c = colors[status]
  const isClickable = (status === 'idle' && !!onRequestIndex) || status === 'error'

  const handleClick = () => {
    if (status === 'idle' && onRequestIndex) {
      onRequestIndex()
    } else if (status === 'error') {
      setShowError((prev) => !prev)
    }
  }

  const label = (() => {
    switch (status) {
      case 'idle': return 'Not Indexed'
      case 'indexing': return progress !== undefined ? `Indexing ${progress}%` : 'Indexing...'
      case 'ready': return totalChunks !== undefined ? `Indexed ${totalChunks}` : 'Indexed'
      case 'error': return 'Index Error'
    }
  })()

  const title = status === 'idle' && onRequestIndex
    ? 'Click to index project'
    : status === 'error'
      ? 'Click to see error details'
      : label

  return (
    <div className="relative">
      <button
        onClick={isClickable ? handleClick : undefined}
        disabled={!isClickable}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold border ${c.text} ${c.bg} ${c.border} ${isClickable ? 'cursor-pointer hover:brightness-125 transition-all' : 'cursor-default'}`}
        title={title}
      >
        {status === 'indexing' ? (
          <span className="inline-block w-3 h-3 border-[1.5px] border-codefire-orange border-t-transparent rounded-full animate-spin" />
        ) : status === 'idle' ? (
          <AlertCircle className="w-3 h-3 animate-pulse" />
        ) : (
          <Code className="w-3 h-3" />
        )}
        <span>{label}</span>
      </button>

      {showError && status === 'error' && (
        <div className="absolute top-full right-0 mt-1 px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 max-w-72 z-50 shadow-lg">
          <p className="text-[11px] text-error break-words">{lastError || 'Unknown error'}</p>
        </div>
      )}
    </div>
  )
}

// --- Filesystem/Profile Indicator ---

function HeaderFilesystemIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold text-success bg-success/10 border border-success/30">
      <FolderOpen className="w-3 h-3" />
      <span>Filesystem</span>
    </div>
  )
}

// --- MCP Indicator (header pill style) ---

function HeaderMCPIndicator({
  status,
  sessionCount,
  onConnect,
  onDisconnect,
}: {
  status: 'connected' | 'disconnected' | 'error'
  sessionCount: number
  onConnect?: () => void
  onDisconnect?: () => void
}) {
  const isConnected = status === 'connected'
  const colors = isConnected
    ? { text: 'text-codefire-orange', bg: 'bg-codefire-orange/10', border: 'border-codefire-orange/30' }
    : status === 'error'
      ? { text: 'text-error', bg: 'bg-error/10', border: 'border-error/30' }
      : { text: 'text-neutral-500', bg: 'bg-neutral-500/10', border: 'border-transparent' }

  const handleClick = () => {
    if (isConnected) {
      onDisconnect?.()
    } else {
      onConnect?.()
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold border cursor-pointer hover:brightness-125 transition-all ${colors.text} ${colors.bg} ${colors.border}`}
      title={
        isConnected
          ? `CodeFire connected (${sessionCount} session${sessionCount !== 1 ? 's' : ''}) — click to disconnect`
          : status === 'error'
            ? 'CodeFire connection error — click to reconnect'
            : 'CodeFire not connected — click to connect'
      }
    >
      <span className="font-bold">MCP</span>
      <span>{isConnected ? 'Connected' : status === 'error' ? 'Error' : 'Disconnected'}</span>
      {isConnected && sessionCount > 1 && (
        <span className="w-4 h-4 rounded-full bg-success text-white text-[9px] font-bold flex items-center justify-center">
          {sessionCount}
        </span>
      )}
    </button>
  )
}

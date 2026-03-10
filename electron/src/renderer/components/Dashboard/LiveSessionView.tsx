import { useState, useEffect } from 'react'
import {
  DollarSign,
  MessageSquare,
  Wrench,
  GitBranch,
  ChevronDown,
  FileText,
} from 'lucide-react'
import type { LiveSessionState } from '@shared/models'
import { api } from '@renderer/lib/api'

interface LiveSessionViewProps {
  projectId: string
}

export default function LiveSessionView({ projectId }: LiveSessionViewProps) {
  const [state, setState] = useState<LiveSessionState | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Initial fetch via IPC
    api.sessions.getLiveState(projectId).then((s) => {
      if (!cancelled) setState(s)
    }).catch(() => {})

    // Listen for real-time push events from LiveSessionWatcher
    const cleanup = window.api.on('sessions:liveUpdate', (...args: unknown[]) => {
      if (!cancelled) setState(args[0] as LiveSessionState)
    })

    // Fallback poll every 10s in case push events are missed
    const interval = setInterval(() => {
      api.sessions.getLiveState(projectId).then((s) => {
        if (!cancelled) setState(s)
      }).catch(() => {})
    }, 10000)

    return () => { cancelled = true; clearInterval(interval); cleanup?.() }
  }, [projectId])

  if (!state) {
    return (
      <div className="bg-neutral-800/50 rounded-cf border border-neutral-700/50 p-4">
        <div className="flex items-center gap-2 mb-2">
          <PulseDot />
          <span className="text-sm font-semibold text-neutral-300">Live Session</span>
        </div>
        <p className="text-sm text-neutral-500">No active session detected</p>
      </div>
    )
  }

  return (
    <div className="bg-neutral-800/50 rounded-cf border border-neutral-700/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-green-500/[0.04] border-b border-neutral-700/50">
        <PulseDot />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black tracking-widest text-green-400">LIVE</span>
            <span className="text-sm font-semibold text-neutral-200 truncate">
              {state.slug ?? state.sessionId.slice(0, 8)}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {state.gitBranch && (
              <span className="flex items-center gap-1 text-[10px] text-purple-400/80">
                <GitBranch className="w-2.5 h-2.5" />
                {state.gitBranch}
              </span>
            )}
            {state.model && (
              <span className="text-[10px] font-medium text-blue-400/80">
                {shortModelName(state.model)}
              </span>
            )}
            <span className="text-[10px] text-neutral-500">{state.elapsedFormatted}</span>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-2 p-3">
        {/* Context meter */}
        <div className="bg-neutral-800/60 rounded-lg p-2 border border-neutral-700/30 text-center">
          <div className="h-1.5 bg-neutral-700/50 rounded-full mb-2 mx-1 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${contextBarColor(state.contextUsagePercent)}`}
              style={{ width: `${Math.max(2, state.contextUsagePercent * 100)}%` }}
            />
          </div>
          <div className="flex items-baseline justify-center gap-0.5">
            <span className="text-base font-bold text-neutral-200">
              {formatTokensK(state.latestContextTokens)}
            </span>
            <span className="text-[10px] text-neutral-500">/ 200k</span>
          </div>
          <div className="text-[10px] text-neutral-500 mt-0.5">Context</div>
        </div>

        <StatCard
          icon={<DollarSign className="w-3 h-3" />}
          value={`$${state.estimatedCost.toFixed(2)}`}
          label="Cost"
          color={state.estimatedCost > 1 ? 'text-orange-400' : 'text-green-400'}
        />
        <StatCard
          icon={<MessageSquare className="w-3 h-3" />}
          value={String(state.messageCount)}
          label="Messages"
          color="text-blue-400"
        />
        <StatCard
          icon={<Wrench className="w-3 h-3" />}
          value={String(state.toolUseCount)}
          label="Tools"
          color="text-purple-400"
        />
      </div>

      {/* Collapsible Details */}
      <div className="px-4 pb-1">
        <button
          onClick={() => setDetailsExpanded((v) => !v)}
          className="flex items-center gap-1.5 py-1.5 text-[11px] font-semibold text-neutral-500 hover:text-neutral-300 transition-colors w-full"
        >
          <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${detailsExpanded ? 'rotate-0' : '-rotate-90'}`} />
          <span>Tool Usage & Files</span>
          {!detailsExpanded && (
            <span className="ml-auto text-[10px] text-neutral-600">
              {state.toolCounts.length} tools · {state.filesChanged.length} files
            </span>
          )}
        </button>

        {detailsExpanded && (
          <div className="grid grid-cols-2 gap-4 pb-3 animate-in fade-in duration-200">
            {/* Tool Usage */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Wrench className="w-3 h-3 text-neutral-500" />
                <span className="text-[11px] font-semibold text-neutral-500">Tool Usage</span>
              </div>
              {state.toolCounts.length === 0 ? (
                <p className="text-[11px] text-neutral-600">No tools used yet</p>
              ) : (
                <div className="space-y-1">
                  {state.toolCounts.slice(0, 8).map((tool) => {
                    const maxCount = state.toolCounts[0]?.count ?? 1
                    const ratio = maxCount > 0 ? tool.count / maxCount : 0
                    return (
                      <div key={tool.name} className="flex items-center gap-1.5 h-3.5">
                        <span className="text-[10px] font-mono text-neutral-500 w-14 text-right truncate">
                          {tool.name}
                        </span>
                        <div className="flex-1 h-2 bg-neutral-700/30 rounded-sm overflow-hidden">
                          <div
                            className="h-full bg-purple-500/50 rounded-sm"
                            style={{ width: `${Math.max(4, ratio * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-semibold text-neutral-400 w-5 text-right">
                          {tool.count}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Files Changed */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <FileText className="w-3 h-3 text-neutral-500" />
                <span className="text-[11px] font-semibold text-neutral-500">
                  Files ({state.filesChanged.length})
                </span>
              </div>
              {state.filesChanged.length === 0 ? (
                <p className="text-[11px] text-neutral-600">No files touched yet</p>
              ) : (
                <div className="space-y-0.5">
                  {state.filesChanged.slice(-10).reverse().map((fp) => (
                    <div key={fp} className="flex items-center gap-1">
                      <FileText className="w-2.5 h-2.5 text-neutral-600 flex-shrink-0" />
                      <span className="text-[11px] font-mono text-neutral-400 truncate">
                        {fp.split(/[/\\]/).pop()}
                      </span>
                    </div>
                  ))}
                  {state.filesChanged.length > 10 && (
                    <span className="text-[10px] text-neutral-600">
                      +{state.filesChanged.length - 10} more
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Activity Feed */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[11px] font-semibold text-neutral-500">Activity</span>
        </div>
        {state.recentActivity.length === 0 ? (
          <p className="text-[11px] text-neutral-600">Waiting for activity...</p>
        ) : (
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {state.recentActivity.slice(0, 20).map((item, i) => (
              <div key={i} className="flex items-center gap-1.5 py-0.5 px-1">
                <span className="text-[9px] font-mono text-neutral-600 w-10 text-right shrink-0">
                  {formatTime(item.timestamp)}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activityDotColor(item.type)}`} />
                <span className={`text-[11px] truncate ${activityTextColor(item.type)}`}>
                  {item.detail}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// --- Helpers ---

function PulseDot() {
  return (
    <div className="relative flex items-center justify-center w-4 h-4 shrink-0">
      <span className="absolute w-4 h-4 rounded-full bg-green-400/30 animate-ping" />
      <span className="w-2 h-2 rounded-full bg-green-400" />
    </div>
  )
}

function StatCard({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode
  value: string
  label: string
  color: string
}) {
  return (
    <div className="bg-neutral-800/60 rounded-lg p-2 border border-neutral-700/30 text-center">
      <div className={`flex justify-center mb-1 opacity-70 ${color}`}>{icon}</div>
      <div className="text-base font-bold text-neutral-200">{value}</div>
      <div className="text-[10px] text-neutral-500 mt-0.5">{label}</div>
    </div>
  )
}

function shortModelName(model: string): string {
  if (model.includes('opus')) return 'Opus'
  if (model.includes('sonnet')) return 'Sonnet'
  if (model.includes('haiku')) return 'Haiku'
  return model
}

function formatTokensK(tokens: number): string {
  if (tokens === 0) return '0'
  return `${(tokens / 1000).toFixed(0)}k`
}

function contextBarColor(pct: number): string {
  if (pct > 0.85) return 'bg-red-500'
  if (pct > 0.65) return 'bg-orange-500'
  return 'bg-blue-500'
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function activityDotColor(type: string): string {
  switch (type) {
    case 'userMessage': return 'bg-blue-400'
    case 'assistantText': return 'bg-green-400'
    case 'toolUse': return 'bg-purple-400'
    default: return 'bg-neutral-500'
  }
}

function activityTextColor(type: string): string {
  switch (type) {
    case 'userMessage': return 'text-neutral-200'
    case 'assistantText': return 'text-neutral-300/70'
    case 'toolUse': return 'text-neutral-500'
    default: return 'text-neutral-500'
  }
}

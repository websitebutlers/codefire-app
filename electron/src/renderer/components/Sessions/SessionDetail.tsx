import {
  Hash,
  Clock,
  Cpu,
  GitBranch,
  FileCode,
  MessageSquare,
  Wrench,
} from 'lucide-react'
import type { Session } from '@shared/models'
import {
  calculateSessionCost,
  formatCost,
  formatDuration,
  formatTokens,
} from '@renderer/hooks/useSessions'
import CostBadge from './CostBadge'

interface SessionDetailProps {
  session: Session | null
}

export default function SessionDetail({ session }: SessionDetailProps) {
  if (!session) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Select a session to view details
      </div>
    )
  }

  const cost = calculateSessionCost(session)
  const filesChanged = session.filesChanged
    ? (() => {
        try {
          return JSON.parse(session.filesChanged) as string[]
        } catch {
          return session.filesChanged.split(',').map((s) => s.trim())
        }
      })()
    : []

  return (
    <div className="p-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-title text-neutral-100 font-medium">
            {session.slug || session.id.slice(0, 12)}
          </h2>
          <CostBadge cost={cost} />
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Hash size={12} />
          <span className="font-mono">{session.id.slice(0, 16)}</span>
        </div>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <MetaItem icon={<Cpu size={14} />} label="Model" value={session.model || 'unknown'} />
        <MetaItem
          icon={<Clock size={14} />}
          label="Duration"
          value={formatDuration(session.startedAt, session.endedAt)}
        />
        <MetaItem
          icon={<GitBranch size={14} />}
          label="Branch"
          value={session.gitBranch || '--'}
        />
        <MetaItem
          icon={<MessageSquare size={14} />}
          label="Messages"
          value={String(session.messageCount)}
        />
        <MetaItem
          icon={<Wrench size={14} />}
          label="Tool Uses"
          value={String(session.toolUseCount)}
        />
        <MetaItem
          icon={<Clock size={14} />}
          label="Started"
          value={
            session.startedAt
              ? new Date(session.startedAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })
              : '--'
          }
        />
      </div>

      {/* Token Breakdown */}
      <div className="bg-neutral-800/50 rounded-cf border border-neutral-700/50 p-3 mb-4">
        <h3 className="text-sm text-neutral-300 font-medium mb-2">Token Breakdown</h3>
        <div className="grid grid-cols-2 gap-2">
          <TokenBar label="Input" value={session.inputTokens} color="bg-blue-500" />
          <TokenBar label="Output" value={session.outputTokens} color="bg-emerald-500" />
          <TokenBar label="Cache Write" value={session.cacheCreationTokens} color="bg-purple-500" />
          <TokenBar label="Cache Read" value={session.cacheReadTokens} color="bg-amber-500" />
        </div>
        <div className="mt-2 pt-2 border-t border-neutral-700/50 text-xs text-neutral-400">
          Total cost: <span className="text-neutral-200 font-medium">{formatCost(cost)}</span>
        </div>
      </div>

      {/* Summary */}
      {session.summary && (
        <div className="mb-4">
          <h3 className="text-sm text-neutral-300 font-medium mb-1">Summary</h3>
          <p className="text-sm text-neutral-400 leading-relaxed">{session.summary}</p>
        </div>
      )}

      {/* Files Changed */}
      {filesChanged.length > 0 && (
        <div>
          <h3 className="text-sm text-neutral-300 font-medium mb-1">
            Files Changed ({filesChanged.length})
          </h3>
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {filesChanged.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 text-xs text-neutral-400 font-mono py-0.5"
              >
                <FileCode size={12} className="text-neutral-500 shrink-0" />
                <span className="truncate">{file}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-neutral-500 mt-0.5">{icon}</span>
      <div>
        <div className="text-xs text-neutral-500">{label}</div>
        <div className="text-sm text-neutral-300">{value}</div>
      </div>
    </div>
  )
}

function TokenBar({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xs text-neutral-500">{label}</span>
        <span className="text-xs text-neutral-300">{formatTokens(value)}</span>
      </div>
      <div className="h-1 bg-neutral-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: value > 0 ? `${Math.min(100, Math.max(5, (value / 500_000) * 100))}%` : '0%' }}
        />
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Clock, GitBranch, FileCode, ChevronDown, Cpu } from 'lucide-react'
import type { SessionSummary } from '@shared/premium-models'

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remaining = mins % 60
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`
}

function UserAvatar({ user }: { user?: SessionSummary['user'] }) {
  if (user?.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.displayName || user.email}
        className="w-7 h-7 rounded-full object-cover"
      />
    )
  }

  const initials = user?.displayName
    ? user.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || '?'

  return (
    <div className="w-7 h-7 rounded-full bg-neutral-700 flex items-center justify-center text-[10px] font-medium text-neutral-300">
      {initials}
    </div>
  )
}

const SUMMARY_TRUNCATE_LENGTH = 200

interface SharedSummaryCardProps {
  summary: SessionSummary
}

export default function SharedSummaryCard({ summary }: SharedSummaryCardProps) {
  const [expanded, setExpanded] = useState(false)

  const isTruncated = summary.summary.length > SUMMARY_TRUNCATE_LENGTH
  const displayText = expanded || !isTruncated
    ? summary.summary
    : summary.summary.slice(0, SUMMARY_TRUNCATE_LENGTH) + '...'

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 hover:border-neutral-700 transition-colors">
      {/* Header: avatar, name, timestamp */}
      <div className="flex items-center gap-2 mb-2">
        <UserAvatar user={summary.user} />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-neutral-200">
            {summary.user?.displayName || summary.user?.email || 'Unknown'}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {summary.model && (
              <span className="flex items-center gap-1 text-[10px] text-neutral-500">
                <Cpu size={10} />
                {summary.model}
              </span>
            )}
            {summary.gitBranch && (
              <span className="flex items-center gap-1 text-[10px] text-neutral-500">
                <GitBranch size={10} />
                {summary.gitBranch}
              </span>
            )}
            {summary.durationMins != null && (
              <span className="flex items-center gap-1 text-[10px] text-neutral-500">
                <Clock size={10} />
                {formatDuration(summary.durationMins)}
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] text-neutral-600 shrink-0">
          {formatRelativeTime(summary.sharedAt)}
        </span>
      </div>

      {/* Summary text */}
      <p className="text-xs text-neutral-400 leading-relaxed whitespace-pre-wrap">
        {displayText}
      </p>
      {isTruncated && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-0.5 mt-1 text-[10px] text-codefire-orange hover:text-orange-400 transition-colors"
        >
          {expanded ? 'Show less' : 'Show more'}
          <ChevronDown size={10} className={`transition-transform duration-150 ${expanded ? 'rotate-180' : 'rotate-0'}`} />
        </button>
      )}

      {/* Files changed */}
      {summary.filesChanged.length > 0 && (
        <div className="mt-2 pt-2 border-t border-neutral-800">
          <div className="flex items-center gap-1 mb-1">
            <FileCode size={10} className="text-neutral-500" />
            <span className="text-[10px] text-neutral-500">
              {summary.filesChanged.length} file{summary.filesChanged.length !== 1 ? 's' : ''} changed
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {summary.filesChanged.slice(0, 8).map((file) => (
              <span
                key={file}
                className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono truncate max-w-[200px]"
                title={file}
              >
                {file.split('/').pop()}
              </span>
            ))}
            {summary.filesChanged.length > 8 && (
              <span className="text-[10px] px-1.5 py-0.5 text-neutral-500">
                +{summary.filesChanged.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

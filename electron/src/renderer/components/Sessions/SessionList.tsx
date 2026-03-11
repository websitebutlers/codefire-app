import { useMemo } from 'react'
import { Clock, GitBranch } from 'lucide-react'
import type { Session } from '@shared/models'
import {
  calculateSessionCost,
  formatDuration,
} from '@renderer/hooks/useSessions'
import CostBadge from './CostBadge'
import {
  getSessionDisplayName,
  getSessionTopic,
  formatStartTime,
  getBranchLabel,
  abbreviateModel,
} from './sessionUtils'

interface SessionListProps {
  sessions: Session[]
  selectedId: string | null
  onSelect: (session: Session) => void
  prTitleMap?: Map<string, string>
}

interface DateGroup {
  label: string
  sessions: Session[]
}

function groupByDate(sessions: Session[]): DateGroup[] {
  const groups = new Map<string, Session[]>()

  // Sort by startedAt descending
  const sorted = [...sessions].sort((a, b) => {
    const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0
    const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0
    return tb - ta
  })

  for (const session of sorted) {
    const date = session.startedAt
      ? new Date(session.startedAt).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
      : 'Unknown Date'
    if (!groups.has(date)) groups.set(date, [])
    groups.get(date)!.push(session)
  }

  return Array.from(groups.entries()).map(([label, sessions]) => ({ label, sessions }))
}

export default function SessionList({ sessions, selectedId, onSelect, prTitleMap }: SessionListProps) {
  const dateGroups = useMemo(() => groupByDate(sessions), [sessions])

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <Clock size={24} className="text-neutral-600 mb-2" />
        <p className="text-sm text-neutral-500">No sessions found</p>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto h-full">
      {dateGroups.map((group) => (
        <div key={group.label}>
          <div className="sticky top-0 bg-neutral-900/95 backdrop-blur-sm px-3 py-1.5 text-xs text-neutral-500 font-medium border-b border-neutral-800">
            {group.label}
          </div>
          {group.sessions.map((session) => {
            const isSelected = session.id === selectedId
            const cost = calculateSessionCost(session)
            const prTitle = session.gitBranch ? prTitleMap?.get(session.gitBranch) : undefined
            const displayName = getSessionDisplayName(session, 60, prTitle)
            const topic = getSessionTopic(session)
            const branchLabel = getBranchLabel(session, prTitle)
            const startTime = formatStartTime(session.startedAt)
            const modelName = abbreviateModel(session.model)
            const duration = formatDuration(session.startedAt, session.endedAt)

            // The title is based on the user message (topic) — if the display
            // name fell back to branch/slug, we still want to show it but the
            // user can't easily tell what the session was about.
            const hasMeaningfulTitle = !!session.title || !!topic || !!prTitle

            return (
              <button
                key={session.id}
                className={`w-full text-left px-3 py-2.5 border-b border-neutral-800/50 transition-colors
                  ${
                    isSelected
                      ? 'bg-neutral-800 border-l-2 border-l-codefire-orange'
                      : 'hover:bg-neutral-800/50 border-l-2 border-l-transparent'
                  }`}
                onClick={() => onSelect(session)}
              >
                {/* Row 1: Title + Cost */}
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`text-sm truncate leading-snug ${
                      hasMeaningfulTitle ? 'text-neutral-200' : 'text-neutral-400 italic'
                    }`}
                  >
                    {displayName}
                  </span>
                  <CostBadge cost={cost} />
                </div>

                {/* Row 2: Branch label (when title is NOT the branch) */}
                {hasMeaningfulTitle && branchLabel && (
                  <div className="flex items-center gap-1 mt-1">
                    <GitBranch size={10} className="text-neutral-600 shrink-0" />
                    <span className="text-xs text-neutral-500 truncate">
                      {branchLabel}
                    </span>
                  </div>
                )}

                {/* Row 3: Metadata — time, model, duration */}
                <div className="flex items-center gap-1.5 mt-1 text-xs text-neutral-500">
                  {startTime && (
                    <>
                      <span>{startTime}</span>
                      <span className="text-neutral-700">·</span>
                    </>
                  )}
                  <span>{modelName}</span>
                  <span className="text-neutral-700">·</span>
                  <span>{duration}</span>
                  {session.messageCount > 0 && (
                    <>
                      <span className="text-neutral-700">·</span>
                      <span>{session.messageCount} msgs</span>
                    </>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import type { Session } from '@shared/models'
import {
  calculateSessionCost,
  formatDuration,
} from '@renderer/hooks/useSessions'
import CostBadge from './CostBadge'

interface SessionListProps {
  sessions: Session[]
  selectedId: string | null
  onSelect: (session: Session) => void
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

export default function SessionList({ sessions, selectedId, onSelect }: SessionListProps) {
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
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-neutral-200 truncate">
                    {session.slug || session.id.slice(0, 8)}
                  </span>
                  <CostBadge cost={cost} />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-neutral-500">{session.model || 'unknown'}</span>
                  <span className="text-xs text-neutral-600">|</span>
                  <span className="text-xs text-neutral-500">
                    {formatDuration(session.startedAt, session.endedAt)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

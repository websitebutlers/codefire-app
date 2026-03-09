import { Radio } from 'lucide-react'
import type { Session } from '@shared/models'
import {
  calculateSessionCost,
  formatCost,
  formatDuration,
  formatTokens,
} from '@renderer/hooks/useSessions'
import { getSessionDisplayName } from '@renderer/components/Sessions/sessionUtils'

interface LiveSessionCardProps {
  sessions: Session[]
}

export default function LiveSessionCard({ sessions }: LiveSessionCardProps) {
  return (
    <div className="bg-neutral-800/50 rounded-cf border border-neutral-700/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Radio size={16} className="text-success" />
        <h3 className="text-title text-neutral-200 font-medium">Recent Sessions</h3>
        <span className="text-xs text-neutral-500 ml-auto">last 24h</span>
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-neutral-500">No sessions in the last 24 hours</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionRow({ session }: { session: Session }) {
  const cost = calculateSessionCost(session)
  const totalTokens = session.inputTokens + session.outputTokens

  return (
    <div className="flex items-center gap-3 px-2 py-1.5 rounded-cf hover:bg-neutral-700/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-neutral-200 truncate">
          {getSessionDisplayName(session)}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-neutral-500">
            {session.model || 'unknown'}
          </span>
          <span className="text-xs text-neutral-600">|</span>
          <span className="text-xs text-neutral-500">
            {formatDuration(session.startedAt, session.endedAt)}
          </span>
          <span className="text-xs text-neutral-600">|</span>
          <span className="text-xs text-neutral-500">
            {formatTokens(totalTokens)} tokens
          </span>
        </div>
      </div>
      <span className="text-xs text-neutral-400 shrink-0">{formatCost(cost)}</span>
    </div>
  )
}

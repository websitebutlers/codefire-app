import { DollarSign, TrendingUp } from 'lucide-react'
import type { Session } from '@shared/models'
import { calculateTotalCost, formatCost, formatTokens } from '@renderer/hooks/useSessions'

interface CostSummaryCardProps {
  sessions: Session[]
}

export default function CostSummaryCard({ sessions }: CostSummaryCardProps) {
  const totalCost = calculateTotalCost(sessions)
  const totalInputTokens = sessions.reduce((sum, s) => sum + s.inputTokens, 0)
  const totalOutputTokens = sessions.reduce((sum, s) => sum + s.outputTokens, 0)
  const totalCacheWrite = sessions.reduce((sum, s) => sum + s.cacheCreationTokens, 0)
  const totalCacheRead = sessions.reduce((sum, s) => sum + s.cacheReadTokens, 0)

  return (
    <div className="bg-neutral-800/50 rounded-cf border border-neutral-700/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign size={16} className="text-codefire-orange" />
        <h3 className="text-title text-neutral-200 font-medium">Cost Summary</h3>
      </div>

      <div className="mb-4">
        <span className="text-xl font-semibold text-neutral-100">{formatCost(totalCost)}</span>
        <span className="text-xs text-neutral-500 ml-2">
          across {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TokenRow label="Input" value={totalInputTokens} />
        <TokenRow label="Output" value={totalOutputTokens} />
        <TokenRow label="Cache Write" value={totalCacheWrite} />
        <TokenRow label="Cache Read" value={totalCacheRead} />
      </div>

      {sessions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-neutral-700/50 flex items-center gap-1.5 text-xs text-neutral-500">
          <TrendingUp size={12} />
          <span>Avg {formatCost(totalCost / sessions.length)} per session</span>
        </div>
      )}
    </div>
  )
}

function TokenRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-sm text-neutral-300">{formatTokens(value)}</div>
    </div>
  )
}

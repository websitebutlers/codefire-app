import { DollarSign, TrendingUp, BarChart3 } from 'lucide-react'
import type { Session } from '@shared/models'
import { calculateSessionCost, calculateTotalCost, formatCost, formatTokens } from '@renderer/hooks/useSessions'

interface CostSummaryCardProps {
  sessions: Session[]
}

export default function CostSummaryCard({ sessions }: CostSummaryCardProps) {
  const totalCost = calculateTotalCost(sessions)
  const totalInputTokens = sessions.reduce((sum, s) => sum + s.inputTokens, 0)
  const totalOutputTokens = sessions.reduce((sum, s) => sum + s.outputTokens, 0)
  const totalCacheWrite = sessions.reduce((sum, s) => sum + s.cacheCreationTokens, 0)
  const totalCacheRead = sessions.reduce((sum, s) => sum + s.cacheReadTokens, 0)

  // Model breakdown
  const modelCosts = new Map<string, { cost: number; count: number }>()
  for (const s of sessions) {
    const model = s.model?.split('/').pop() ?? 'unknown'
    const existing = modelCosts.get(model) ?? { cost: 0, count: 0 }
    existing.cost += calculateSessionCost(s)
    existing.count += 1
    modelCosts.set(model, existing)
  }
  const modelBreakdown = [...modelCosts.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 5)
  const maxModelCost = modelBreakdown.length > 0
    ? Math.max(...modelBreakdown.map(([, v]) => v.cost))
    : 0

  // Last 7 days cost
  const dailyCosts = getDailyCosts(sessions, 7)
  const maxDailyCost = Math.max(...dailyCosts.map((d) => d.cost), 0.01)

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

      <div className="grid grid-cols-2 gap-3 mb-4">
        <TokenRow label="Input" value={totalInputTokens} />
        <TokenRow label="Output" value={totalOutputTokens} />
        <TokenRow label="Cache Write" value={totalCacheWrite} />
        <TokenRow label="Cache Read" value={totalCacheRead} />
      </div>

      {sessions.length > 0 && (
        <div className="pt-3 border-t border-neutral-700/50 flex items-center gap-1.5 text-xs text-neutral-500 mb-4">
          <TrendingUp size={12} />
          <span>Avg {formatCost(totalCost / sessions.length)} per session</span>
        </div>
      )}

      {/* Model Breakdown */}
      {modelBreakdown.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <BarChart3 size={12} className="text-neutral-500" />
            <span className="text-xs text-neutral-400 font-medium">By Model</span>
          </div>
          <div className="space-y-1.5">
            {modelBreakdown.map(([model, { cost, count }]) => (
              <div key={model}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] text-neutral-400 truncate">{model}</span>
                  <span className="text-[11px] text-neutral-300 ml-2 shrink-0">
                    {formatCost(cost)} <span className="text-neutral-600">({count})</span>
                  </span>
                </div>
                <div className="h-1 bg-neutral-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${(cost / maxModelCost) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily Cost Chart */}
      {dailyCosts.some((d) => d.cost > 0) && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <BarChart3 size={12} className="text-neutral-500" />
            <span className="text-xs text-neutral-400 font-medium">Last 7 Days</span>
          </div>
          <div className="flex items-end gap-1 h-16">
            {dailyCosts.map((day) => (
              <div key={day.label} className="flex-1 flex flex-col items-center gap-0.5">
                <div className="w-full flex items-end justify-center" style={{ height: '48px' }}>
                  <div
                    className="w-full max-w-[20px] rounded-t bg-codefire-orange/60 hover:bg-codefire-orange/80 transition-colors"
                    style={{ height: `${Math.max(2, (day.cost / maxDailyCost) * 48)}px` }}
                    title={`${day.label}: ${formatCost(day.cost)}`}
                  />
                </div>
                <span className="text-[9px] text-neutral-600">{day.label}</span>
              </div>
            ))}
          </div>
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

function getDailyCosts(sessions: Session[], days: number): { label: string; cost: number }[] {
  const result: { label: string; cost: number }[] = []
  const now = new Date()

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const dayStr = date.toISOString().slice(0, 10)
    const label = date.toLocaleDateString('en-US', { weekday: 'short' })

    let dayCost = 0
    for (const s of sessions) {
      if (s.startedAt && s.startedAt.slice(0, 10) === dayStr) {
        dayCost += calculateSessionCost(s)
      }
    }
    result.push({ label, cost: dayCost })
  }
  return result
}

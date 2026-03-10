import { useState } from 'react'
import { DollarSign, TrendingUp, BarChart3, Zap, Clock } from 'lucide-react'
import type { Session } from '@shared/models'
import { calculateSessionCost, calculateTotalCost, formatCost, formatTokens, formatDuration } from '@renderer/hooks/useSessions'

interface CostSummaryCardProps {
  sessions: Session[]
}

type TimeRange = '7d' | '30d' | '90d' | 'all'

export default function CostSummaryCard({ sessions }: CostSummaryCardProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')

  // Filter sessions by time range
  const filtered = filterByRange(sessions, timeRange)
  const totalCost = calculateTotalCost(filtered)
  const totalInputTokens = filtered.reduce((sum, s) => sum + s.inputTokens, 0)
  const totalOutputTokens = filtered.reduce((sum, s) => sum + s.outputTokens, 0)
  const totalCacheWrite = filtered.reduce((sum, s) => sum + s.cacheCreationTokens, 0)
  const totalCacheRead = filtered.reduce((sum, s) => sum + s.cacheReadTokens, 0)

  // Cache efficiency
  const cacheHitRate = totalCacheRead + totalInputTokens > 0
    ? totalCacheRead / (totalCacheRead + totalInputTokens)
    : 0

  // Model breakdown
  const modelCosts = new Map<string, { cost: number; count: number; tokens: number }>()
  for (const s of filtered) {
    const model = s.model?.split('/').pop() ?? 'unknown'
    const existing = modelCosts.get(model) ?? { cost: 0, count: 0, tokens: 0 }
    existing.cost += calculateSessionCost(s)
    existing.count += 1
    existing.tokens += s.inputTokens + s.outputTokens
    modelCosts.set(model, existing)
  }
  const modelBreakdown = Array.from(modelCosts.entries())
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 5)
  const maxModelCost = modelBreakdown.length > 0
    ? Math.max(...modelBreakdown.map(([, v]) => v.cost))
    : 0

  // Daily/weekly cost chart
  const chartDays = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 30
  const dailyCosts = getDailyCosts(sessions, chartDays)
  // Group into chart bars (7 bars for 7d, ~10 bars for 30d, ~12 bars for 90d)
  const chartBars = timeRange === '7d'
    ? dailyCosts
    : groupDailyCosts(dailyCosts, timeRange === '30d' ? 10 : 12)
  const maxBarCost = Math.max(...chartBars.map((d) => d.cost), 0.01)

  // Efficiency metrics
  const totalMessages = filtered.reduce((sum, s) => sum + (s.messageCount ?? 0), 0)
  const totalToolUses = filtered.reduce((sum, s) => sum + (s.toolUseCount ?? 0), 0)
  const costPerMessage = totalMessages > 0 ? totalCost / totalMessages : 0
  const costPerTool = totalToolUses > 0 ? totalCost / totalToolUses : 0

  const ranges: { id: TimeRange; label: string }[] = [
    { id: '7d', label: '7D' },
    { id: '30d', label: '30D' },
    { id: '90d', label: '90D' },
    { id: 'all', label: 'All' },
  ]

  return (
    <div className="bg-neutral-800/50 rounded-cf border border-neutral-700/50 p-4">
      {/* Header with time range */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <DollarSign size={16} className="text-codefire-orange" />
          <h3 className="text-[13px] text-neutral-200 font-semibold">Cost Summary</h3>
        </div>
        <div className="flex items-center gap-0.5">
          {ranges.map((r) => (
            <button
              key={r.id}
              onClick={() => setTimeRange(r.id)}
              className={`px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors ${
                timeRange === r.id
                  ? 'bg-codefire-orange/20 text-codefire-orange'
                  : 'text-neutral-600 hover:text-neutral-400'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Total cost */}
      <div className="mb-4">
        <span className={`text-xl font-semibold ${costColor(totalCost)}`}>
          {formatCost(totalCost)}
        </span>
        <span className="text-xs text-neutral-500 ml-2">
          across {filtered.length} session{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Token breakdown */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <TokenRow label="Input" value={totalInputTokens} />
        <TokenRow label="Output" value={totalOutputTokens} />
        <TokenRow label="Cache Write" value={totalCacheWrite} />
        <TokenRow label="Cache Read" value={totalCacheRead} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {filtered.length > 0 && (
          <StatPill
            icon={<TrendingUp size={10} />}
            label="Avg/session"
            value={formatCost(totalCost / filtered.length)}
          />
        )}
        {cacheHitRate > 0 && (
          <StatPill
            icon={<Zap size={10} />}
            label="Cache hit"
            value={`${(cacheHitRate * 100).toFixed(0)}%`}
            color={cacheHitRate > 0.3 ? 'text-green-400' : 'text-neutral-400'}
          />
        )}
        {costPerMessage > 0 && (
          <StatPill
            icon={<Clock size={10} />}
            label="$/message"
            value={costPerMessage < 0.01 ? '<$0.01' : `$${costPerMessage.toFixed(2)}`}
          />
        )}
      </div>

      {/* Model Breakdown */}
      {modelBreakdown.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <BarChart3 size={12} className="text-neutral-500" />
            <span className="text-xs text-neutral-400 font-medium">By Model</span>
          </div>
          <div className="space-y-1.5">
            {modelBreakdown.map(([model, { cost, count, tokens }]) => (
              <div key={model}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] text-neutral-400 truncate">{model}</span>
                  <span className="text-[11px] text-neutral-300 ml-2 shrink-0">
                    {formatCost(cost)}
                    <span className="text-neutral-600 ml-1">
                      ({count} · {formatTokens(tokens)})
                    </span>
                  </span>
                </div>
                <div className="h-1.5 bg-neutral-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${modelBarColor(model)}`}
                    style={{ width: `${(cost / maxModelCost) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cost Chart */}
      {chartBars.some((d) => d.cost > 0) && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <BarChart3 size={12} className="text-neutral-500" />
            <span className="text-xs text-neutral-400 font-medium">
              {timeRange === '7d' ? 'Last 7 Days' :
               timeRange === '30d' ? 'Last 30 Days' :
               timeRange === '90d' ? 'Last 90 Days' : 'All Time'}
            </span>
          </div>
          <div className="flex items-end gap-0.5 h-16">
            {chartBars.map((day, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <div className="w-full flex items-end justify-center" style={{ height: '48px' }}>
                  <div
                    className={`w-full max-w-[20px] rounded-t transition-colors ${
                      day.cost > 0 ? 'bg-codefire-orange/60 hover:bg-codefire-orange/80' : 'bg-neutral-700/30'
                    }`}
                    style={{ height: `${Math.max(2, (day.cost / maxBarCost) * 48)}px` }}
                    title={`${day.label}: ${formatCost(day.cost)}`}
                  />
                </div>
                <span className="text-[8px] text-neutral-600 truncate max-w-full">{day.label}</span>
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
      <div className="text-[10px] text-neutral-500">{label}</div>
      <div className="text-sm text-neutral-300">{formatTokens(value)}</div>
    </div>
  )
}

function StatPill({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700/30">
      <span className="text-neutral-500">{icon}</span>
      <div>
        <div className={`text-xs font-medium ${color ?? 'text-neutral-300'}`}>{value}</div>
        <div className="text-[9px] text-neutral-600">{label}</div>
      </div>
    </div>
  )
}

function costColor(cost: number): string {
  if (cost > 10) return 'text-red-400'
  if (cost > 3) return 'text-orange-400'
  return 'text-neutral-100'
}

function modelBarColor(model: string): string {
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'bg-purple-500'
  if (lower.includes('sonnet')) return 'bg-blue-500'
  if (lower.includes('haiku')) return 'bg-green-500'
  return 'bg-codefire-orange'
}

function filterByRange(sessions: Session[], range: TimeRange): Session[] {
  if (range === 'all') return sessions
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return sessions.filter((s) => {
    const t = s.startedAt ? new Date(s.startedAt).getTime() : 0
    return t > cutoff
  })
}

function getDailyCosts(sessions: Session[], days: number): { label: string; cost: number }[] {
  const result: { label: string; cost: number }[] = []
  const now = new Date()

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const dayStr = date.toISOString().slice(0, 10)
    const label = days <= 7
      ? date.toLocaleDateString('en-US', { weekday: 'short' })
      : `${date.getMonth() + 1}/${date.getDate()}`

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

function groupDailyCosts(
  daily: { label: string; cost: number }[],
  targetBars: number
): { label: string; cost: number }[] {
  if (daily.length <= targetBars) return daily
  const groupSize = Math.ceil(daily.length / targetBars)
  const result: { label: string; cost: number }[] = []

  for (let i = 0; i < daily.length; i += groupSize) {
    const slice = daily.slice(i, i + groupSize)
    const cost = slice.reduce((sum, d) => sum + d.cost, 0)
    const label = slice.length === 1 ? slice[0].label : `${slice[0].label}`
    result.push({ label, cost })
  }
  return result
}

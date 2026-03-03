import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Session } from '@shared/models'
import { api } from '@renderer/lib/api'

// ─── Token pricing per million tokens ────────────────────────────────────────
const PRICING = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
} as const

type ModelTier = keyof typeof PRICING

function detectModel(model: string | null): ModelTier {
  if (!model) return 'sonnet'
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('haiku')) return 'haiku'
  return 'sonnet'
}

export function calculateSessionCost(session: Session): number {
  const tier = detectModel(session.model)
  const prices = PRICING[tier]

  const inputCost = (session.inputTokens / 1_000_000) * prices.input
  const outputCost = (session.outputTokens / 1_000_000) * prices.output
  const cacheWriteCost = (session.cacheCreationTokens / 1_000_000) * prices.cacheWrite
  const cacheReadCost = (session.cacheReadTokens / 1_000_000) * prices.cacheRead

  return inputCost + outputCost + cacheWriteCost + cacheReadCost
}

export function calculateTotalCost(sessions: Session[]): number {
  return sessions.reduce((sum, s) => sum + calculateSessionCost(s), 0)
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}

export function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt) return '--'
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  const mins = Math.round((end - start) / 60_000)

  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function useSessions(projectId: string) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.sessions.list(projectId)
      setSessions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const totalCost = useMemo(() => calculateTotalCost(sessions), [sessions])

  const recentSessions = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return sessions.filter((s) => {
      const started = s.startedAt ? new Date(s.startedAt).getTime() : 0
      return started > cutoff
    })
  }, [sessions])

  return {
    sessions,
    loading,
    error,
    totalCost,
    recentSessions,
    refetch: fetchSessions,
  }
}

import { useState, useEffect, useRef } from 'react'
import type { PresenceState } from '@shared/premium-models'
import { api } from '../lib/api'

const POLL_INTERVAL = 5000

/** Keep only the latest entry per userId to avoid duplicate avatars */
function dedupeByUserId(states: PresenceState[]): PresenceState[] {
  const seen = new Map<string, PresenceState>()
  for (const s of states) {
    seen.set(s.userId, s)
  }
  return Array.from(seen.values())
}

export function usePresence(projectId: string) {
  const [members, setMembers] = useState<PresenceState[]>([])
  const [loading, setLoading] = useState(true)
  const joinedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    async function join() {
      try {
        await api.premium.joinPresence(projectId)
        joinedRef.current = true
      } catch {
        // Premium may not be enabled — silently ignore
      }

      // Initial fetch
      try {
        const states = await api.premium.getPresence(projectId)
        if (!cancelled) setMembers(dedupeByUserId(states))
      } catch {
        // ignore
      }
      if (!cancelled) setLoading(false)

      // Poll for updates
      pollTimer = setInterval(async () => {
        if (cancelled) return
        try {
          const states = await api.premium.getPresence(projectId)
          if (!cancelled) setMembers(dedupeByUserId(states))
        } catch {
          // ignore
        }
      }, POLL_INTERVAL)
    }

    join()

    return () => {
      cancelled = true
      if (pollTimer) clearInterval(pollTimer)
      if (joinedRef.current) {
        api.premium.leavePresence(projectId).catch(() => {})
        joinedRef.current = false
      }
    }
  }, [projectId])

  return { members, loading }
}

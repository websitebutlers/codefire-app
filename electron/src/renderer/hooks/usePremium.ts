import { useState, useEffect, useCallback } from 'react'
import type { PremiumStatus, TeamMember, TeamInvite } from '@shared/premium-models'
import { api } from '../lib/api'

export function usePremium() {
  const [status, setStatus] = useState<PremiumStatus | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [pendingInvites, setPendingInvites] = useState<(TeamInvite & { teamName: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const s = await api.premium.getStatus()
      setStatus(s)
      if (s.authenticated && s.team) {
        const m = await api.premium.listMembers(s.team.id)
        setMembers(m)
        setPendingInvites([])
      } else if (s.authenticated && !s.team) {
        setMembers([])
        const invites = await api.premium.getMyInvites()
        setPendingInvites(invites)
      } else {
        setMembers([])
        setPendingInvites([])
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load premium status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null)
    try {
      const s = await api.premium.signIn(email, password)
      setStatus(s)
      if (s.team) {
        const m = await api.premium.listMembers(s.team.id)
        setMembers(m)
      }
      return s
    } catch (err: any) {
      setError(err?.message || 'Sign in failed')
      throw err
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    setError(null)
    try {
      const s = await api.premium.signUp(email, password, displayName)
      setStatus(s)
      return s
    } catch (err: any) {
      setError(err?.message || 'Sign up failed')
      throw err
    }
  }, [])

  const signOut = useCallback(async () => {
    await api.premium.signOut()
    setStatus(null)
    setMembers([])
  }, [])

  const createTeam = useCallback(async (name: string, slug: string) => {
    const team = await api.premium.createTeam(name, slug)
    await refresh()
    return team
  }, [refresh])

  const inviteMember = useCallback(async (email: string, role: 'admin' | 'member') => {
    if (!status?.team) return
    await api.premium.inviteMember(status.team.id, email, role)
    await refresh()
  }, [status, refresh])

  const removeMember = useCallback(async (userId: string) => {
    if (!status?.team) return
    await api.premium.removeMember(status.team.id, userId)
    await refresh()
  }, [status, refresh])

  const acceptInviteById = useCallback(async (inviteId: string) => {
    setError(null)
    try {
      await api.premium.acceptInviteById(inviteId)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to join team')
      throw err
    }
  }, [refresh])

  return {
    status,
    members,
    pendingInvites,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    createTeam,
    inviteMember,
    removeMember,
    acceptInviteById,
    refresh,
  }
}

/**
 * Deferred variant — delays the initial premium status fetch so it doesn't
 * compete with critical window-load calls (project data, tasks).
 */
export function useDeferredPremium() {
  const [status, setStatus] = useState<PremiumStatus | null>(null)

  useEffect(() => {
    const id = setTimeout(() => {
      api.premium.getStatus()
        .then((s) => setStatus(s))
        .catch(() => {})
    }, 400)
    return () => clearTimeout(id)
  }, [])

  return { status }
}

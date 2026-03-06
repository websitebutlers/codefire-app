import { useState, useEffect, useCallback } from 'react'
import type { PremiumStatus, TeamMember } from '@shared/premium-models'
import { api } from '../lib/api'

export function usePremium() {
  const [status, setStatus] = useState<PremiumStatus | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
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
      } else {
        setMembers([])
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

  return {
    status,
    members,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    createTeam,
    inviteMember,
    removeMember,
    refresh,
  }
}

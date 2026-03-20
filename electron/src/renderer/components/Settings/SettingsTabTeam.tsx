import { useState, useEffect, useCallback } from 'react'
import { Users, UserPlus, Shield, Crown, LogOut, AlertCircle, Loader2, Trash2, CreditCard, Zap, Mail, FolderSync, Check, CloudOff, GitBranch, RefreshCw } from 'lucide-react'
import type { AppConfig, Project } from '@shared/models'
import { Section, Toggle, TextInput } from './SettingsField'
import { usePremium } from '../../hooks/usePremium'
import { api } from '../../lib/api'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabTeam({ config, onChange }: Props) {
  const {
    status, members, pendingInvites, loading, error,
    signIn, signUp, signOut,
    createTeam, inviteMember, removeMember, acceptInviteById,
  } = usePremium()

  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [teamName, setTeamName] = useState('')
  const [teamSlug, setTeamSlug] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [submitting, setSubmitting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<'starter' | 'agency'>('starter')
  const [extraSeats, setExtraSeats] = useState(0)
  const [billingLoading, setBillingLoading] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)

  // Team Projects state
  const [localProjects, setLocalProjects] = useState<Project[]>([])
  const [syncedProjectIds, setSyncedProjectIds] = useState<Set<string>>(new Set())
  const [syncedRepoUrls, setSyncedRepoUrls] = useState<Set<string>>(new Set())
  const [invitingProjectId, setInvitingProjectId] = useState<string | null>(null)
  const [projectInviteSuccess, setProjectInviteSuccess] = useState<string | null>(null)
  const [projectInviteError, setProjectInviteError] = useState<string | null>(null)
  const [unlinkedProjects, setUnlinkedProjects] = useState<{ id: string; name: string; repoUrl: string | null; createdBy: string }[]>([])
  const [syncStatus, setSyncStatus] = useState<{ lastSyncAt: string | null; dirtyCount: number; isSyncing: boolean } | null>(null)

  const loadProjects = useCallback(async () => {
    if (!status?.team) return
    try {
      const [projects, synced, syncState] = await Promise.all([
        api.projects.list(),
        api.premium.listSyncedProjects(status.team.id),
        api.premium.getSyncStatus().catch(() => null),
      ])
      const filteredProjects = projects.filter((p) => p.id !== '__global__')
      setLocalProjects(filteredProjects)
      setSyncedProjectIds(new Set(synced.map((s) => s.id)))
      setSyncedRepoUrls(new Set(synced.filter((s) => s.repoUrl).map((s) => s.repoUrl!)))

      // Find remote synced projects that don't match any local project
      const localIds = new Set(filteredProjects.map((p) => p.id))
      const localRepoUrls = new Set(filteredProjects.filter((p) => p.repoUrl).map((p) => p.repoUrl!))
      const unlinked = synced.filter((s) => {
        if (localIds.has(s.id)) return false
        if (s.repoUrl && localRepoUrls.has(s.repoUrl)) return false
        return true
      })
      setUnlinkedProjects(unlinked)

      if (syncState) setSyncStatus(syncState)
    } catch {
      // Non-fatal
    }
  }, [status?.team])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
      </div>
    )
  }

  // ── Not authenticated: show sign in/up ──────────────────────────────────
  if (!status?.authenticated) {
    return (
      <div className="space-y-6">
        <Section title="Team Collaboration">
          <div className="flex items-start gap-3 mb-3">
            <Users className="w-5 h-5 text-codefire-orange mt-0.5 shrink-0" />
            <p className="text-[10px] text-neutral-500 leading-relaxed">
              Share projects, tasks, and notes with your team in real-time.
              Sign in or create an account to get started.
            </p>
          </div>
        </Section>

        <Section title={authMode === 'signin' ? 'Sign In' : 'Create Account'}>
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 mb-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {confirmationSent && (
            <div className="flex items-center gap-1.5 text-xs text-green-400 mb-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
              <Mail className="w-4 h-4 shrink-0" />
              <span>Check your email for a confirmation link. Click the link to verify your account, then sign in.</span>
            </div>
          )}

          <div className="space-y-3">
            {authMode === 'signup' && (
              <TextInput
                label="Display name"
                value={displayName}
                onChange={setDisplayName}
                placeholder="Your name"
              />
            )}
            <TextInput
              label="Email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
            />
            <TextInput
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              secret
            />

            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  setSubmitting(true)
                  setConfirmationSent(false)
                  try {
                    if (authMode === 'signup') {
                      const result = await signUp(email, password, displayName)
                      if ((result as any)?.confirmationRequired) {
                        setConfirmationSent(true)
                        return
                      }
                    } else {
                      await signIn(email, password)
                    }
                    // Auto-enable premium on successful auth
                    if (!config.premiumEnabled) {
                      onChange({ premiumEnabled: true })
                    }
                  } finally {
                    setSubmitting(false)
                  }
                }}
                disabled={submitting || !email || !password}
                className="px-3 py-1.5 rounded text-xs bg-codefire-orange/20 text-codefire-orange
                           hover:bg-codefire-orange/30 transition-colors font-medium disabled:opacity-50"
              >
                {submitting ? 'Please wait...' : authMode === 'signin' ? 'Sign In' : 'Create Account'}
              </button>

              <button
                onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
                className="text-[10px] text-neutral-500 hover:text-neutral-300"
              >
                {authMode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
              </button>
            </div>
          </div>
        </Section>
      </div>
    )
  }

  // ── Authenticated ───────────────────────────────────────────────────────
  const hasTeam = !!status.team
  const hasPendingInvites = pendingInvites.length > 0
  const isPaid = status.subscriptionActive || !!status.grant

  const roleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="w-3 h-3 text-yellow-500" />
      case 'admin': return <Shield className="w-3 h-3 text-blue-400" />
      default: return <Users className="w-3 h-3 text-neutral-500" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Account section — always visible when authenticated */}
      <Section title="Account">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-xs text-neutral-200">{status.user?.displayName}</p>
            <p className="text-[10px] text-neutral-500">{status.user?.email}</p>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-neutral-500
                       hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-3 h-3" />
            Sign out
          </button>
        </div>
      </Section>

      {/* ── Pending invites: always show if user has been invited ────────── */}
      {!hasTeam && hasPendingInvites && (
        <Section title="Team Invitations">
          <div className="space-y-2">
            {pendingInvites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded-lg border border-codefire-orange/30
                           bg-codefire-orange/5 p-3"
              >
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-codefire-orange shrink-0" />
                  <div>
                    <p className="text-xs text-neutral-200 font-medium">{inv.teamName}</p>
                    <p className="text-[10px] text-neutral-500">
                      Invited as {inv.role}
                    </p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setSubmitting(true)
                    try {
                      await acceptInviteById(inv.id)
                      if (!config.premiumEnabled) {
                        onChange({ premiumEnabled: true })
                      }
                    } finally {
                      setSubmitting(false)
                    }
                  }}
                  disabled={submitting}
                  className="px-3 py-1.5 rounded text-xs bg-codefire-orange/20 text-codefire-orange
                             hover:bg-codefire-orange/30 transition-colors font-medium disabled:opacity-50"
                >
                  {submitting ? 'Joining...' : 'Join Team'}
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── No team + no invites + not paid: PAYWALL ────────────────────── */}
      {!hasTeam && !isPaid && (
        <Section title="Subscribe to Teams">
          <div className="space-y-3">
            <p className="text-[10px] text-neutral-500 leading-relaxed">
              A subscription is required to create a team and enable collaboration features.
              {hasPendingInvites ? ' You can also join an existing team above for free.' : ''}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setSelectedPlan('starter')}
                className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
                  selectedPlan === 'starter'
                    ? 'border-codefire-orange bg-codefire-orange/10'
                    : 'border-neutral-700 hover:border-neutral-600'
                }`}
              >
                <p className="text-xs font-medium text-neutral-200">Starter</p>
                <p className="text-[10px] text-neutral-500">$9/mo — 3 seats</p>
              </button>
              <button
                onClick={() => setSelectedPlan('agency')}
                className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
                  selectedPlan === 'agency'
                    ? 'border-codefire-orange bg-codefire-orange/10'
                    : 'border-neutral-700 hover:border-neutral-600'
                }`}
              >
                <div className="flex items-center gap-1">
                  <p className="text-xs font-medium text-neutral-200">Agency</p>
                  <Zap className="w-3 h-3 text-codefire-orange" />
                </div>
                <p className="text-[10px] text-neutral-500">$40/mo — unlimited</p>
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-neutral-500">
                Extra seats: {extraSeats}
              </label>
              <input
                type="range"
                min={0}
                max={20}
                value={extraSeats}
                onChange={(e) => setExtraSeats(Number(e.target.value))}
                className="w-full accent-codefire-orange"
              />
            </div>

            <button
              onClick={async () => {
                setBillingLoading(true)
                try {
                  const { url } = await api.premium.createCheckout(
                    null, // user-level checkout — no team yet
                    selectedPlan,
                    extraSeats
                  )
                  window.api.invoke('shell:openExternal', url)
                } catch (err: any) {
                  setInviteError(err?.message || 'Failed to create checkout session')
                } finally {
                  setBillingLoading(false)
                }
              }}
              disabled={billingLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-codefire-orange/20
                         text-codefire-orange hover:bg-codefire-orange/30 transition-colors
                         font-medium disabled:opacity-50"
            >
              <CreditCard className="w-3 h-3" />
              {billingLoading ? 'Opening...' : 'Subscribe'}
            </button>
            {inviteError && (
              <p className="text-xs text-red-400 mt-1">{inviteError}</p>
            )}
          </div>
        </Section>
      )}

      {/* ── Paid but no team yet: create one ────────────────────────────── */}
      {!hasTeam && isPaid && (
        <Section title="Create a Team">
          <div className="space-y-3">
            <p className="text-[10px] text-neutral-500 leading-relaxed">
              Your subscription is active. Create a team to start collaborating.
            </p>
            <TextInput
              label="Team name"
              value={teamName}
              onChange={(v) => {
                setTeamName(v)
                setTeamSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'))
              }}
              placeholder="My Team"
            />
            <TextInput
              label="Slug"
              hint="Used in URLs. Letters, numbers, and hyphens only."
              value={teamSlug}
              onChange={setTeamSlug}
              placeholder="my-team"
            />
            <button
              onClick={async () => {
                setSubmitting(true)
                try {
                  await createTeam(teamName, teamSlug)
                } finally {
                  setSubmitting(false)
                }
              }}
              disabled={submitting || !teamName || !teamSlug}
              className="px-3 py-1.5 rounded text-xs bg-codefire-orange/20 text-codefire-orange
                         hover:bg-codefire-orange/30 transition-colors font-medium disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Team'}
            </button>
          </div>
        </Section>
      )}

      {/* ── Team exists: full management UI ─────────────────────────────── */}
      {hasTeam && (
        <>
          <Section title={`Team: ${status.team!.name}`}>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[10px] text-neutral-500">
                <span className="uppercase tracking-wider font-medium">
                  {status.team!.plan} plan
                </span>
                <span>•</span>
                <span>{members.length} / {status.team!.seatLimit} seats</span>
                {status.team!.projectLimit && (
                  <>
                    <span>•</span>
                    <span>{status.team!.projectLimit} project limit</span>
                  </>
                )}
              </div>
              {status.grant && (
                <div className="text-[10px] text-green-400">
                  {status.grant.grantType === 'oss_project'
                    ? 'OSS project grant'
                    : status.grant.grantType === 'oss_contributor'
                      ? 'OSS contributor grant'
                      : 'Custom grant'}
                  {status.grant.expiresAt && ` (expires ${new Date(status.grant.expiresAt).toLocaleDateString()})`}
                </div>
              )}
            </div>

            {/* Billing: Subscribe or Manage */}
            {status.subscriptionActive ? (
              <button
                onClick={async () => {
                  if (!status.team) return
                  setBillingLoading(true)
                  try {
                    const { url } = await api.premium.getBillingPortal(status.team.id)
                    window.api.invoke('shell:openExternal', url)
                  } catch (err: any) {
                    console.error('Failed to open billing portal:', err)
                  } finally {
                    setBillingLoading(false)
                  }
                }}
                disabled={billingLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-neutral-700/50
                           text-neutral-300 hover:bg-neutral-700 transition-colors font-medium disabled:opacity-50"
              >
                <CreditCard className="w-3 h-3" />
                {billingLoading ? 'Opening...' : 'Manage Billing'}
              </button>
            ) : !status.grant ? (
              <div className="space-y-3 mt-2 rounded-lg border border-neutral-700 bg-neutral-800/50 p-3">
                <p className="text-[10px] text-neutral-400 font-medium uppercase tracking-wider">Subscribe</p>

                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedPlan('starter')}
                    className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
                      selectedPlan === 'starter'
                        ? 'border-codefire-orange bg-codefire-orange/10'
                        : 'border-neutral-700 hover:border-neutral-600'
                    }`}
                  >
                    <p className="text-xs font-medium text-neutral-200">Starter</p>
                    <p className="text-[10px] text-neutral-500">$9/mo</p>
                  </button>
                  <button
                    onClick={() => setSelectedPlan('agency')}
                    className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
                      selectedPlan === 'agency'
                        ? 'border-codefire-orange bg-codefire-orange/10'
                        : 'border-neutral-700 hover:border-neutral-600'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-medium text-neutral-200">Agency</p>
                      <Zap className="w-3 h-3 text-codefire-orange" />
                    </div>
                    <p className="text-[10px] text-neutral-500">$40/mo</p>
                  </button>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-neutral-500">
                    Extra seats: {extraSeats}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    value={extraSeats}
                    onChange={(e) => setExtraSeats(Number(e.target.value))}
                    className="w-full accent-codefire-orange"
                  />
                </div>

                <button
                  onClick={async () => {
                    if (!status.team) return
                    setBillingLoading(true)
                    try {
                      const { url } = await api.premium.createCheckout(status.team.id, selectedPlan, extraSeats)
                      window.api.invoke('shell:openExternal', url)
                    } catch (err: any) {
                      console.error('Failed to create checkout:', err)
                    } finally {
                      setBillingLoading(false)
                    }
                  }}
                  disabled={billingLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-codefire-orange/20
                             text-codefire-orange hover:bg-codefire-orange/30 transition-colors
                             font-medium disabled:opacity-50"
                >
                  <CreditCard className="w-3 h-3" />
                  {billingLoading ? 'Opening...' : 'Subscribe'}
                </button>
              </div>
            ) : null}

            {/* Upgrade prompt: on Starter with subscription, suggest Agency */}
            {status.subscriptionActive && status.team?.plan === 'starter' && (
              <div className="flex items-center gap-2 mt-2 rounded-lg border border-codefire-orange/30 bg-codefire-orange/5 p-3">
                <Zap className="w-4 h-4 text-codefire-orange shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-neutral-200 font-medium">Upgrade to Agency</p>
                  <p className="text-[10px] text-neutral-500">
                    More seats, unlimited projects, and priority support.
                  </p>
                </div>
                <button
                  onClick={async () => {
                    if (!status.team) return
                    setBillingLoading(true)
                    try {
                      const { url } = await api.premium.createCheckout(status.team.id, 'agency')
                      window.api.invoke('shell:openExternal', url)
                    } catch (err: any) {
                      console.error('Failed to create checkout:', err)
                    } finally {
                      setBillingLoading(false)
                    }
                  }}
                  disabled={billingLoading}
                  className="px-3 py-1.5 rounded text-xs bg-codefire-orange/20 text-codefire-orange
                             hover:bg-codefire-orange/30 transition-colors font-medium disabled:opacity-50 shrink-0"
                >
                  Upgrade
                </button>
              </div>
            )}
          </Section>

          <Section title="Members">
            <div className="space-y-1">
              {members.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-neutral-800/60"
                >
                  <div className="flex items-center gap-2">
                    {roleIcon(m.role)}
                    <span className="text-xs text-neutral-300">
                      {m.user?.displayName || m.user?.email || m.userId}
                    </span>
                    <span className="text-[10px] text-neutral-600 capitalize">{m.role}</span>
                  </div>
                  {m.role !== 'owner' && m.userId !== status.user?.id && (
                    <button
                      onClick={() => removeMember(m.userId)}
                      className="p-1 text-neutral-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Invite Member">
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
                className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                           text-xs text-neutral-200 placeholder:text-neutral-600
                           focus:outline-none focus:border-codefire-orange/50"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5
                           text-xs text-neutral-200 focus:outline-none focus:border-codefire-orange/50"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                onClick={async () => {
                  if (!inviteEmail) return
                  setSubmitting(true)
                  setInviteSuccess(null)
                  setInviteError(null)
                  const emailSent = inviteEmail.trim()
                  try {
                    await inviteMember(emailSent, inviteRole)
                    setInviteEmail('')
                    setInviteSuccess(`Invite sent to ${emailSent}`)
                  } catch (err) {
                    setInviteError(`Failed to invite: ${err instanceof Error ? err.message : String(err)}`)
                  } finally {
                    setSubmitting(false)
                  }
                }}
                disabled={submitting || !inviteEmail}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-codefire-orange/20
                           text-codefire-orange hover:bg-codefire-orange/30 transition-colors
                           font-medium disabled:opacity-50"
              >
                <UserPlus className="w-3 h-3" />
                Invite
              </button>
            </div>
            {inviteSuccess && (
              <p className="text-xs text-green-400 mt-1">{inviteSuccess}</p>
            )}
            {inviteError && (
              <p className="text-xs text-red-400 mt-1">{inviteError}</p>
            )}
          </Section>

          <Section title="Sync">
            <Toggle
              label="Auto-share session summaries"
              hint="Automatically share your coding session summaries with team members"
              value={config.autoShareSessions}
              onChange={(v) => onChange({ autoShareSessions: v })}
            />
            {syncStatus && (
              <div className="flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-lg bg-neutral-800/50 border border-neutral-800">
                <RefreshCw className={`w-3 h-3 shrink-0 ${syncStatus.isSyncing ? 'animate-spin text-codefire-orange' : 'text-neutral-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-neutral-400">
                    {syncStatus.isSyncing ? 'Syncing...' : syncStatus.lastSyncAt
                      ? `Last synced ${new Date(syncStatus.lastSyncAt).toLocaleTimeString()}`
                      : 'Not yet synced'}
                  </p>
                </div>
                {syncStatus.dirtyCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-amber-500/15 text-amber-400">
                    {syncStatus.dirtyCount} pending
                  </span>
                )}
              </div>
            )}
          </Section>

          <Section title="Team Projects">
            <p className="text-[10px] text-neutral-500 leading-relaxed mb-2">
              Share projects with your team to sync tasks and notes. Invite team members to collaborate on any project.
            </p>
            {projectInviteSuccess && (
              <div className="flex items-center gap-1.5 text-xs text-green-400 mb-2">
                <Check className="w-3.5 h-3.5 shrink-0" />
                {projectInviteSuccess}
              </div>
            )}
            {projectInviteError && (
              <div className="flex items-center gap-1.5 text-xs text-red-400 mb-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {projectInviteError}
              </div>
            )}
            {unlinkedProjects.length > 0 && (
              <div className="mb-3 space-y-1.5">
                <p className="text-[10px] font-medium text-amber-400 flex items-center gap-1">
                  <GitBranch className="w-3 h-3" />
                  {unlinkedProjects.length} shared project{unlinkedProjects.length !== 1 ? 's' : ''} not found locally
                </p>
                {unlinkedProjects.map((proj) => (
                  <div
                    key={proj.id}
                    className="px-2.5 py-2 rounded-lg border border-amber-500/20 bg-amber-500/5"
                  >
                    <p className="text-xs text-neutral-200 font-medium">{proj.name}</p>
                    {proj.repoUrl ? (
                      <div className="mt-1">
                        <p className="text-[10px] text-neutral-500 mb-1">Clone this repo so CodeFire can sync:</p>
                        <code className="block text-[10px] text-amber-300 bg-neutral-900 px-2 py-1 rounded font-mono select-all break-all">
                          git clone {proj.repoUrl}
                        </code>
                      </div>
                    ) : (
                      <p className="text-[10px] text-neutral-500 mt-0.5">
                        Create a project named &quot;{proj.name}&quot; to link automatically.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1">
              {localProjects.length === 0 ? (
                <p className="text-[10px] text-neutral-600 italic">No projects discovered yet.</p>
              ) : (
                localProjects.map((project) => {
                  const isSynced = syncedProjectIds.has(project.id) || (!!project.repoUrl && syncedRepoUrls.has(project.repoUrl))
                  const isInviting = invitingProjectId === project.id
                  return (
                    <div
                      key={project.id}
                      className="flex items-center justify-between py-2 px-2.5 rounded-lg border border-neutral-800 hover:border-neutral-700 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isSynced ? (
                          <FolderSync className="w-3.5 h-3.5 text-green-400 shrink-0" />
                        ) : (
                          <CloudOff className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs text-neutral-200 truncate">{project.name}</p>
                          {isSynced && (
                            <p className="text-[9px] text-green-400/70">Synced with team</p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (!status?.team) return
                          setInvitingProjectId(project.id)
                          setProjectInviteSuccess(null)
                          setProjectInviteError(null)
                          try {
                            const otherMembers = members
                              .filter((m) => m.userId !== status.user?.id)
                              .map((m) => m.userId)
                            await api.premium.inviteToProject(
                              status.team.id,
                              project.id,
                              project.name,
                              project.repoUrl,
                              otherMembers
                            )
                            setSyncedProjectIds((prev) => new Set([...prev, project.id]))
                            if (project.repoUrl) setSyncedRepoUrls((prev) => new Set([...prev, project.repoUrl!]))
                            setProjectInviteSuccess(
                              `Invited ${otherMembers.length} team member${otherMembers.length !== 1 ? 's' : ''} to "${project.name}"`
                            )
                          } catch (err) {
                            setProjectInviteError(
                              `Failed to invite: ${err instanceof Error ? err.message : String(err)}`
                            )
                          } finally {
                            setInvitingProjectId(null)
                          }
                        }}
                        disabled={isInviting || isSynced}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                                   ${isSynced ? 'bg-green-500/10 text-green-400' : 'bg-codefire-orange/15 text-codefire-orange hover:bg-codefire-orange/25'}`}
                      >
                        {isInviting ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : isSynced ? (
                          <FolderSync className="w-3 h-3" />
                        ) : (
                          <UserPlus className="w-3 h-3" />
                        )}
                        {isSynced ? 'Already Synced' : 'Invite Team Members'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </Section>
        </>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  )
}

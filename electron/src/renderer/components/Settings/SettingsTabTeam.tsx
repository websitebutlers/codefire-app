import { useState } from 'react'
import { Users, UserPlus, Shield, Crown, LogOut, AlertCircle, Loader2, Trash2, CreditCard, Zap, Mail } from 'lucide-react'
import type { AppConfig } from '@shared/models'
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
        <Section title="Team Collaboration (Premium)">
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
                  try {
                    if (authMode === 'signup') {
                      await signUp(email, password, displayName)
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

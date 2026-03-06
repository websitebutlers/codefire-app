import { useState } from 'react'
import { Users, UserPlus, Shield, Crown, LogOut, AlertCircle, Loader2, Trash2 } from 'lucide-react'
import type { AppConfig } from '@shared/models'
import { Section, Toggle, TextInput } from './SettingsField'
import { usePremium } from '../../hooks/usePremium'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabTeam({ config, onChange }: Props) {
  const {
    status, members, loading, error,
    signIn, signUp, signOut,
    createTeam, inviteMember, removeMember,
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

  if (!config.premiumEnabled) {
    return (
      <div className="space-y-6">
        <Section title="Team Collaboration (Premium)">
          <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Users className="w-5 h-5 text-codefire-orange mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-xs text-neutral-200 font-medium">
                  Enable team collaboration
                </p>
                <p className="text-[10px] text-neutral-500 leading-relaxed">
                  Share projects, tasks, and notes with your team in real-time.
                  Requires a CodeFire Teams account. Your data will be synced to the cloud.
                  The free, open-source version is unaffected.
                </p>
              </div>
            </div>
            <Toggle
              label="Enable premium features"
              hint="Connects to CodeFire cloud for team sync"
              value={config.premiumEnabled}
              onChange={(v) => onChange({ premiumEnabled: v })}
            />
          </div>
        </Section>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
      </div>
    )
  }

  // Premium enabled but not authenticated — show sign in/up form
  if (!status?.authenticated) {
    return (
      <div className="space-y-6">
        <Section title="Team Collaboration">
          <Toggle
            label="Enable premium features"
            hint="Connects to CodeFire cloud for team sync"
            value={config.premiumEnabled}
            onChange={(v) => onChange({ premiumEnabled: v })}
          />
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

        <Section title="Connection">
          <TextInput
            label="Supabase URL"
            value={config.supabaseUrl}
            onChange={(v) => onChange({ supabaseUrl: v })}
            placeholder="https://your-project.supabase.co"
          />
          <TextInput
            label="Supabase Anon Key"
            value={config.supabaseAnonKey}
            onChange={(v) => onChange({ supabaseAnonKey: v })}
            placeholder="eyJ..."
            secret
          />
        </Section>
      </div>
    )
  }

  // Authenticated — show team management
  const roleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="w-3 h-3 text-yellow-500" />
      case 'admin': return <Shield className="w-3 h-3 text-blue-400" />
      default: return <Users className="w-3 h-3 text-neutral-500" />
    }
  }

  return (
    <div className="space-y-6">
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

        <Toggle
          label="Enable premium features"
          hint="Connects to CodeFire cloud for team sync"
          value={config.premiumEnabled}
          onChange={(v) => onChange({ premiumEnabled: v })}
        />
      </Section>

      {/* No team yet — create one */}
      {!status.team && (
        <Section title="Create a Team">
          <div className="space-y-3">
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

      {/* Team exists — show members and invite */}
      {status.team && (
        <>
          <Section title={`Team: ${status.team.name}`}>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[10px] text-neutral-500">
                <span className="uppercase tracking-wider font-medium">
                  {status.team.plan} plan
                </span>
                <span>•</span>
                <span>{members.length} / {status.team.seatLimit} seats</span>
                {status.team.projectLimit && (
                  <>
                    <span>•</span>
                    <span>{status.team.projectLimit} project limit</span>
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
                  try {
                    await inviteMember(inviteEmail, inviteRole)
                    setInviteEmail('')
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

      <Section title="Connection">
        <TextInput
          label="Supabase URL"
          value={config.supabaseUrl}
          onChange={(v) => onChange({ supabaseUrl: v })}
          placeholder="https://your-project.supabase.co"
        />
        <TextInput
          label="Supabase Anon Key"
          value={config.supabaseAnonKey}
          onChange={(v) => onChange({ supabaseAnonKey: v })}
          placeholder="eyJ..."
          secret
        />
      </Section>
    </div>
  )
}

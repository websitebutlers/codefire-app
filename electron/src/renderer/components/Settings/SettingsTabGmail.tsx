import { useState, useEffect } from 'react'
import { Trash2, Plus, RefreshCw } from 'lucide-react'
import type { AppConfig, GmailAccount, WhitelistRule, Client } from '@shared/models'
import { api } from '../../lib/api'
import { Section, TextInput, Toggle, NumberInput } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabGmail({ config, onChange }: Props) {
  const [accounts, setAccounts] = useState<GmailAccount[]>([])
  const [rules, setRules] = useState<WhitelistRule[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [newPattern, setNewPattern] = useState('')
  const [newClientId, setNewClientId] = useState('')
  const [newPriority, setNewPriority] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.gmail.listAccounts().then(setAccounts).catch(() => {})
    api.gmail.listRules().then(setRules).catch(() => {})
    api.clients.list().then(setClients).catch(() => {})
  }, [])

  async function handleConnect() {
    setLoading(true)
    try {
      const account = await api.gmail.authenticate()
      setAccounts((prev) => [...prev, account])
    } catch {
      // auth cancelled or failed
    }
    setLoading(false)
  }

  async function handleRemoveAccount(id: string) {
    await api.gmail.removeAccount(id)
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  async function handleAddRule() {
    const pattern = newPattern.trim()
    if (!pattern) return
    const rule = await api.gmail.addRule({
      pattern,
      clientId: newClientId || undefined,
      priority: newPriority,
    })
    setRules((prev) => [...prev, rule])
    setNewPattern('')
    setNewClientId('')
    setNewPriority(0)
  }

  async function handleRemoveRule(id: string) {
    await api.gmail.removeRule(id)
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  function getClientName(clientId: string | null): string | null {
    if (!clientId) return null
    return clients.find((c) => c.id === clientId)?.name ?? null
  }

  function getClientColor(clientId: string | null): string | undefined {
    if (!clientId) return undefined
    return clients.find((c) => c.id === clientId)?.color ?? undefined
  }

  const priorityLabels: Record<number, { label: string; color: string }> = {
    0: { label: 'Normal', color: 'text-neutral-500' },
    1: { label: 'Low', color: 'text-blue-400' },
    2: { label: 'Medium', color: 'text-amber-400' },
    3: { label: 'High', color: 'text-orange-400' },
    4: { label: 'Urgent', color: 'text-red-400' },
  }

  return (
    <div className="space-y-6">
      <Section title="Google OAuth Credentials">
        <TextInput
          label="Google Client ID"
          hint="Create OAuth credentials in the Google Cloud Console"
          placeholder="123456789.apps.googleusercontent.com"
          value={config.googleClientId}
          onChange={(v) => onChange({ googleClientId: v })}
          secret
        />
        <TextInput
          label="Google Client Secret"
          placeholder="GOCSPX-..."
          value={config.googleClientSecret}
          onChange={(v) => onChange({ googleClientSecret: v })}
          secret
        />
        <p className="text-[10px] text-neutral-600">
          Save credentials first, then connect accounts below.
        </p>
      </Section>

      <Section title="Sync">
        <Toggle
          label="Enable Gmail sync"
          value={config.gmailSyncEnabled}
          onChange={(v) => onChange({ gmailSyncEnabled: v })}
        />
        <NumberInput
          label="Sync interval (seconds)"
          hint="How often to check for new emails"
          value={config.gmailSyncInterval}
          onChange={(v) => onChange({ gmailSyncInterval: v })}
          min={60}
          max={1800}
          step={60}
        />
      </Section>

      <Section title="Connected Accounts">
        {accounts.length === 0 ? (
          <p className="text-[10px] text-neutral-600">No accounts connected.</p>
        ) : (
          <div className="space-y-1.5">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700"
              >
                <span className="text-xs text-neutral-300 truncate">{a.email}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveAccount(a.id)}
                  className="text-neutral-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={handleConnect}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs
                     bg-neutral-800 border border-neutral-700 text-neutral-300
                     hover:border-neutral-600 hover:text-neutral-200 transition-colors
                     disabled:opacity-50"
        >
          {loading ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
          Connect Account
        </button>
      </Section>

      <Section title="Whitelist Rules">
        <p className="text-[10px] text-neutral-600">
          Only emails matching these patterns will be imported. Assign a client and priority to auto-categorize tasks.
        </p>

        {/* Add rule form */}
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddRule())}
              placeholder="*@example.com"
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                         text-xs text-neutral-200 placeholder:text-neutral-600
                         focus:outline-none focus:border-codefire-orange/50"
            />
            <button
              type="button"
              onClick={handleAddRule}
              disabled={!newPattern.trim()}
              className="px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700
                         text-neutral-400 hover:text-neutral-200 hover:border-neutral-600
                         transition-colors disabled:opacity-30"
            >
              <Plus size={12} />
            </button>
          </div>

          <div className="flex gap-1.5">
            {/* Client picker */}
            <select
              value={newClientId}
              onChange={(e) => setNewClientId(e.target.value)}
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5
                         text-xs text-neutral-300 focus:outline-none focus:border-codefire-orange/50
                         appearance-none cursor-pointer"
            >
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            {/* Priority picker */}
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(Number(e.target.value))}
              className="w-28 bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5
                         text-xs text-neutral-300 focus:outline-none focus:border-codefire-orange/50
                         appearance-none cursor-pointer"
            >
              {Object.entries(priorityLabels).map(([val, { label }]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Rules list */}
        {rules.length > 0 && (
          <div className="space-y-1">
            {rules.map((r) => {
              const prio = priorityLabels[r.priority] ?? priorityLabels[0]
              const clientName = getClientName(r.clientId)
              const clientColor = getClientColor(r.clientId)
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700"
                >
                  <span className="text-xs text-neutral-400 font-mono truncate flex-1">
                    {r.pattern}
                  </span>
                  {clientName && (
                    <span className="flex items-center gap-1 text-[10px] text-neutral-400 shrink-0">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: clientColor ?? '#6B7280' }}
                      />
                      {clientName}
                    </span>
                  )}
                  <span className={`text-[10px] font-medium shrink-0 ${prio.color}`}>
                    {prio.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRule(r.id)}
                    className="text-neutral-600 hover:text-red-400 transition-colors shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

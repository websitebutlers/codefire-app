import { useState, useEffect, useCallback } from 'react'
import { Mail, RefreshCw, AlertCircle, UserPlus } from 'lucide-react'
import { api } from '@renderer/lib/api'
import type { ProcessedEmail, GmailAccount } from '@shared/models'
import SettingsModal from '@renderer/components/Settings/SettingsModal'
import logoIcon from '../../../../resources/icon.png'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const LOOKBACK_OPTIONS = [
  { label: '6h', hours: 6 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
  { label: '7d', hours: 168 },
]

export default function RecentEmails() {
  const [emails, setEmails] = useState<ProcessedEmail[]>([])
  const [accounts, setAccounts] = useState<GmailAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lookbackHours, setLookbackHours] = useState(48)
  const [showSettings, setShowSettings] = useState(false)

  const fetchEmails = useCallback(async () => {
    try {
      const result = await api.gmail.listRecentEmails()
      setEmails(result)
      setError(null)
    } catch {
      setEmails([])
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAccounts = useCallback(async () => {
    try {
      const result = await api.gmail.listAccounts()
      setAccounts(result)
    } catch {
      setAccounts([])
    }
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      // Poll all connected accounts
      for (const account of accounts) {
        await api.gmail.pollEmails(account.id)
      }
      await fetchEmails()
    } catch {
      // ignore
    } finally {
      setSyncing(false)
    }
  }, [fetchEmails, accounts])

  useEffect(() => {
    fetchAccounts()
    fetchEmails()
    const interval = setInterval(fetchEmails, 30000)
    return () => clearInterval(interval)
  }, [fetchEmails, fetchAccounts])

  const unreadCount = emails.filter((e) => !e.isRead).length

  // Header — always shown
  const header = (
    <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-800 bg-neutral-950 shrink-0">
      <Mail size={12} className="text-green-500" />
      <span className="text-xs font-semibold text-neutral-200">Recent Emails</span>

      {unreadCount > 0 && (
        <span className="text-[9px] font-bold text-white bg-codefire-orange px-1.5 py-0.5 rounded-full leading-none">
          {unreadCount}
        </span>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        {LOOKBACK_OPTIONS.map((opt) => (
          <button
            key={opt.hours}
            type="button"
            onClick={() => setLookbackHours(opt.hours)}
            className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
              lookbackHours === opt.hours
                ? 'font-bold text-codefire-orange bg-codefire-orange/12'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-1 text-[10px] font-medium text-codefire-orange px-2 py-1
                   rounded bg-codefire-orange/10 hover:bg-codefire-orange/20 transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed ml-1"
      >
        <RefreshCw size={10} className={syncing ? 'animate-spin' : ''} />
        Sync
      </button>

      <span className="text-[11px] font-bold text-neutral-500 bg-neutral-800 px-1.5 py-0.5 rounded-full leading-none ml-1">
        {emails.length}
      </span>
    </div>
  )

  // No accounts placeholder — clickable to open Settings → Gmail
  if (!loading && accounts.length === 0) {
    return (
      <div className="flex flex-col h-full relative overflow-hidden">
        {/* Faint background logo */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.015] select-none"
          style={{
            backgroundImage: `url(${logoIcon})`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            backgroundSize: 'auto 100%',
          }}
        />
        {header}
        <div
          className="flex-1 flex flex-col items-center justify-center gap-2 text-neutral-500 cursor-pointer
                     hover:bg-neutral-800/30 transition-colors"
          onClick={() => setShowSettings(true)}
        >
          <UserPlus size={20} className="text-neutral-600" />
          <p className="text-xs font-medium text-neutral-400">No Gmail accounts</p>
          <p className="text-[10px] text-neutral-600">
            Click to open Settings → Gmail
          </p>
        </div>
        <SettingsModal open={showSettings} onClose={() => { setShowSettings(false); fetchAccounts() }} initialTab="gmail" />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full relative overflow-hidden">
        {/* Faint background logo */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.015] select-none"
          style={{
            backgroundImage: `url(${logoIcon})`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            backgroundSize: 'auto 100%',
          }}
        />
        {header}
        <div className="flex-1 flex items-center justify-center text-neutral-600 text-xs">
          Loading emails...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col h-full relative overflow-hidden">
        {/* Faint background logo */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.015] select-none"
          style={{
            backgroundImage: `url(${logoIcon})`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            backgroundSize: 'auto 100%',
          }}
        />
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-neutral-600">
          <AlertCircle size={16} />
          <p className="text-xs">{error}</p>
        </div>
      </div>
    )
  }

  if (syncing && emails.length === 0) {
    return (
      <div className="flex flex-col h-full relative overflow-hidden">
        {/* Faint background logo */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.015] select-none"
          style={{
            backgroundImage: `url(${logoIcon})`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            backgroundSize: 'auto 100%',
          }}
        />
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-neutral-500">
          <RefreshCw size={16} className="animate-spin text-neutral-600" />
          <p className="text-xs font-medium">Syncing emails...</p>
        </div>
      </div>
    )
  }

  if (emails.length === 0) {
    return (
      <div className="flex flex-col h-full relative overflow-hidden">
        {/* Faint background logo */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.015] select-none"
          style={{
            backgroundImage: `url(${logoIcon})`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            backgroundSize: 'auto 100%',
          }}
        />
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-neutral-500">
          <Mail size={20} className="text-neutral-600" />
          <p className="text-xs font-medium text-neutral-400">No emails yet</p>
          <p className="text-[10px] text-neutral-600">Select a lookback and tap Sync</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Faint background logo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.015] select-none"
        style={{
          backgroundImage: `url(${logoIcon})`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          backgroundSize: 'auto 100%',
        }}
      />
      {header}
      <div className="flex-1 overflow-y-auto">
        {emails.map((email) => (
          <div
            key={email.id}
            className={`px-3 py-2 border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors ${
              email.isRead ? 'opacity-60' : ''
            }`}
          >
            <div className="flex items-center gap-2 mb-0.5">
              {!email.isRead && (
                <div className="w-1.5 h-1.5 rounded-full bg-codefire-orange shrink-0" />
              )}
              <span className="text-[11px] font-medium text-neutral-200 truncate flex-1">
                {email.fromName || email.fromAddress}
              </span>
              <span className="text-[10px] text-neutral-600 shrink-0">
                {timeAgo(email.receivedAt)}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 truncate">
              {email.subject}
            </p>
            {email.snippet && (
              <p className="text-[10px] text-neutral-600 truncate mt-0.5">
                {email.snippet}
              </p>
            )}
            {email.triageType && (
              <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400">
                {email.triageType}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

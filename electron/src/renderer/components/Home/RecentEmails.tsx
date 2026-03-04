import { useState, useEffect, useCallback } from 'react'
import { Mail, RefreshCw, AlertCircle } from 'lucide-react'
import { api } from '@renderer/lib/api'
import type { ProcessedEmail } from '@shared/models'

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

export default function RecentEmails() {
  const [emails, setEmails] = useState<ProcessedEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEmails = useCallback(async () => {
    try {
      const result = await api.gmail.listRecentEmails()
      setEmails(result)
      setError(null)
    } catch {
      // Gmail handler may not be registered if OAuth credentials aren't configured
      // Silently show empty state instead of error
      setEmails([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEmails()
    const interval = setInterval(fetchEmails, 30000)
    return () => clearInterval(interval)
  }, [fetchEmails])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
        Loading emails...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-neutral-600">
        <AlertCircle size={16} />
        <p className="text-xs">{error}</p>
      </div>
    )
  }

  if (emails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-neutral-600">
        <Mail size={16} />
        <p className="text-xs">No recent emails</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 shrink-0">
        <Mail size={12} className="text-codefire-orange" />
        <span className="text-[11px] font-medium text-neutral-300">Recent Emails</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={fetchEmails}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <RefreshCw size={10} />
        </button>
      </div>
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

import { useState, useRef, useEffect } from 'react'
import { Send, X } from 'lucide-react'
import { usePresence } from '@renderer/hooks/usePresence'
import type { PresenceState } from '@shared/premium-models'
import { api } from '@renderer/lib/api'

interface PresenceAvatarsProps {
  projectId: string
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

const AVATAR_COLORS = [
  'bg-blue-600',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
  'bg-pink-600',
  'bg-teal-600',
]

function colorForUser(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function ChatPopover({
  member,
  projectId,
  onClose,
}: {
  member: PresenceState
  projectId: string
  onClose: () => void
}) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  async function handleSend() {
    const trimmed = message.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      await api.premium.sendTeamMessage(member.userId, trimmed, projectId)
      setStatus('sent')
      setMessage('')
      setTimeout(() => onClose(), 1200)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error('Failed to send alert:', detail)
      setErrorMsg(detail)
      setStatus('error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      ref={popoverRef}
      className="absolute top-full right-0 mt-2 w-64 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <span className="text-xs font-semibold text-neutral-300 truncate">
          Alert {member.displayName}
        </span>
        <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
          <X size={12} />
        </button>
      </div>

      {/* Input area */}
      <div className="p-2">
        {status === 'sent' ? (
          <div className="flex items-center justify-center py-3 text-xs text-green-400">
            Alert sent!
          </div>
        ) : status === 'error' ? (
          <div className="space-y-1.5">
            <div className="py-2 text-xs text-red-400 text-center">
              <p>Failed to send</p>
              {errorMsg && <p className="text-[10px] text-red-400/70 mt-0.5 break-words">{errorMsg}</p>}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={message}
                onChange={(e) => { setMessage(e.target.value); setStatus('idle') }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
                placeholder="Type a message..."
                disabled={sending}
                className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-codefire-orange disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!message.trim() || sending}
                className="p-1.5 rounded text-codefire-orange hover:bg-codefire-orange/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={13} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend()
              }}
              placeholder="Type a message..."
              disabled={sending}
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-codefire-orange disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!message.trim() || sending}
              className="p-1.5 rounded text-codefire-orange hover:bg-codefire-orange/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Send alert"
            >
              <Send size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PresenceAvatars({ projectId }: PresenceAvatarsProps) {
  const { members, loading } = usePresence(projectId)
  const [chatMember, setChatMember] = useState<PresenceState | null>(null)

  if (loading || members.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 relative">
      <span className="text-[10px] text-neutral-500 font-medium">Online</span>
      {members.map((member) => {
        const statusColor =
          member.status === 'active'
            ? 'bg-green-400'
            : member.status === 'idle'
              ? 'bg-yellow-400'
              : 'bg-neutral-500'

        const detail = [
          member.gitBranch ? `branch: ${member.gitBranch}` : null,
          member.activeFile ? `file: ${member.activeFile}` : null,
        ]
          .filter(Boolean)
          .join(' | ')

        const tooltip = detail
          ? `${member.displayName}\n${detail}\nClick to send an alert`
          : `${member.displayName}\nClick to send an alert`

        return (
          <div
            key={member.userId}
            className="relative group cursor-pointer"
            title={tooltip}
            onClick={() => setChatMember(chatMember?.userId === member.userId ? null : member)}
          >
            {/* Avatar circle — image or initials */}
            {member.avatarUrl ? (
              <img
                src={member.avatarUrl}
                alt={member.displayName}
                className="w-6 h-6 rounded-full ring-2 ring-neutral-950 object-cover hover:ring-codefire-orange/50 transition-all"
              />
            ) : (
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-white ring-2 ring-neutral-950 hover:ring-codefire-orange/50 transition-all ${colorForUser(member.userId)}`}
              >
                {getInitials(member.displayName)}
              </div>
            )}
            {/* Status dot */}
            <div
              className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 ring-neutral-950 ${statusColor}`}
            />
          </div>
        )
      })}

      {/* Chat popover */}
      {chatMember && (
        <ChatPopover
          member={chatMember}
          projectId={projectId}
          onClose={() => setChatMember(null)}
        />
      )}
    </div>
  )
}

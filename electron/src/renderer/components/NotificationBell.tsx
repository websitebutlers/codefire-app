import { useState, useRef, useEffect } from 'react'
import { Bell, AtSign, UserPlus, GitPullRequest, CheckCircle, MessageSquare, FolderSync } from 'lucide-react'
import { useNotifications } from '@renderer/hooks/useNotifications'
import type { Notification } from '@shared/premium-models'

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function getTypeIcon(type: Notification['type']) {
  switch (type) {
    case 'mention':
      return <AtSign size={14} className="text-blue-400" />
    case 'assignment':
      return <UserPlus size={14} className="text-green-400" />
    case 'review_request':
      return <GitPullRequest size={14} className="text-amber-400" />
    case 'review_resolved':
      return <CheckCircle size={14} className="text-emerald-400" />
    case 'message':
      return <MessageSquare size={14} className="text-codefire-orange" />
    case 'project_invite':
      return <FolderSync size={14} className="text-purple-400" />
    default:
      return <Bell size={14} className="text-neutral-400" />
  }
}

export default function NotificationBell() {
  const { notifications, unreadCount, premiumEnabled, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // Auto-mark all as read when panel is opened
  useEffect(() => {
    if (open && unreadCount > 0) {
      markAllRead()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!premiumEnabled) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative flex items-center justify-center w-7 h-7 rounded hover:text-neutral-200 hover:bg-neutral-800 transition-colors ${
          unreadCount > 0 ? 'text-codefire-orange animate-pulse' : 'text-neutral-400'
        }`}
        title="Notifications"
      >
        {unreadCount > 0 && (
          <span className="absolute inset-0 rounded bg-codefire-orange/10 animate-ping" style={{ animationDuration: '2s' }} />
        )}
        <Bell size={15} className="relative z-10" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-codefire-orange text-[10px] font-bold text-white leading-none z-10">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-96 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
            <span className="text-xs font-semibold text-neutral-300">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="text-[10px] text-codefire-orange hover:text-codefire-orange/80 transition-colors"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-neutral-600">
                <Bell size={20} className="mb-2" />
                <span className="text-xs">No notifications yet</span>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.isRead) markRead(n.id)
                  }}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-neutral-800/60 transition-colors border-b border-neutral-800/50 last:border-b-0 ${
                    !n.isRead ? 'bg-neutral-800/30' : ''
                  }`}
                >
                  <div className="mt-0.5 shrink-0">{getTypeIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-medium truncate ${!n.isRead ? 'text-neutral-200' : 'text-neutral-400'}`}>
                        {n.title}
                      </span>
                      {!n.isRead && (
                        <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-codefire-orange" />
                      )}
                    </div>
                    {n.body && (
                      <p className="text-[11px] text-neutral-500 mt-0.5 line-clamp-2">{n.body}</p>
                    )}
                    <span className="text-[10px] text-neutral-600 mt-1 block">
                      {formatRelativeTime(n.createdAt)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

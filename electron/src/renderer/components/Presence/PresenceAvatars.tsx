import { usePresence } from '@renderer/hooks/usePresence'

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

export default function PresenceAvatars({ projectId }: PresenceAvatarsProps) {
  const { members, loading } = usePresence(projectId)

  if (loading || members.length === 0) return null

  return (
    <div className="flex items-center gap-1.5">
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
          ? `${member.displayName}\n${detail}`
          : member.displayName

        return (
          <div
            key={member.userId}
            className="relative group"
            title={tooltip}
          >
            {/* Avatar circle — image or initials */}
            {member.avatarUrl ? (
              <img
                src={member.avatarUrl}
                alt={member.displayName}
                className="w-6 h-6 rounded-full ring-2 ring-neutral-950 object-cover"
              />
            ) : (
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-white ring-2 ring-neutral-950 ${colorForUser(member.userId)}`}
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
    </div>
  )
}

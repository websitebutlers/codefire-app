interface CommitRowProps {
  hash: string
  subject: string
  date: string
  author?: string
}

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then

  if (diffMs < 60_000) return 'just now'

  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins}m ago`

  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  return new Date(dateStr).toLocaleDateString()
}

export default function CommitRow({ hash, subject, date, author }: CommitRowProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-800/40 transition-colors">
      <span className="text-[11px] font-mono text-codefire-orange shrink-0">
        {hash.slice(0, 7)}
      </span>
      <span className="text-sm text-neutral-300 truncate flex-1">{subject}</span>
      {author && (
        <span className="text-[10px] text-neutral-600 shrink-0 truncate max-w-[80px]">{author}</span>
      )}
      <span className="text-[10px] text-neutral-600 shrink-0">{relativeTime(date)}</span>
    </div>
  )
}

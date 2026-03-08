import { useState, useEffect } from 'react'
import { Loader2, GitCommit } from 'lucide-react'
import { api } from '@renderer/lib/api'

interface GitGraphProps {
  projectPath: string
}

interface GitLogEntry {
  hash: string
  author: string
  email: string
  date: string
  subject: string
  body: string
}

export default function GitGraph({ projectPath }: GitGraphProps) {
  const [commits, setCommits] = useState<GitLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(50)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    api.git
      .log(projectPath, { limit })
      .then((data) => {
        if (!cancelled) {
          setCommits(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load git log')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, limit])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={16} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  if (error) {
    return <div className="p-4 text-xs text-error">{error}</div>
  }

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-neutral-600">
        <GitCommit size={24} className="mb-2" />
        <p className="text-xs">No commits found</p>
      </div>
    )
  }

  // Group commits by date
  const grouped = groupByDate(commits)

  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      {/* Controls */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
          Showing {commits.length} commits
        </span>
        <div className="flex-1" />
        {commits.length >= limit && (
          <button
            onClick={() => setLimit((l) => l + 50)}
            className="text-[10px] text-codefire-orange hover:text-codefire-orange/80"
          >
            Load more
          </button>
        )}
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[11px] top-0 bottom-0 w-px bg-neutral-800" />

        {Object.entries(grouped).map(([dateLabel, dateCommits]) => (
          <div key={dateLabel} className="mb-4">
            {/* Date header */}
            <div className="relative flex items-center mb-2 ml-7">
              <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
                {dateLabel}
              </span>
            </div>

            {/* Commits for this date */}
            {dateCommits.map((commit, i) => (
              <div
                key={commit.hash}
                className="relative flex items-start gap-3 py-1.5 group"
              >
                {/* Dot on timeline */}
                <div
                  className={`relative z-10 w-[23px] h-[23px] flex items-center justify-center shrink-0 ${
                    i === 0 && dateLabel === Object.keys(grouped)[0]
                      ? ''
                      : ''
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full ${
                      i === 0 && dateLabel === Object.keys(grouped)[0]
                        ? 'bg-codefire-orange'
                        : 'bg-neutral-600 group-hover:bg-neutral-400'
                    } transition-colors`}
                  />
                </div>

                {/* Commit info */}
                <div className="flex-1 min-w-0 -mt-0.5">
                  <p className="text-xs text-neutral-200 truncate leading-snug">
                    {commit.subject}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-neutral-500 font-mono">
                      {commit.hash.slice(0, 7)}
                    </span>
                    <span className="text-[10px] text-neutral-600">
                      {commit.author}
                    </span>
                    <span className="text-[10px] text-neutral-700">
                      {formatTime(commit.date)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function groupByDate(
  commits: GitLogEntry[]
): Record<string, GitLogEntry[]> {
  const groups: Record<string, GitLogEntry[]> = {}
  const now = new Date()
  const today = now.toDateString()
  const yesterday = new Date(now.getTime() - 86400000).toDateString()

  for (const commit of commits) {
    const d = new Date(commit.date)
    const dateStr = d.toDateString()
    let label: string

    if (dateStr === today) {
      label = 'Today'
    } else if (dateStr === yesterday) {
      label = 'Yesterday'
    } else {
      label = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      })
    }

    if (!groups[label]) groups[label] = []
    groups[label].push(commit)
  }

  return groups
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

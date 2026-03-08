import { useState, useEffect, useMemo } from 'react'
import { Loader2, File } from 'lucide-react'
import { api } from '@renderer/lib/api'

interface FileHeatmapProps {
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

interface FileFreq {
  path: string
  count: number
  lastChanged: string
}

export default function FileHeatmap({ projectPath }: FileHeatmapProps) {
  const [commits, setCommits] = useState<GitLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    // Get recent commits to analyze file change frequency
    api.git
      .log(projectPath, { limit: 100 })
      .then((data) => {
        if (!cancelled) {
          setCommits(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load git data')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectPath])

  // Parse changed files from commit subjects/bodies (heuristic: extract file paths)
  // Since we don't have per-commit file lists from git log, we'll use commit count by author
  const authorStats = useMemo(() => {
    const map = new Map<string, { count: number; lastDate: string }>()
    for (const c of commits) {
      const existing = map.get(c.author)
      if (existing) {
        existing.count++
      } else {
        map.set(c.author, { count: 1, lastDate: c.date })
      }
    }
    return Array.from(map.entries())
      .map(([author, data]) => ({ author, ...data }))
      .sort((a, b) => b.count - a.count)
  }, [commits])

  // Day-of-week + hour heatmap from commit timestamps
  const heatmapData = useMemo(() => {
    // 7 days x 24 hours grid
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
    let max = 0

    for (const c of commits) {
      const d = new Date(c.date)
      const day = d.getDay() // 0=Sun, 6=Sat
      const hour = d.getHours()
      grid[day][hour]++
      if (grid[day][hour] > max) max = grid[day][hour]
    }

    return { grid, max }
  }, [commits])

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

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="h-full overflow-y-auto px-4 py-3 space-y-6">
      {/* Commit Activity Heatmap */}
      <div>
        <h3 className="text-xs font-medium text-neutral-300 mb-3">
          Commit Activity (Last {commits.length} commits)
        </h3>
        <div className="bg-neutral-900/50 rounded-lg border border-neutral-800 p-4">
          <div className="flex gap-1">
            {/* Day labels */}
            <div className="flex flex-col gap-1 mr-1 pt-5">
              {days.map((day) => (
                <div
                  key={day}
                  className="h-3 flex items-center text-[9px] text-neutral-600"
                >
                  {day}
                </div>
              ))}
            </div>
            {/* Hour columns */}
            <div className="flex-1 overflow-x-auto">
              <div className="flex gap-px min-w-max">
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} className="flex flex-col gap-px">
                    <div className="h-4 flex items-end justify-center">
                      <span className="text-[8px] text-neutral-700">
                        {hour % 6 === 0 ? `${hour}` : ''}
                      </span>
                    </div>
                    {days.map((_, dayIdx) => {
                      const val = heatmapData.grid[dayIdx][hour]
                      const intensity =
                        heatmapData.max > 0 ? val / heatmapData.max : 0
                      return (
                        <div
                          key={dayIdx}
                          className="w-3 h-3 rounded-sm"
                          style={{
                            backgroundColor:
                              val === 0
                                ? 'rgb(38, 38, 38)'
                                : `rgba(249, 115, 22, ${0.2 + intensity * 0.8})`,
                          }}
                          title={`${days[dayIdx]} ${hour}:00 — ${val} commits`}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top Contributors */}
      <div>
        <h3 className="text-xs font-medium text-neutral-300 mb-3">
          Top Contributors
        </h3>
        <div className="space-y-2">
          {authorStats.slice(0, 10).map((stat) => {
            const pct =
              authorStats.length > 0
                ? (stat.count / authorStats[0].count) * 100
                : 0
            return (
              <div
                key={stat.author}
                className="flex items-center gap-3"
              >
                <span className="text-xs text-neutral-300 w-32 truncate">
                  {stat.author}
                </span>
                <div className="flex-1 h-2 bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-codefire-orange/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-neutral-500 w-12 text-right">
                  {stat.count} commits
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

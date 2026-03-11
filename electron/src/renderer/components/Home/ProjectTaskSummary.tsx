import { useState, useEffect, useCallback } from 'react'
import { FolderKanban, Folder, Circle, ArrowUp, ArrowDown, ArrowUpDown, CheckCircle } from 'lucide-react'
import type { Project, TaskItem, Client } from '@shared/models'
import { api } from '@renderer/lib/api'
import logoIcon from '../../../../resources/icon.png'

type ProjectSortField = 'tasks' | 'name'
type ProjectSortDir = 'asc' | 'desc'

interface ProjectTaskCount {
  project: Project
  client: Client | null
  todoCount: number
  inProgressCount: number
}

function parseTags(tags: string | null): string[] {
  if (!tags) return []
  const trimmed = tags.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean)
    } catch { /* fall through */ }
  }
  return trimmed.split(',').map((t) => t.trim()).filter(Boolean)
}

export default function ProjectTaskSummary() {
  const [summaries, setSummaries] = useState<ProjectTaskCount[]>([])
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<ProjectSortField>('tasks')
  const [sortDir, setSortDir] = useState<ProjectSortDir>('desc')

  const fetchSummaries = useCallback(async () => {
    try {
      const [projects, clients] = await Promise.all([
        api.projects.list(),
        api.clients.list(),
      ])

      const clientMap = new Map(clients.map((c) => [c.id, c]))

      // Fetch tasks for each project in parallel
      const counts = await Promise.all(
        projects.map(async (project) => {
          const tasks: TaskItem[] = await api.tasks.list(project.id)
          const todoCount = tasks.filter((t) => t.status === 'todo').length
          const inProgressCount = tasks.filter(
            (t) => t.status === 'in_progress'
          ).length
          return {
            project,
            client: project.clientId
              ? clientMap.get(project.clientId) ?? null
              : null,
            todoCount,
            inProgressCount,
          }
        })
      )

      // Only show projects with active tasks
      const active = counts.filter((c) => c.todoCount + c.inProgressCount > 0)
      setSummaries(active)
    } catch (err) {
      console.error('Failed to fetch project task summaries:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSummaries()
    const interval = setInterval(fetchSummaries, 5000)
    return () => clearInterval(interval)
  }, [fetchSummaries])

  const totalActive = summaries.reduce(
    (sum, s) => sum + s.todoCount + s.inProgressCount,
    0
  )

  const sortedSummaries = [...summaries].sort((a, b) => {
    const dir = sortDir === 'desc' ? -1 : 1
    if (sortField === 'name') {
      return a.project.name.localeCompare(b.project.name) * dir
    }
    // tasks: sort by total active count
    const aTotal = a.todoCount + a.inProgressCount
    const bTotal = b.todoCount + b.inProgressCount
    return (aTotal - bTotal) * dir
  })

  const handleSortClick = (field: ProjectSortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
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
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-800 bg-neutral-950">
        <FolderKanban size={12} className="text-codefire-orange" />
        <span className="text-xs font-semibold text-neutral-200">
          Active Tasks by Project
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {(['tasks', 'name'] as const).map((field) => {
            const isActive = sortField === field
            const Icon = isActive ? (sortDir === 'desc' ? ArrowDown : ArrowUp) : ArrowUpDown
            return (
              <button
                key={field}
                onClick={() => handleSortClick(field)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  isActive
                    ? 'bg-neutral-700 text-neutral-200'
                    : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                {field === 'tasks' ? 'Tasks' : 'Name'}
                {isActive && <Icon size={9} />}
              </button>
            )
          })}
        </div>
        <span className="text-[11px] font-bold text-neutral-500 px-1.5 py-0.5 rounded-full bg-neutral-800/80">
          {totalActive}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-neutral-600">Loading...</p>
          </div>
        ) : sortedSummaries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-600">
            <CheckCircle size={24} className="mb-2 text-green-500/60" />
            <p className="text-xs font-medium text-neutral-500">All clear</p>
          </div>
        ) : (
          <div className="py-1">
            {sortedSummaries.map((summary) => {
              const tags = parseTags(summary.project.tags)
              return (
                <button
                  key={summary.project.id}
                  onClick={() =>
                    api.windows.openProject(summary.project.id)
                  }
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800/60 transition-colors text-left group"
                >
                  {/* Folder icon */}
                  <Folder size={12} className="text-neutral-500 shrink-0" />

                  {/* Project name */}
                  <span className="text-xs font-medium text-neutral-300 truncate">
                    {summary.project.name}
                  </span>

                  {/* Client badge */}
                  {summary.client && (
                    <span
                      className="text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: summary.client.color || '#6b7280',
                        color: 'rgba(255,255,255,0.9)',
                      }}
                    >
                      {summary.client.name}
                    </span>
                  )}

                  {/* Tag pill */}
                  {tags.length > 0 && (
                    <span className="text-[9px] font-medium text-neutral-500 px-1.5 py-0.5 rounded-full bg-neutral-700/50 shrink-0">
                      {tags[0]}
                    </span>
                  )}

                  <span className="flex-1" />

                  {/* In Progress count */}
                  {summary.inProgressCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 shrink-0">
                      <Circle
                        size={6}
                        className="fill-blue-400 text-blue-400"
                      />
                      {summary.inProgressCount}
                    </span>
                  )}

                  {/* Todo count */}
                  <span className="flex items-center gap-1 text-[10px] font-bold text-codefire-orange shrink-0">
                    <Circle
                      size={6}
                      className="fill-codefire-orange text-codefire-orange"
                    />
                    {summary.todoCount}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { MessageSquare, GripVertical, Play, Trash2, ArrowRight, Users, AlertTriangle } from 'lucide-react'
import type { TaskItem } from '@shared/models'

interface TaskCardProps {
  task: TaskItem
  onClick: () => void
  noteCount?: number
  projectName?: string
  projectColor?: string | null
  groupColor?: string | null
  isDragOverlay?: boolean
  onMoveTask?: (taskId: number, newStatus: string) => void
  onLaunchSession?: (task: TaskItem) => void
  onDeleteTask?: (taskId: number) => void
  memberAvatars?: Record<string, string>
  localUserName?: string
}

const PRIORITY_BORDER_COLORS: Record<number, string> = {
  0: 'border-neutral-700/50',
  1: 'border-l-neutral-500',
  2: 'border-l-yellow-500',
  3: 'border-l-orange-500',
  4: 'border-l-red-500',
}

const PRIORITY_COLORS: Record<number, string> = {
  1: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  2: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  3: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  4: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const PRIORITY_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Med',
  3: 'High',
  4: 'Urgent',
}

const SOURCE_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  claude: { label: 'CLAUDE', color: 'text-orange-300', bg: 'bg-orange-500/20' },
  'ai-extracted': { label: 'AI', color: 'text-purple-300', bg: 'bg-purple-500/20' },
  manual: { label: 'MANUAL', color: 'text-neutral-400', bg: 'bg-neutral-700' },
  email: { label: 'EMAIL', color: 'text-blue-300', bg: 'bg-blue-500/20' },
  mcp: { label: 'MCP', color: 'text-green-300', bg: 'bg-green-500/20' },
  browser: { label: 'BROWSER', color: 'text-cyan-300', bg: 'bg-cyan-500/20' },
  chat: { label: 'CHAT', color: 'text-pink-300', bg: 'bg-pink-500/20' },
}

const LABEL_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  bug: { text: 'text-red-400', bg: 'bg-red-500/12', border: 'border-red-500/30' },
  feature: { text: 'text-blue-400', bg: 'bg-blue-500/12', border: 'border-blue-500/30' },
  refactor: { text: 'text-purple-400', bg: 'bg-purple-500/12', border: 'border-purple-500/30' },
  test: { text: 'text-green-400', bg: 'bg-green-500/12', border: 'border-green-500/30' },
  docs: { text: 'text-emerald-400', bg: 'bg-emerald-500/12', border: 'border-emerald-500/30' },
  performance: { text: 'text-orange-400', bg: 'bg-orange-500/12', border: 'border-orange-500/30' },
  security: { text: 'text-pink-400', bg: 'bg-pink-500/12', border: 'border-pink-500/30' },
  design: { text: 'text-cyan-400', bg: 'bg-cyan-500/12', border: 'border-cyan-500/30' },
  email: { text: 'text-green-400', bg: 'bg-green-500/12', border: 'border-green-500/30' },
  calendar: { text: 'text-indigo-400', bg: 'bg-indigo-500/12', border: 'border-indigo-500/30' },
}

function getLabelStyle(label: string): string {
  const colors = LABEL_COLORS[label.toLowerCase()]
  if (colors) {
    return `${colors.bg} ${colors.text} ${colors.border} border`
  }
  return 'bg-neutral-700 text-neutral-400 border border-neutral-600/50'
}

function parseLabels(labels: string | null): string[] {
  if (!labels) return []
  try {
    return JSON.parse(labels)
  } catch {
    return []
  }
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

function colorForUser(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

const MOVE_TARGETS: { status: string; label: string }[] = [
  { status: 'todo', label: 'Todo' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'done', label: 'Done' },
]

export default function TaskCard({ task, onClick, noteCount = 0, projectName, projectColor, groupColor, isDragOverlay, onMoveTask, onLaunchSession, onDeleteTask, memberAvatars, localUserName }: TaskCardProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: String(task.id), disabled: isDragOverlay })

  const style = isDragOverlay
    ? {}
    : {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }

  const labels = parseLabels(task.labels)

  // Close context menu on click outside or scroll
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isDragOverlay) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-neutral-800 border border-neutral-700/50 border-l-2 ${PRIORITY_BORDER_COLORS[task.priority] || 'border-neutral-700/50'} rounded-cf p-2.5
        hover:border-neutral-600 hover:shadow-[0_2px_8px_rgba(0,0,0,0.15)] transition-all duration-150 cursor-pointer group relative overflow-hidden
        ${isDragging ? 'shadow-lg ring-1 ring-codefire-orange/30' : ''}`}
      onClick={onClick}
      onContextMenu={handleContextMenu}
    >
      <div className="flex items-start gap-1.5">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 text-neutral-600 hover:text-neutral-400 cursor-grab active:cursor-grabbing shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="text-sm text-neutral-200 leading-snug line-clamp-2">{task.title}</div>

          {/* Meta row: project group (left) + date (right) */}
          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-neutral-500">
            {projectName && (
              <span
                className={`px-1.5 py-0.5 rounded font-medium truncate max-w-[100px] border ${
                  !groupColor && !projectColor ? 'bg-codefire-orange/12 text-codefire-orange border-codefire-orange/20' : ''
                }`}
                style={groupColor || projectColor ? {
                  backgroundColor: groupColor ? `${groupColor}1F` : undefined,
                  borderColor: groupColor ? `${groupColor}33` : undefined,
                  color: projectColor || undefined,
                } : undefined}
              >
                {projectName}
              </span>
            )}
            <span>
              {new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>

          {/* Description snippet */}
          {task.description && (
            <div className="text-xs text-neutral-500 mt-1 line-clamp-2 leading-relaxed">
              {task.description}
            </div>
          )}

          {/* Priority + Labels + Source + Notes row */}
          <div className="flex items-center flex-wrap gap-1 mt-1.5">
            {task.priority > 0 && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded border flex items-center gap-1 ${PRIORITY_COLORS[task.priority] || ''}`}
              >
                {task.priority >= 3 && <AlertTriangle size={10} />}
                {PRIORITY_LABELS[task.priority] || `P${task.priority}`}
              </span>
            )}
            {task.remoteOwnerName && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 flex items-center gap-1">
                <Users size={10} />
                TEAM
              </span>
            )}
            {(() => {
              const badge = SOURCE_BADGES[task.source ?? 'manual']
              return badge && task.source !== 'manual' ? (
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${badge.bg} ${badge.color}`}>
                  {badge.label}
                </span>
              ) : null
            })()}
            {labels.slice(0, 3).map((label) => (
              <span
                key={label}
                className={`text-xs px-1.5 py-0.5 rounded ${getLabelStyle(label)}`}
              >
                {label}
              </span>
            ))}
            {labels.length > 3 && (
              <span className="text-[10px] text-neutral-500">+{labels.length - 3}</span>
            )}
            {noteCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-neutral-500 ml-auto">
                <MessageSquare size={10} />
                {noteCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right watermark — progress: who is working on / completed the task */}
      {(() => {
        if (task.status === 'todo') return null
        // For done tasks: if remoteOwnerName is set and completedBy is the local user,
        // the completedBy was likely backfilled — prefer remoteOwnerName (the actual completer)
        const rightName =
          task.status === 'done'
            ? (task.remoteOwnerName && task.completedBy === localUserName
                ? task.remoteOwnerName
                : task.completedBy || localUserName)
            : (task.remoteOwnerName || localUserName)
        if (!rightName) return null
        const avatarUrl = memberAvatars?.[rightName]
        const tooltip =
          task.status === 'done'
            ? `Completed by ${rightName}${task.completedAt ? ` on ${new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
            : `In progress: ${rightName}`
        return (
          <div
            className="absolute pointer-events-none"
            style={{ bottom: -12, right: -12, opacity: 0.25 }}
            title={tooltip}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={rightName}
                className="w-[50px] h-[50px] rounded-full object-cover"
              />
            ) : (
              <div
                className={`w-[50px] h-[50px] rounded-full flex items-center justify-center text-sm font-semibold text-white ${colorForUser(rightName)}`}
              >
                {getInitials(rightName)}
              </div>
            )}
          </div>
        )
      })()}

      {/* Left watermark — creator: who created the task (skip if same as right) */}
      {(() => {
        const creatorName = task.createdBy
        if (!creatorName) return null
        // Determine the right-side name to check for duplication (must match right watermark logic)
        const rightName =
          task.status === 'todo' ? null :
          task.status === 'done'
            ? (task.remoteOwnerName && task.completedBy === localUserName
                ? task.remoteOwnerName
                : task.completedBy || localUserName)
            : (task.remoteOwnerName || localUserName)
        if (rightName && rightName === creatorName) return null
        const avatarUrl = memberAvatars?.[creatorName]
        return (
          <div
            className="absolute pointer-events-none"
            style={{ bottom: -12, left: -12, opacity: 0.25 }}
            title={`Created by ${creatorName}`}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={creatorName}
                className="w-[50px] h-[50px] rounded-full object-cover"
              />
            ) : (
              <div
                className={`w-[50px] h-[50px] rounded-full flex items-center justify-center text-sm font-semibold text-white ${colorForUser(creatorName)}`}
              >
                {getInitials(creatorName)}
              </div>
            )}
          </div>
        )
      })()}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] bg-neutral-800 border border-neutral-700 rounded-cf shadow-xl py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {MOVE_TARGETS.filter((t) => t.status !== task.status).map((target) => (
            <button
              key={target.status}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700 transition-colors"
              onClick={() => {
                onMoveTask?.(task.id, target.status)
                setContextMenu(null)
              }}
            >
              <ArrowRight size={13} className="text-neutral-500" />
              Move to {target.label}
            </button>
          ))}
          <div className="h-px bg-neutral-700 my-1" />
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700 transition-colors"
            onClick={() => {
              onLaunchSession?.(task)
              setContextMenu(null)
            }}
          >
            <Play size={13} className="text-codefire-orange" />
            Launch as CLI Session
          </button>
          <div className="h-px bg-neutral-700 my-1" />
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            onClick={() => {
              onDeleteTask?.(task.id)
              setContextMenu(null)
            }}
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

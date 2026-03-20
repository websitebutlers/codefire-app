import { useState, useCallback, useEffect, useRef } from 'react'
import { api } from '@renderer/lib/api'
import {
  DndContext,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import type { TaskItem, AppConfig } from '@shared/models'
import KanbanColumn from './KanbanColumn'
import TaskDetailSheet from './TaskDetailSheet'
import TaskCreateModal from './TaskCreateModal'
import TaskCard from './TaskCard'

interface KanbanBoardProps {
  todoTasks: TaskItem[]
  inProgressTasks: TaskItem[]
  doneTasks: TaskItem[]
  onUpdateTask: (
    id: number,
    data: {
      title?: string
      description?: string
      status?: string
      priority?: number
      labels?: string[]
    }
  ) => Promise<void>
  onDeleteTask: (id: number) => Promise<void>
  onAddTask: (title: string, status?: string) => Promise<unknown>
  /** Map of projectId → projectName, for showing project badge on task cards in global view */
  projectNames?: Record<string, string>
  /** Map of projectId → project color */
  projectColors?: Record<string, string | null>
  /** Map of projectId → group/client color */
  projectGroupColors?: Record<string, string | null>
  /** Project path for launching CLI sessions */
  projectPath?: string
  /** Project ID for task creation */
  projectId?: string
  /** Ref to pause/resume polling in parent hook during drag operations */
  pollingPaused?: React.MutableRefObject<boolean>
}

const COLUMNS = [
  { id: 'todo', title: 'Todo', color: 'text-orange-400', icon: 'circle' as const },
  { id: 'in_progress', title: 'In Progress', color: 'text-blue-400', icon: 'circle-dot' as const },
  { id: 'done', title: 'Done', color: 'text-green-400', icon: 'check-circle' as const },
] as const

const COLUMN_IDS = new Set<string>(COLUMNS.map((c) => c.id))

export default function KanbanBoard({
  todoTasks,
  inProgressTasks,
  doneTasks,
  onUpdateTask,
  onDeleteTask,
  onAddTask,
  projectNames,
  projectColors,
  projectGroupColors,
  projectPath,
  projectId,
  pollingPaused,
}: KanbanBoardProps) {
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)
  const [activeTask, setActiveTask] = useState<TaskItem | null>(null)
  const [overColumnId, setOverColumnId] = useState<string | null>(null)
  const [createModalStatus, setCreateModalStatus] = useState<string | null>(null)

  // Map of display name → avatar URL for watermark icons on task cards
  const [memberAvatars, setMemberAvatars] = useState<Record<string, string>>({})
  const [localUserName, setLocalUserName] = useState<string>('')

  useEffect(() => {
    const map: Record<string, string> = {}
    // Local user avatar
    window.api.invoke('settings:get').then((config: unknown) => {
      const c = config as AppConfig | undefined
      if (c?.profileName) {
        setLocalUserName(c.profileName)
        if (c.profileAvatarUrl) {
          map[c.profileName] = c.profileAvatarUrl
        }
      }
      setMemberAvatars((prev) => ({ ...prev, ...map }))
    }).catch(() => {})
    // Team member avatars
    api.premium.getTeam().then((team) => {
      if (!team) return
      api.premium.listMembers(team.id).then((members) => {
        for (const m of members) {
          if (m.user?.displayName && m.user.avatarUrl) {
            map[m.user.displayName] = m.user.avatarUrl
          }
        }
        setMemberAvatars((prev) => ({ ...prev, ...map }))
      }).catch(() => {})
    }).catch(() => {})
  }, [])

  // Local optimistic state: null means "use props", otherwise use this override
  const [optimisticTasks, setOptimisticTasks] = useState<Record<string, TaskItem[]> | null>(null)
  // Track what move we expect so we only clear optimistic state when props confirm it
  const pendingMove = useRef<{ taskId: number; targetColumn: string } | null>(null)

  // Clear optimistic state only when incoming props confirm the task is in the target column
  useEffect(() => {
    if (!pendingMove.current) return
    const { taskId, targetColumn } = pendingMove.current
    const allIncoming = [...todoTasks, ...inProgressTasks, ...doneTasks]
    const task = allIncoming.find((t) => t.id === taskId)
    if (task && task.status === targetColumn) {
      // Server confirmed the move — safe to clear optimistic state
      setOptimisticTasks(null)
      pendingMove.current = null
    }
    // If not confirmed yet, keep showing optimistic state (stale fetch in flight)
  }, [todoTasks, inProgressTasks, doneTasks])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  const allTasks = useCallback(() => {
    return [...todoTasks, ...inProgressTasks, ...doneTasks]
  }, [todoTasks, inProgressTasks, doneTasks])

  const getTasksForColumn = (columnId: string): TaskItem[] => {
    if (optimisticTasks) {
      return optimisticTasks[columnId] || []
    }
    switch (columnId) {
      case 'todo':
        return todoTasks
      case 'in_progress':
        return inProgressTasks
      case 'done':
        return doneTasks
      default:
        return []
    }
  }

  const findTaskColumn = (taskId: string): string | null => {
    const id = Number(taskId)
    if (optimisticTasks) {
      for (const [col, tasks] of Object.entries(optimisticTasks)) {
        if (tasks.some((t) => t.id === id)) return col
      }
      return null
    }
    if (todoTasks.some((t) => t.id === id)) return 'todo'
    if (inProgressTasks.some((t) => t.id === id)) return 'in_progress'
    if (doneTasks.some((t) => t.id === id)) return 'done'
    return null
  }

  const resolveColumnId = (id: string | number): string | null => {
    const idStr = String(id)
    if (COLUMN_IDS.has(idStr)) return idStr
    return findTaskColumn(idStr)
  }

  const handleDragStart = (event: DragStartEvent) => {
    const task = allTasks().find((t) => String(t.id) === String(event.active.id))
    setActiveTask(task || null)
    // Pause polling while dragging to prevent stale fetches from disrupting the UI
    if (pollingPaused) pollingPaused.current = true
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over) {
      setOverColumnId(null)
      return
    }
    setOverColumnId(resolveColumnId(over.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    // Always clear drag state
    setActiveTask(null)
    setOverColumnId(null)

    if (!over) {
      // No drop target — resume polling
      if (pollingPaused) pollingPaused.current = false
      return
    }

    const taskId = Number(active.id)
    const sourceColumn = findTaskColumn(String(active.id))
    const targetColumn = resolveColumnId(over.id)

    if (!targetColumn || !sourceColumn || targetColumn === sourceColumn) {
      // No actual move — resume polling
      if (pollingPaused) pollingPaused.current = false
      return
    }

    // Optimistic update: move the task in local state immediately
    const task = allTasks().find((t) => t.id === taskId)
    if (!task) {
      if (pollingPaused) pollingPaused.current = false
      return
    }

    const updatedTask = { ...task, status: targetColumn }
    const newState: Record<string, TaskItem[]> = {
      todo: todoTasks.filter((t) => t.id !== taskId),
      in_progress: inProgressTasks.filter((t) => t.id !== taskId),
      done: doneTasks.filter((t) => t.id !== taskId),
    }
    newState[targetColumn] = [...newState[targetColumn], updatedTask]
    setOptimisticTasks(newState)
    pendingMove.current = { taskId, targetColumn }

    // Fire-and-forget the backend update; resume polling after it completes
    onUpdateTask(taskId, { status: targetColumn })
      .then(() => {
        // Resume polling — the next fetch will confirm the move
        if (pollingPaused) pollingPaused.current = false
      })
      .catch(() => {
        // Revert optimistic update on failure
        setOptimisticTasks(null)
        pendingMove.current = null
        if (pollingPaused) pollingPaused.current = false
      })
  }

  const handleDragCancel = () => {
    setActiveTask(null)
    setOverColumnId(null)
    if (pollingPaused) pollingPaused.current = false
  }

  const handleMoveTask = useCallback((taskId: number, newStatus: string) => {
    onUpdateTask(taskId, { status: newStatus })
  }, [onUpdateTask])

  const handleLaunchSession = useCallback(async (task: TaskItem) => {
    try {
      const config = await window.api.invoke('settings:get') as { preferredCLI?: string; cliExtraArgs?: string }
      const cli = config?.preferredCLI ?? 'claude'
      const extraArgs = config?.cliExtraArgs ?? ''
      let prompt = task.title
      if (task.description) prompt += '\n\n' + task.description
      const escaped = prompt
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
        .replace(/\n/g, '\\n')
      const command = extraArgs ? `${cli} ${extraArgs} "${escaped}"` : `${cli} "${escaped}"`
      const termId = `task-${task.id}-${Date.now()}`
      const path = projectPath || ''
      await window.api.invoke('terminal:create', termId, path)
      setTimeout(() => {
        window.api.send('terminal:write', termId, command + '\n')
      }, 300)
    } catch (err) {
      console.error('Failed to launch CLI session:', err)
    }
  }, [projectPath])

  const handleDeleteTask = useCallback((taskId: number) => {
    onDeleteTask(taskId)
  }, [onDeleteTask])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex h-full p-3 gap-3">
        <div className="flex-1 grid grid-cols-3 gap-3 min-h-0 min-w-0">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={col.title}
              color={col.color}
              icon={col.icon}
              tasks={getTasksForColumn(col.id)}
              isDropTarget={overColumnId === col.id}
              onTaskClick={(task) => setSelectedTask(task)}
              onAddTask={(title) => onAddTask(title, col.id)}
              onOpenCreateModal={() => setCreateModalStatus(col.id)}
              onMoveTask={handleMoveTask}
              onLaunchSession={handleLaunchSession}
              onDeleteTask={handleDeleteTask}
              projectNames={projectNames}
              projectColors={projectColors}
              projectGroupColors={projectGroupColors}
              memberAvatars={memberAvatars}
              localUserName={localUserName}
            />
          ))}
        </div>

        <TaskCreateModal
          open={createModalStatus !== null}
          onClose={() => setCreateModalStatus(null)}
          defaultStatus={createModalStatus ?? 'todo'}
          onCreate={async (data) => {
            if (!projectId) {
              // Fallback: use old two-step approach
              const task = await onAddTask(data.title, data.status) as TaskItem | undefined
              if (task && (data.priority || data.labels.length || data.description)) {
                await onUpdateTask(task.id, {
                  ...(data.description ? { description: data.description } : {}),
                  ...(data.priority ? { priority: data.priority } : {}),
                  ...(data.labels.length ? { labels: data.labels } : {}),
                })
              }
              return
            }
            // Create with all fields at once to avoid two-step create+update race
            const task = await api.tasks.create({
              projectId,
              title: data.title,
              description: data.description,
              priority: data.priority,
              labels: data.labels.length > 0 ? data.labels : undefined,
              source: 'manual',
              isGlobal: projectId === '__global__',
            })
            // Set non-default status if needed, and trigger refetch
            const statusUpdate = data.status && data.status !== 'todo' ? { status: data.status } : {}
            await onUpdateTask(task.id, { title: data.title, ...statusUpdate })
          }}
        />
      </div>

      {selectedTask && (
        <TaskDetailSheet
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={async (id, data) => {
            await onUpdateTask(id, data)
            const tasks = [...todoTasks, ...inProgressTasks, ...doneTasks]
            const updated = tasks.find((t) => t.id === id)
            if (updated) {
              const merged = { ...updated, ...data } as Record<string, unknown>
              // labels is stored as JSON string in the model but passed as string[] in the update
              if (data.labels) {
                merged.labels = JSON.stringify(data.labels)
              }
              setSelectedTask(merged as unknown as TaskItem)
            }
          }}
          onDelete={onDeleteTask}
        />
      )}

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-[280px] opacity-90 rotate-2">
            <TaskCard
              task={activeTask}
              onClick={() => {}}
              projectName={projectNames?.[activeTask.projectId]}
              projectColor={projectColors?.[activeTask.projectId]}
              groupColor={projectGroupColors?.[activeTask.projectId]}
              memberAvatars={memberAvatars}
              localUserName={localUserName}
              isDragOverlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

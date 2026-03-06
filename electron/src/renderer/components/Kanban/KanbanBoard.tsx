import { useState } from 'react'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core'
import type { TaskItem } from '@shared/models'
import KanbanColumn from './KanbanColumn'
import TaskDetailSheet from './TaskDetailSheet'

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
}

const COLUMNS = [
  { id: 'todo', title: 'Todo', color: 'bg-neutral-400' },
  { id: 'in_progress', title: 'In Progress', color: 'bg-codefire-orange' },
  { id: 'done', title: 'Done', color: 'bg-success' },
] as const

export default function KanbanBoard({
  todoTasks,
  inProgressTasks,
  doneTasks,
  onUpdateTask,
  onDeleteTask,
  onAddTask,
}: KanbanBoardProps) {
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  const getTasksForColumn = (columnId: string): TaskItem[] => {
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
    if (todoTasks.some((t) => t.id === id)) return 'todo'
    if (inProgressTasks.some((t) => t.id === id)) return 'in_progress'
    if (doneTasks.some((t) => t.id === id)) return 'done'
    return null
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return

    const taskId = Number(active.id)
    const sourceColumn = findTaskColumn(String(active.id))

    // Determine target column — over could be a column or a task within a column
    let targetColumn: string | null = null
    if (COLUMNS.some((c) => c.id === over.id)) {
      targetColumn = over.id as string
    } else {
      targetColumn = findTaskColumn(String(over.id))
    }

    if (!targetColumn || targetColumn === sourceColumn) return

    await onUpdateTask(taskId, { status: targetColumn })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full p-3 gap-3">
        <div className="flex-1 grid grid-cols-3 gap-3 min-h-0 min-w-0">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={col.title}
              color={col.color}
              tasks={getTasksForColumn(col.id)}
              onTaskClick={(task) => setSelectedTask(task)}
              onAddTask={(title) => onAddTask(title, col.id)}
            />
          ))}
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
      </div>
    </DndContext>
  )
}

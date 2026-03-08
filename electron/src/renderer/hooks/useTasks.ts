import { useState, useEffect, useCallback, useRef } from 'react'
import type { TaskItem, TaskNote } from '@shared/models'
import { api } from '@renderer/lib/api'

export function useTasks(projectId: string) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const initialLoadDone = useRef(false)

  const fetchTasks = useCallback(async () => {
    try {
      if (!initialLoadDone.current) setLoading(true)
      setError(null)
      const data = await api.tasks.list(projectId)
      setTasks(data)
      initialLoadDone.current = true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchTasks()
    const interval = setInterval(fetchTasks, 5000)
    return () => clearInterval(interval)
  }, [fetchTasks])

  const createTask = useCallback(
    async (title: string, status?: string) => {
      const task = await api.tasks.create({ projectId, title })
      if (status && status !== 'todo') {
        await api.tasks.update(task.id, { status })
      }
      await fetchTasks()
      return task
    },
    [projectId, fetchTasks]
  )

  const updateTask = useCallback(
    async (
      id: number,
      data: {
        title?: string
        description?: string
        status?: string
        priority?: number
        labels?: string[]
      }
    ) => {
      await api.tasks.update(id, data)
      await fetchTasks()
    },
    [fetchTasks]
  )

  const deleteTask = useCallback(
    async (id: number) => {
      await api.tasks.delete(id)
      await fetchTasks()
    },
    [fetchTasks]
  )

  // Group tasks by status
  const todoTasks = tasks.filter((t) => t.status === 'todo')
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress')
  const doneTasks = tasks.filter((t) => t.status === 'done')

  return {
    tasks,
    todoTasks,
    inProgressTasks,
    doneTasks,
    loading,
    error,
    createTask,
    updateTask,
    deleteTask,
    refetch: fetchTasks,
  }
}

export function useTaskNotes(taskId: number | null) {
  const [notes, setNotes] = useState<TaskNote[]>([])
  const [loading, setLoading] = useState(false)

  const fetchNotes = useCallback(async () => {
    if (taskId === null) {
      setNotes([])
      return
    }
    setLoading(true)
    try {
      const data = await api.taskNotes.list(taskId)
      setNotes(data)
    } catch {
      setNotes([])
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  const addNote = useCallback(
    async (content: string) => {
      if (taskId === null) return
      await api.taskNotes.create({ taskId, content, source: 'manual' })
      await fetchNotes()
    },
    [taskId, fetchNotes]
  )

  const deleteNote = useCallback(
    async (noteId: number) => {
      await api.taskNotes.delete(noteId)
      await fetchNotes()
    },
    [fetchNotes]
  )

  return { notes, loading, addNote, deleteNote, refetch: fetchNotes }
}

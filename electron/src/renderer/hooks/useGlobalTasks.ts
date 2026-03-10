import { useState, useEffect, useCallback } from 'react'
import type { TaskItem } from '@shared/models'
import { api } from '@renderer/lib/api'

export function useGlobalTasks() {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      // Fetch all projects, then fetch tasks for each + global tasks
      const projects = await api.projects.list()
      const projectIds = projects.map((p) => p.id)
      const allResults = await Promise.all([
        api.tasks.listGlobal(),
        ...projectIds.map((id) => api.tasks.list(id)),
      ])
      // Deduplicate by task id (global tasks might also appear in a project list)
      const seen = new Set<number>()
      const merged: TaskItem[] = []
      for (const batch of allResults) {
        for (const task of batch) {
          if (!seen.has(task.id)) {
            seen.add(task.id)
            merged.push(task)
          }
        }
      }
      // Sort by most recently updated first (updatedAt falls back to createdAt)
      merged.sort((a, b) => {
        const aTime = a.updatedAt || a.createdAt || ''
        const bTime = b.updatedAt || b.createdAt || ''
        return bTime.localeCompare(aTime)
      })
      setTasks(merged)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTasks()
    const interval = setInterval(fetchTasks, 5000)
    // Listen for cross-window task updates (from other windows or MCP)
    const unsub = window.api.on('tasks:updated', () => {
      fetchTasks()
    })
    return () => {
      clearInterval(interval)
      unsub()
    }
  }, [fetchTasks])

  const createTask = useCallback(
    async (title: string, status?: string) => {
      const task = await api.tasks.create({
        projectId: '__global__',
        title,
        isGlobal: true,
      })
      if (status && status !== 'todo') {
        await api.tasks.update(task.id, { status })
      }
      await fetchTasks()
      return task
    },
    [fetchTasks]
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

  const sortByRecent = (a: TaskItem, b: TaskItem) => {
    const aTime = a.updatedAt || a.createdAt || ''
    const bTime = b.updatedAt || b.createdAt || ''
    return bTime.localeCompare(aTime)
  }
  const todoTasks = tasks.filter((t) => t.status === 'todo').sort(sortByRecent)
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress').sort(sortByRecent)
  const doneTasks = tasks.filter((t) => t.status === 'done').sort(sortByRecent)

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

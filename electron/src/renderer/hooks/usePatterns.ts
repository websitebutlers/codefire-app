import { useState, useEffect, useCallback } from 'react'
import type { Pattern } from '@shared/models'
import { api } from '@renderer/lib/api'

export function usePatterns(projectId: string) {
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPatterns = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [data, cats] = await Promise.all([
        api.patterns.list(projectId, selectedCategory ?? undefined),
        api.patterns.categories(projectId),
      ])
      setPatterns(data)
      setCategories(cats)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load patterns')
    } finally {
      setLoading(false)
    }
  }, [projectId, selectedCategory])

  useEffect(() => {
    fetchPatterns()
  }, [fetchPatterns])

  const createPattern = useCallback(
    async (data: { category: string; title: string; description: string }) => {
      const pattern = await api.patterns.create({ projectId, ...data })
      await fetchPatterns()
      return pattern
    },
    [projectId, fetchPatterns]
  )

  const updatePattern = useCallback(
    async (id: number, data: { category?: string; title?: string; description?: string }) => {
      const updated = await api.patterns.update(id, data)
      await fetchPatterns()
      return updated
    },
    [fetchPatterns]
  )

  const deletePattern = useCallback(
    async (id: number) => {
      await api.patterns.delete(id)
      await fetchPatterns()
    },
    [fetchPatterns]
  )

  return {
    patterns,
    categories,
    selectedCategory,
    setSelectedCategory,
    loading,
    error,
    createPattern,
    updatePattern,
    deletePattern,
    refetch: fetchPatterns,
  }
}

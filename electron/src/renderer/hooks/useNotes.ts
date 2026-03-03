import { useState, useEffect, useCallback, useRef } from 'react'
import type { Note } from '@shared/models'
import { api } from '@renderer/lib/api'

export function useNotes(projectId: string) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const fetchNotes = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.notes.list(projectId)
      // Sort: pinned first, then by updatedAt descending
      data.sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned - a.pinned
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      })
      setNotes(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  const searchNotes = useCallback(
    async (query: string) => {
      setSearchQuery(query)
      if (!query.trim()) {
        await fetchNotes()
        return
      }
      try {
        setLoading(true)
        const data = await api.notes.search(projectId, query)
        setNotes(data)
      } catch {
        // Fall back to full list on search error
        await fetchNotes()
      } finally {
        setLoading(false)
      }
    },
    [projectId, fetchNotes]
  )

  const createNote = useCallback(
    async (title: string) => {
      const note = await api.notes.create({ projectId, title, content: '' })
      await fetchNotes()
      return note
    },
    [projectId, fetchNotes]
  )

  const updateNote = useCallback(
    async (id: number, data: { title?: string; content?: string; pinned?: boolean }) => {
      await api.notes.update(id, data)
      await fetchNotes()
    },
    [fetchNotes]
  )

  const deleteNote = useCallback(
    async (id: number) => {
      await api.notes.delete(id)
      await fetchNotes()
    },
    [fetchNotes]
  )

  const togglePin = useCallback(
    async (note: Note) => {
      await api.notes.update(note.id, { pinned: !note.pinned })
      await fetchNotes()
    },
    [fetchNotes]
  )

  return {
    notes,
    loading,
    error,
    searchQuery,
    searchNotes,
    createNote,
    updateNote,
    deleteNote,
    togglePin,
    refetch: fetchNotes,
  }
}

/**
 * Debounced auto-save hook for note content.
 */
export function useAutoSave(
  noteId: number | null,
  onSave: (id: number, data: { content: string }) => Promise<void>,
  delay = 1000
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<string | null>(null)

  const save = useCallback(
    (content: string) => {
      if (noteId === null) return
      pendingRef.current = content

      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(async () => {
        if (pendingRef.current !== null && noteId !== null) {
          await onSave(noteId, { content: pendingRef.current })
          pendingRef.current = null
        }
      }, delay)
    },
    [noteId, onSave, delay]
  )

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      // Fire final save synchronously if there's pending content
      if (pendingRef.current !== null && noteId !== null) {
        onSave(noteId, { content: pendingRef.current }).catch(() => {})
      }
    }
  }, [noteId, onSave])

  return save
}

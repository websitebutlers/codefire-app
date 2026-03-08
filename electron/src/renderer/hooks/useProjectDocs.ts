import { useState, useEffect, useCallback } from 'react'
import { api } from '@renderer/lib/api'

export interface LocalDoc {
  id: number
  projectId: string
  title: string
  content: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export function useProjectDocs(projectId: string) {
  const [docs, setDocs] = useState<LocalDoc[]>([])
  const [selectedDoc, setSelectedDoc] = useState<LocalDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDocs = useCallback(async () => {
    try {
      setError(null)
      const data = await api.docs.list(projectId)
      setDocs(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to load docs')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    fetchDocs()
  }, [fetchDocs])

  const selectDoc = useCallback((docId: number) => {
    const doc = docs.find(d => d.id === docId)
    if (doc) setSelectedDoc(doc)
  }, [docs])

  const createDoc = useCallback(async (title: string, content: string = '') => {
    const doc = await api.docs.create({ projectId, title, content })
    await fetchDocs()
    setSelectedDoc(doc)
    return doc
  }, [projectId, fetchDocs])

  const updateDoc = useCallback(async (docId: number, data: { title?: string; content?: string }) => {
    const updated = await api.docs.update(docId, data)
    await fetchDocs()
    if (selectedDoc?.id === docId) {
      setSelectedDoc(updated)
    }
    return updated
  }, [fetchDocs, selectedDoc])

  const deleteDoc = useCallback(async (docId: number) => {
    await api.docs.delete(docId)
    if (selectedDoc?.id === docId) {
      setSelectedDoc(null)
    }
    await fetchDocs()
  }, [fetchDocs, selectedDoc])

  return {
    docs,
    selectedDoc,
    selectDoc,
    createDoc,
    updateDoc,
    deleteDoc,
    loading,
    error,
    refresh: fetchDocs,
  }
}

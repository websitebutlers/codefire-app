import { useState, useEffect, useRef, useCallback } from 'react'
import { Save } from 'lucide-react'
import type { LocalDoc } from '@renderer/hooks/useProjectDocs'

interface DocEditorProps {
  doc: LocalDoc
  onUpdate: (docId: number, data: { title?: string; content?: string }) => Promise<any>
}

export default function DocEditor({ doc, onUpdate }: DocEditorProps) {
  const [title, setTitle] = useState(doc.title)
  const [content, setContent] = useState(doc.content)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef({ title, content })

  // Reset when doc changes
  useEffect(() => {
    setTitle(doc.title)
    setContent(doc.content)
    setLastSaved(null)
    latestRef.current = { title: doc.title, content: doc.content }
  }, [doc.id, doc.title, doc.content])

  const save = useCallback(async (t: string, c: string) => {
    setSaving(true)
    try {
      await onUpdate(doc.id, { title: t, content: c })
      setLastSaved(new Date().toLocaleTimeString())
    } catch {
      // silently fail
    } finally {
      setSaving(false)
    }
  }, [doc.id, onUpdate])

  const scheduleSave = useCallback((t: string, c: string) => {
    latestRef.current = { title: t, content: c }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      save(latestRef.current.title, latestRef.current.content)
    }, 1000)
  }, [save])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle)
    scheduleSave(newTitle, content)
  }

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
    scheduleSave(title, newContent)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Title input */}
      <div className="px-4 pt-3 pb-2 border-b border-neutral-800 shrink-0">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Document title"
          className="w-full bg-transparent text-sm font-semibold text-neutral-200 placeholder-neutral-600 outline-none"
        />
        <div className="flex items-center gap-2 mt-1">
          {saving && (
            <span className="text-[10px] text-neutral-500 flex items-center gap-1">
              <Save size={10} className="animate-pulse" /> Saving...
            </span>
          )}
          {!saving && lastSaved && (
            <span className="text-[10px] text-neutral-600">
              Saved at {lastSaved}
            </span>
          )}
        </div>
      </div>

      {/* Content textarea */}
      <textarea
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
        placeholder="Start writing..."
        className="flex-1 w-full px-4 py-3 bg-transparent text-xs text-neutral-300 placeholder-neutral-600 outline-none resize-none font-mono leading-relaxed"
        spellCheck={false}
      />
    </div>
  )
}

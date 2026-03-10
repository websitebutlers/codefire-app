import { useState, useEffect } from 'react'
import { Pin, PinOff, Trash2, Users } from 'lucide-react'
import MDEditor from '@uiw/react-md-editor'
import type { Note } from '@shared/models'
import { useAutoSave } from '@renderer/hooks/useNotes'

interface NoteEditorProps {
  note: Note | null
  onUpdate: (id: number, data: { title?: string; content?: string; pinned?: boolean }) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onTogglePin: (note: Note) => Promise<void>
}

export default function NoteEditor({ note, onUpdate, onDelete, onTogglePin }: NoteEditorProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  // Sync state when note changes
  useEffect(() => {
    if (note) {
      setTitle(note.title)
      setContent(note.content || '')
    }
  }, [note?.id])

  // Auto-save content with 1s debounce
  const autoSave = useAutoSave(note?.id ?? null, onUpdate, 1000)

  if (!note) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Select a note to edit, or create a new one
      </div>
    )
  }

  const handleContentChange = (value: string | undefined) => {
    const newContent = value ?? ''
    setContent(newContent)
    autoSave(newContent)
  }

  const handleTitleBlur = () => {
    if (title !== note.title && title.trim()) {
      onUpdate(note.id, { title })
    }
  }

  return (
    <div className="flex flex-col h-full" data-color-mode="dark">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
        <input
          className="flex-1 bg-transparent text-title text-neutral-100 font-medium
                     focus:outline-none placeholder-neutral-500"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          placeholder="Note title..."
        />
        {note.remoteOwnerName && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 flex items-center gap-1 shrink-0">
            <Users size={9} />
            {note.remoteOwnerName}
          </span>
        )}
        <button
          className={`p-1.5 rounded-cf transition-colors
            ${note.pinned ? 'text-codefire-orange hover:text-codefire-orange-hover' : 'text-neutral-500 hover:text-neutral-300'}`}
          onClick={() => onTogglePin(note)}
          title={note.pinned ? 'Unpin note' : 'Pin note'}
        >
          {note.pinned ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
        <button
          className="p-1.5 rounded-cf text-neutral-500 hover:text-red-400 transition-colors"
          onClick={() => {
            if (confirm('Delete this note?')) onDelete(note.id)
          }}
          title="Delete note"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Markdown editor */}
      <div className="flex-1 overflow-hidden">
        <MDEditor
          value={content}
          onChange={handleContentChange}
          preview="live"
          height="100%"
          visibleDragbar={false}
          hideToolbar={false}
          style={{
            backgroundColor: 'transparent',
            height: '100%',
          }}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-neutral-800 shrink-0">
        <span className="text-xs text-neutral-600">
          Updated{' '}
          {new Date(note.updatedAt).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
        <span className="text-xs text-neutral-600">
          {content.length} chars
        </span>
      </div>
    </div>
  )
}

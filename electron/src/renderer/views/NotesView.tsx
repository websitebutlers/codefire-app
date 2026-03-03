import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Note } from '@shared/models'
import { useNotes } from '@renderer/hooks/useNotes'
import NoteList from '@renderer/components/Notes/NoteList'
import NoteEditor from '@renderer/components/Notes/NoteEditor'

interface NotesViewProps {
  projectId: string
}

export default function NotesView({ projectId }: NotesViewProps) {
  const {
    notes,
    loading,
    error,
    searchQuery,
    searchNotes,
    createNote,
    updateNote,
    deleteNote,
    togglePin,
  } = useNotes(projectId)

  const [selectedNote, setSelectedNote] = useState<Note | null>(null)

  const handleNew = async () => {
    const note = await createNote('Untitled Note')
    setSelectedNote(note)
  }

  const handleDelete = async (id: number) => {
    await deleteNote(id)
    if (selectedNote?.id === id) {
      setSelectedNote(null)
    }
  }

  const handleTogglePin = async (note: Note) => {
    await togglePin(note)
    // Refresh selected note to reflect pin state
    if (selectedNote?.id === note.id) {
      setSelectedNote({ ...note, pinned: note.pinned ? 0 : 1 })
    }
  }

  if (loading && notes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-error">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Note list panel */}
      <div className="w-72 border-r border-neutral-800 shrink-0">
        <NoteList
          notes={notes}
          selectedId={selectedNote?.id ?? null}
          searchQuery={searchQuery}
          onSelect={setSelectedNote}
          onSearch={searchNotes}
          onNew={handleNew}
        />
      </div>

      {/* Editor panel */}
      <div className="flex-1">
        <NoteEditor
          note={selectedNote}
          onUpdate={updateNote}
          onDelete={handleDelete}
          onTogglePin={handleTogglePin}
        />
      </div>
    </div>
  )
}

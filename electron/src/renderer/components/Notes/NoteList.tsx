import { Pin, FileText, Plus, Search, Users } from 'lucide-react'
import type { Note } from '@shared/models'

interface NoteListProps {
  notes: Note[]
  selectedId: number | null
  searchQuery: string
  onSelect: (note: Note) => void
  onSearch: (query: string) => void
  onNew: () => void
}

export default function NoteList({
  notes,
  selectedId,
  searchQuery,
  onSelect,
  onSearch,
  onNew,
}: NoteListProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Search + New button */}
      <div className="px-3 py-2 border-b border-neutral-800 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search
              size={14}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500"
            />
            <input
              className="w-full bg-neutral-800 border border-neutral-700 rounded-cf pl-7 pr-2 py-1.5
                         text-sm text-neutral-200 placeholder-neutral-500
                         focus:outline-none focus:border-codefire-orange/50"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          <button
            className="px-2 py-1.5 bg-codefire-orange/20 text-codefire-orange rounded-cf
                       hover:bg-codefire-orange/30 transition-colors shrink-0"
            onClick={onNew}
            title="New note"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <FileText size={24} className="text-neutral-600 mb-2" />
            <p className="text-sm text-neutral-500">
              {searchQuery ? 'No notes match your search' : 'No notes yet'}
            </p>
          </div>
        ) : (
          notes.map((note) => {
            const isSelected = note.id === selectedId
            const preview = note.content
              ? note.content.slice(0, 120).replace(/\n/g, ' ')
              : ''

            return (
              <button
                key={note.id}
                className={`w-full text-left px-3 py-2.5 border-b border-neutral-800/50 transition-colors
                  ${
                    isSelected
                      ? 'bg-neutral-800 border-l-2 border-l-codefire-orange'
                      : 'hover:bg-neutral-800/50 border-l-2 border-l-transparent'
                  }`}
                onClick={() => onSelect(note)}
              >
                <div className="flex items-center gap-1.5">
                  {note.pinned === 1 && (
                    <Pin size={12} className="text-codefire-orange shrink-0" />
                  )}
                  {note.remoteOwnerName && (
                    <span
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-500/25 text-indigo-300 text-[8px] font-bold shrink-0 ring-1 ring-indigo-500/40"
                      title={note.remoteOwnerName}
                    >
                      {note.remoteOwnerName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="text-sm text-neutral-200 truncate font-medium">
                    {note.title}
                  </span>
                </div>
                {preview && (
                  <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{preview}</p>
                )}
                <div className="flex items-center gap-2 text-xs text-neutral-600 mt-1">
                  {note.remoteOwnerName && (
                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-indigo-500/20 text-indigo-300 flex items-center gap-0.5">
                      <Users size={8} />
                      TEAM
                    </span>
                  )}
                  <span>
                    {new Date(note.updatedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

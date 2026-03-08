import { Plus, FileText, Trash2 } from 'lucide-react'
import type { LocalDoc } from '@renderer/hooks/useProjectDocs'

interface DocSidebarProps {
  docs: LocalDoc[]
  selectedDocId: number | null
  onSelect: (docId: number) => void
  onCreate: () => void
  onDelete: (docId: number) => void
}

export default function DocSidebar({ docs, selectedDocId, onSelect, onCreate, onDelete }: DocSidebarProps) {
  return (
    <div className="flex flex-col h-full border-r border-neutral-800 bg-neutral-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 shrink-0">
        <span className="text-xs font-medium text-neutral-400">Docs</span>
        <button
          onClick={onCreate}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-codefire-orange transition-colors"
          title="New doc"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Doc list */}
      <div className="flex-1 overflow-y-auto py-1">
        {docs.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <FileText size={20} className="mx-auto text-neutral-700 mb-2" />
            <p className="text-[10px] text-neutral-600">No docs yet</p>
          </div>
        ) : (
          docs.map((doc) => (
            <div
              key={doc.id}
              className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                selectedDocId === doc.id
                  ? 'bg-neutral-800 text-neutral-200'
                  : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300'
              }`}
              onClick={() => onSelect(doc.id)}
            >
              <FileText size={13} className="shrink-0" />
              <span className="text-xs truncate flex-1">{doc.title || 'Untitled'}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(doc.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-neutral-700 text-neutral-500 hover:text-red-400 transition-all"
                title="Delete doc"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

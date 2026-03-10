import { X, Plus, Loader2, Globe } from 'lucide-react'
import type { BrowserTab } from '@renderer/hooks/useBrowserTabs'

interface BrowserTabStripProps {
  tabs: BrowserTab[]
  activeTabId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
}

export default function BrowserTabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onAdd,
}: BrowserTabStripProps) {
  return (
    <div className="flex items-center bg-neutral-900 border-b border-neutral-800 h-8">
      <div className="flex-1 flex items-center overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={`flex items-center gap-1.5 px-3 h-8 text-xs border-r border-neutral-800 shrink-0 max-w-[180px] group transition-colors ${
              tab.id === activeTabId
                ? 'bg-neutral-800 text-neutral-200'
                : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50'
            }`}
          >
            {tab.isLoading ? (
              <Loader2 size={10} className="text-codefire-orange animate-spin shrink-0" />
            ) : (
              <Globe size={10} className={`shrink-0 ${tab.id === activeTabId ? 'text-neutral-400' : 'text-neutral-600'}`} />
            )}
            <span className="truncate">{tab.title}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
              className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all ml-1 shrink-0"
            >
              <X size={10} />
            </button>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="px-2 h-8 text-neutral-500 hover:text-neutral-300 transition-colors shrink-0"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}

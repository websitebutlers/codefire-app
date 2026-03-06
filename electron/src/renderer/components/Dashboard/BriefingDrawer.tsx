import { useState, useEffect, useCallback } from 'react'
import {
  X, RefreshCw, Loader2, Newspaper, ExternalLink,
  Bookmark, BookmarkCheck, ChevronDown, ChevronRight,
} from 'lucide-react'
import type { BriefingDigest, BriefingItem } from '@shared/models'
import { api } from '@renderer/lib/api'

interface BriefingDrawerProps {
  projectId: string
  onClose: () => void
}

const SOURCE_COLORS: Record<string, string> = {
  'Hacker News': 'bg-orange-500/20 text-orange-400',
  Reddit: 'bg-blue-500/20 text-blue-400',
  GitHub: 'bg-neutral-600/50 text-neutral-300',
  'Dev.to': 'bg-green-500/20 text-green-400',
  RSS: 'bg-purple-500/20 text-purple-400',
}

const CATEGORY_LABELS: Record<string, string> = {
  tech: 'Technology',
  ai: 'AI & ML',
  dev: 'Development',
  business: 'Business',
  security: 'Security',
  other: 'Other',
}

export default function BriefingDrawer({ projectId, onClose }: BriefingDrawerProps) {
  const [digests, setDigests] = useState<BriefingDigest[]>([])
  const [activeDigest, setActiveDigest] = useState<BriefingDigest | null>(null)
  const [items, setItems] = useState<BriefingItem[]>([])
  const [generating, setGenerating] = useState(false)
  const [showPast, setShowPast] = useState(false)

  const load = useCallback(async () => {
    const list = await api.briefing.listDigests()
    setDigests(list)
    if (list.length > 0 && !activeDigest) {
      setActiveDigest(list[0])
      const briefingItems = await api.briefing.getItems(list[0].id)
      setItems(briefingItems)
    }
  }, [activeDigest])

  useEffect(() => {
    load()
  }, [load])

  async function handleGenerate() {
    setGenerating(true)
    try {
      const digest = await api.briefing.generate(projectId)
      setActiveDigest(digest)
      const briefingItems = await api.briefing.getItems(digest.id)
      setItems(briefingItems)
      await load()
    } catch (err) {
      console.error('Failed to generate briefing:', err)
    } finally {
      setGenerating(false)
    }
  }

  async function handleSelectDigest(digest: BriefingDigest) {
    setActiveDigest(digest)
    const briefingItems = await api.briefing.getItems(digest.id)
    setItems(briefingItems)
  }

  async function handleMarkRead(itemId: number) {
    await api.briefing.markRead(itemId)
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, isRead: 1 } : i)))
  }

  async function handleSaveItem(itemId: number) {
    await api.briefing.saveItem(itemId)
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, isSaved: 1 } : i)))
  }

  // Group items by category
  const grouped = items.reduce<Record<string, BriefingItem[]>>((acc, item) => {
    const cat = item.category || 'other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {})

  return (
    <div className="fixed inset-y-0 right-0 w-[400px] z-50 flex flex-col bg-neutral-900/95 backdrop-blur-xl border-l border-neutral-700 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
          <Newspaper size={16} className="text-codefire-orange" />
          <span className="text-sm font-medium text-neutral-200">Briefing</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-40"
            title="Generate new briefing"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {generating ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Loader2 size={28} className="text-codefire-orange animate-spin mb-3" />
            <p className="text-sm text-neutral-400">Generating briefing...</p>
            <p className="text-xs text-neutral-600 mt-1">This may take a moment</p>
          </div>
        ) : !activeDigest || items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Newspaper size={32} className="text-neutral-700 mb-3" />
            <p className="text-sm text-neutral-500 mb-1">No briefing yet</p>
            <p className="text-xs text-neutral-600 mb-4">
              Generate a briefing to see tech news relevant to your projects.
            </p>
            <button
              onClick={handleGenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-codefire-orange/20 text-codefire-orange rounded hover:bg-codefire-orange/30 transition-colors"
            >
              <RefreshCw size={12} />
              Generate First Briefing
            </button>
          </div>
        ) : (
          <div className="p-3 space-y-4">
            {/* Active digest date */}
            <div className="text-[11px] text-neutral-500">
              Generated{' '}
              {new Date(activeDigest.generatedAt).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
              {' '}· {items.length} items
            </div>

            {/* Items by category */}
            {Object.entries(grouped)
              .sort(([, a], [, b]) => {
                const maxA = Math.max(...a.map((i) => i.relevanceScore))
                const maxB = Math.max(...b.map((i) => i.relevanceScore))
                return maxB - maxA
              })
              .map(([category, categoryItems]) => (
                <div key={category}>
                  <div className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-2">
                    {CATEGORY_LABELS[category] || category}
                  </div>
                  <div className="space-y-2">
                    {categoryItems
                      .sort((a, b) => b.relevanceScore - a.relevanceScore)
                      .map((item) => (
                        <BriefingItemCard
                          key={item.id}
                          item={item}
                          onMarkRead={() => handleMarkRead(item.id)}
                          onSave={() => handleSaveItem(item.id)}
                        />
                      ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Past Briefings */}
        {digests.length > 1 && (
          <div className="border-t border-neutral-800 mx-3 mt-4 pt-3 pb-4">
            <button
              onClick={() => setShowPast(!showPast)}
              className="flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              {showPast ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Past Briefings ({digests.length - 1})
            </button>
            {showPast && (
              <div className="mt-2 space-y-1">
                {digests.slice(1).map((digest) => (
                  <button
                    key={digest.id}
                    onClick={() => handleSelectDigest(digest)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                      activeDigest?.id === digest.id
                        ? 'bg-neutral-800 text-neutral-200'
                        : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50'
                    }`}
                  >
                    {new Date(digest.generatedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    <span className="text-neutral-600 ml-2">
                      {digest.itemCount} items
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function BriefingItemCard({
  item,
  onMarkRead,
  onSave,
}: {
  item: BriefingItem
  onMarkRead: () => void
  onSave: () => void
}) {
  const sourceColor = SOURCE_COLORS[item.sourceName] || 'bg-neutral-600/50 text-neutral-400'

  return (
    <div
      className={`rounded-lg p-3 border transition-colors ${
        item.isRead
          ? 'bg-neutral-800/30 border-neutral-800/50'
          : 'bg-neutral-800/60 border-neutral-700/50'
      }`}
      onClick={() => !item.isRead && onMarkRead()}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className={`text-xs font-medium leading-snug ${item.isRead ? 'text-neutral-500' : 'text-neutral-200'}`}>
          {item.title}
        </h4>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${sourceColor}`}>
          {item.sourceName}
        </span>
      </div>

      <p className={`text-[11px] leading-relaxed mb-2 ${item.isRead ? 'text-neutral-600' : 'text-neutral-400'}`}>
        {item.summary}
      </p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {item.sourceUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                window.api.invoke('shell:openExternal', item.sourceUrl)
              }}
              className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-codefire-orange transition-colors"
            >
              <ExternalLink size={10} />
              Open
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSave()
            }}
            className={`flex items-center gap-1 text-[10px] transition-colors ${
              item.isSaved
                ? 'text-codefire-orange'
                : 'text-neutral-500 hover:text-codefire-orange'
            }`}
          >
            {item.isSaved ? <BookmarkCheck size={10} /> : <Bookmark size={10} />}
            {item.isSaved ? 'Saved' : 'Save'}
          </button>
        </div>

        {/* Relevance indicator */}
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className={`w-1 h-1 rounded-full ${
                n <= Math.ceil(item.relevanceScore * 5)
                  ? 'bg-codefire-orange'
                  : 'bg-neutral-700'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Layers,
  Cpu,
  X,
  Check,
  Tag,
} from 'lucide-react'
import type { Pattern } from '@shared/models'
import { usePatterns } from '@renderer/hooks/usePatterns'

interface PatternsViewProps {
  projectId: string
}

const CATEGORY_COLORS: Record<string, string> = {
  architecture: 'bg-blue-500/20 text-blue-400',
  naming: 'bg-green-500/20 text-green-400',
  schema: 'bg-purple-500/20 text-purple-400',
  workflow: 'bg-orange-500/20 text-orange-400',
  testing: 'bg-cyan-500/20 text-cyan-400',
  styling: 'bg-pink-500/20 text-pink-400',
  error: 'bg-red-500/20 text-red-400',
}

function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat.toLowerCase()] ?? 'bg-neutral-500/20 text-neutral-400'
}

export default function PatternsView({ projectId }: PatternsViewProps) {
  const {
    patterns,
    categories,
    selectedCategory,
    setSelectedCategory,
    loading,
    error,
    createPattern,
    updatePattern,
    deletePattern,
  } = usePatterns(projectId)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formData, setFormData] = useState({ category: '', title: '', description: '' })

  const handleNew = () => {
    setEditingId(null)
    setFormData({ category: '', title: '', description: '' })
    setShowForm(true)
  }

  const handleEdit = (p: Pattern) => {
    setEditingId(p.id)
    setFormData({ category: p.category, title: p.title, description: p.description })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!formData.title.trim() || !formData.category.trim()) return
    if (editingId) {
      await updatePattern(editingId, formData)
    } else {
      await createPattern(formData)
    }
    setShowForm(false)
    setFormData({ category: '', title: '', description: '' })
    setEditingId(null)
  }

  const handleDelete = async (id: number) => {
    await deletePattern(id)
    if (editingId === id) {
      setShowForm(false)
      setEditingId(null)
    }
  }

  if (loading && patterns.length === 0) {
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

  // Group patterns by category
  const grouped = patterns.reduce<Record<string, Pattern[]>>((acc, p) => {
    const cat = p.category || 'uncategorized'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(p)
    return acc
  }, {})

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-codefire-orange" />
          <h2 className="text-sm font-semibold text-neutral-200">Pattern Library</h2>
          <span className="text-xs text-neutral-500">{patterns.length} patterns</span>
        </div>
        <button
          onClick={handleNew}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-neutral-300 bg-neutral-800 hover:bg-neutral-700 rounded-md transition-colors"
        >
          <Plus size={12} />
          Add Pattern
        </button>
      </div>

      {/* Category filter */}
      {categories.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-neutral-800/50 overflow-x-auto">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-2 py-0.5 text-[11px] rounded-full transition-colors ${
              !selectedCategory
                ? 'bg-codefire-orange/20 text-codefire-orange'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
              className={`px-2 py-0.5 text-[11px] rounded-full transition-colors ${
                selectedCategory === cat
                  ? categoryColor(cat)
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-800/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-neutral-400">
              {editingId ? 'Edit Pattern' : 'New Pattern'}
            </span>
            <button onClick={() => setShowForm(false)} className="text-neutral-500 hover:text-neutral-300">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 mb-2">
            <input
              type="text"
              placeholder="Category"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded text-neutral-200 placeholder-neutral-600"
              list="pattern-categories"
            />
            <datalist id="pattern-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <input
              type="text"
              placeholder="Title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded text-neutral-200 placeholder-neutral-600"
            />
          </div>
          <textarea
            placeholder="Description — what this pattern is, when to use it..."
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
            className="w-full px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded text-neutral-200 placeholder-neutral-600 resize-none mb-2"
          />
          <button
            onClick={handleSave}
            disabled={!formData.title.trim() || !formData.category.trim()}
            className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-white bg-codefire-orange hover:bg-codefire-orange-hover disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
          >
            <Check size={12} />
            {editingId ? 'Update' : 'Create'}
          </button>
        </div>
      )}

      {/* Pattern list */}
      <div className="flex-1 overflow-y-auto p-4">
        {patterns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Layers size={32} className="text-neutral-600 mb-3" />
            <p className="text-sm text-neutral-500 mb-1">No patterns yet</p>
            <p className="text-xs text-neutral-600">
              Add coding patterns, conventions, and architecture decisions
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-2">
                  <Tag size={12} className="text-neutral-500" />
                  <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                    {category}
                  </span>
                  <span className="text-[10px] text-neutral-600">{items.length}</span>
                </div>
                <div className="space-y-1.5">
                  {items.map((p) => (
                    <div
                      key={p.id}
                      className="group flex items-start gap-3 px-3 py-2.5 bg-neutral-800/40 hover:bg-neutral-800/70 rounded-lg border border-neutral-700/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-neutral-200">
                            {p.title}
                          </span>
                          {p.autoDetected === 1 && (
                            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-400">
                              <Cpu size={8} />
                              auto
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-400 mt-0.5 whitespace-pre-wrap">
                          {p.description}
                        </p>
                        <span className="text-[10px] text-neutral-600 mt-1 block">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => handleEdit(p)}
                          className="p-1 text-neutral-500 hover:text-neutral-300 rounded"
                          title="Edit"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="p-1 text-neutral-500 hover:text-red-400 rounded"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

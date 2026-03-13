import { useState, useEffect, useRef } from 'react'
import { X, FolderOpen } from 'lucide-react'
import type { Project, Client } from '@shared/models'
import { api } from '@renderer/lib/api'

const PROJECT_COLORS = [
  { name: 'Default', value: null },
  { name: 'Red', value: '#EF4444' },
  { name: 'Orange', value: '#F97316' },
  { name: 'Amber', value: '#F59E0B' },
  { name: 'Yellow', value: '#EAB308' },
  { name: 'Lime', value: '#84CC16' },
  { name: 'Green', value: '#22C55E' },
  { name: 'Teal', value: '#14B8A6' },
  { name: 'Cyan', value: '#06B6D4' },
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Indigo', value: '#6366F1' },
  { name: 'Purple', value: '#A855F7' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Rose', value: '#F43F5E' },
]

interface ProjectSettingsModalProps {
  project: Project
  clients: Client[]
  onClose: () => void
  onSaved: () => void
}

export default function ProjectSettingsModal({ project, clients, onClose, onSaved }: ProjectSettingsModalProps) {
  const [name, setName] = useState(project.name)
  const [color, setColor] = useState<string | null>(project.color)
  const [path, setPath] = useState(project.path)
  const [repoUrl, setRepoUrl] = useState(project.repoUrl ?? '')
  const [clientId, setClientId] = useState<string | null>(project.clientId)
  const [saving, setSaving] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handleSave() {
    setSaving(true)
    try {
      await api.projects.update(project.id, {
        name: name.trim() || project.name,
        color,
        path,
        clientId,
      })
      onSaved()
      onClose()
    } catch (err) {
      console.error('Failed to save project settings:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleChangeFolder() {
    const folderPath = await api.dialog.selectFolder()
    if (folderPath) setPath(folderPath)
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div className="w-[380px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-200">Project Settings</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          {/* Name */}
          <div>
            <label className="text-[11px] text-neutral-500 font-medium uppercase tracking-wider">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-codefire-orange"
            />
          </div>

          {/* Color */}
          <div>
            <label className="text-[11px] text-neutral-500 font-medium uppercase tracking-wider">Color</label>
            <div className="mt-1.5 grid grid-cols-7 gap-1.5">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c.name}
                  onClick={() => setColor(c.value)}
                  className={`w-6 h-6 rounded-full border transition-all hover:scale-110 ${
                    color === c.value || (!color && !c.value)
                      ? 'border-white ring-1 ring-white/50 scale-110'
                      : 'border-neutral-700 hover:border-neutral-500'
                  }`}
                  style={{ backgroundColor: c.value || '#525252' }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Local Folder */}
          <div>
            <label className="text-[11px] text-neutral-500 font-medium uppercase tracking-wider">Local Folder</label>
            <div className="mt-1 flex items-center gap-2">
              <span className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5 text-sm text-neutral-400 truncate">
                {path}
              </span>
              <button
                onClick={handleChangeFolder}
                className="p-1.5 rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.06] transition-colors"
                title="Change folder"
              >
                <FolderOpen size={14} />
              </button>
            </div>
          </div>

          {/* Repo URL */}
          <div>
            <label className="text-[11px] text-neutral-500 font-medium uppercase tracking-wider">Repository URL</label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/..."
              className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-codefire-orange"
            />
          </div>

          {/* Group */}
          <div>
            <label className="text-[11px] text-neutral-500 font-medium uppercase tracking-wider">Group</label>
            <select
              value={clientId ?? ''}
              onChange={(e) => setClientId(e.target.value || null)}
              className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-codefire-orange"
            >
              <option value="">No Group</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-neutral-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 rounded hover:bg-white/[0.06] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs text-white bg-codefire-orange rounded hover:bg-codefire-orange/80 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

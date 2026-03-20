import { useState, useRef, useEffect } from 'react'
import { Folder, Tag, Users, FolderOpen, Trash2, X, Check, Palette, Pencil, Settings } from 'lucide-react'
import type { Project, Client } from '@shared/models'
import { api } from '@renderer/lib/api'
import ProjectSettingsModal from '@renderer/components/Header/ProjectSettingsModal'

interface ProjectItemProps {
  project: Project
  onClick: () => void
  indent?: boolean
  isSelected?: boolean
  clients?: Client[]
  onRefresh?: () => void
}

/** Extract the last path component as a display name. */
function displayName(project: Project): string {
  const name = project.name
  if (name.includes('/') || name.includes('\\')) {
    const segments = name.split(/[/\\]/).filter(Boolean)
    return segments[segments.length - 1] ?? name
  }
  return name
}

/** Parse tags — handles both JSON arrays and comma-separated strings. */
function parseTags(tags: string | null): string[] {
  if (!tags) return []
  const trimmed = tags.trim()

  // Handle JSON array format: '["prod","webapp"]'
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter(Boolean)
      }
    } catch {
      // Fall through to comma-separated parsing
    }
  }

  return trimmed
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

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

interface ContextMenuState {
  x: number
  y: number
  submenu?: 'tag' | 'group' | 'color'
}

export default function ProjectItem({ project, onClick, indent, isSelected, clients, onRefresh }: ProjectItemProps) {
  const tags = parseTags(project.tags)
  const name = displayName(project)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editingName, setEditingName] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    onClick()
  }

  const handleDoubleClick = () => {
    api.windows.openProject(project.id)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
    setTagInput('')
  }

  const closeMenu = () => {
    setMenu(null)
  }

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!menu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menu])

  // Focus tag input when submenu opens
  useEffect(() => {
    if (menu?.submenu === 'tag') {
      setTimeout(() => tagInputRef.current?.focus(), 50)
    }
  }, [menu?.submenu])

  async function handleSetTag() {
    const tag = tagInput.trim()
    if (!tag) return
    const existing = parseTags(project.tags)
    if (!existing.includes(tag)) {
      existing.push(tag)
    }
    await api.projects.update(project.id, { tags: JSON.stringify(existing) })
    closeMenu()
    onRefresh?.()
  }

  async function handleRemoveTag(tag: string) {
    const existing = parseTags(project.tags).filter((t) => t !== tag)
    await api.projects.update(project.id, {
      tags: existing.length > 0 ? JSON.stringify(existing) : null,
    })
    closeMenu()
    onRefresh?.()
  }

  async function handleSetGroup(clientId: string | null) {
    await api.projects.update(project.id, { clientId })
    closeMenu()
    onRefresh?.()
  }

  async function handleShowInExplorer() {
    if (project.path) {
      await api.shell.showInExplorer(project.path)
    }
    closeMenu()
  }

  async function handleRemoveProject() {
    await api.projects.delete(project.id)
    closeMenu()
    onRefresh?.()
  }

  async function handleSetColor(color: string | null) {
    await api.projects.update(project.id, { color })
    closeMenu()
    onRefresh?.()
  }

  function startRename() {
    setIsEditing(true)
    setEditingName(name)
    closeMenu()
    setTimeout(() => renameInputRef.current?.select(), 50)
  }

  async function handleRenameSubmit() {
    const trimmed = editingName.trim()
    if (trimmed && trimmed !== name) {
      await api.projects.update(project.id, { name: trimmed })
      onRefresh?.()
    }
    setIsEditing(false)
    setEditingName('')
  }

  function handleLongPressStart() {
    longPressTimerRef.current = setTimeout(() => {
      startRename()
    }, 500)
  }

  function handleLongPressEnd() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  // Clamp menu position to viewport
  const menuStyle = menu
    ? {
        left: Math.min(menu.x, window.innerWidth - 200),
        top: Math.min(menu.y, window.innerHeight - 260),
      }
    : undefined

  return (
    <>
      {isEditing ? (
        <div className={`w-full flex items-center gap-2 py-0.5 ${indent ? 'pl-7 pr-3' : 'px-3'}`}>
          <Folder size={13} className={`flex-shrink-0 ${project.color ? '' : 'text-neutral-600'}`} style={project.color ? { color: project.color } : undefined} />
          <input
            ref={renameInputRef}
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit()
              if (e.key === 'Escape') { setIsEditing(false); setEditingName('') }
            }}
            onBlur={() => handleRenameSubmit()}
            className="flex-1 bg-neutral-800 border border-codefire-orange rounded px-1.5 py-0.5 text-[12px] text-neutral-200 focus:outline-none min-w-0"
          />
        </div>
      ) : (
        <button
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          onMouseDown={handleLongPressStart}
          onMouseUp={handleLongPressEnd}
          onMouseLeave={handleLongPressEnd}
          className={`
            w-full flex items-center gap-2 py-1 rounded text-left group
            text-[12px] transition-colors duration-100 cursor-default
            ${isSelected
              ? 'bg-codefire-orange/10 text-codefire-orange'
              : 'text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200'}
            ${indent ? 'pl-7 pr-3' : 'px-3'}
          `}
        >
          <Folder size={13} className={`flex-shrink-0 ${project.color ? '' : 'text-neutral-600'}`} style={project.color ? { color: project.color } : undefined} />
          <span className="truncate">{name}</span>
          {tags.length > 0 && (
            <div className="flex items-center gap-1 ml-auto flex-shrink-0">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="
                    inline-block px-1.5 py-px rounded
                    text-[10px] text-neutral-500 bg-neutral-800
                    leading-tight
                  "
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <span
            className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-neutral-600 hover:text-neutral-300 shrink-0"
            onClick={(e) => { e.stopPropagation(); setShowSettings(true) }}
            title="Project settings"
          >
            <Settings size={11} />
          </span>
        </button>
      )}

      {/* Context Menu */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[180px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1 text-[12px]"
          style={menuStyle}
        >
          {!menu.submenu && (
            <>
              <button
                onClick={startRename}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-white/[0.06] hover:text-neutral-100"
              >
                <Pencil size={13} />
                Rename
              </button>
              <button
                onClick={() => setMenu({ ...menu, submenu: 'tag' })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-white/[0.06] hover:text-neutral-100"
              >
                <Tag size={13} />
                Set Tag
              </button>
              <button
                onClick={() => setMenu({ ...menu, submenu: 'group' })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-white/[0.06] hover:text-neutral-100"
              >
                <Users size={13} />
                Set Group
              </button>
              <button
                onClick={() => setMenu({ ...menu, submenu: 'color' })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-white/[0.06] hover:text-neutral-100"
              >
                <Palette size={13} />
                Set Color
              </button>
              <button
                onClick={handleShowInExplorer}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-white/[0.06] hover:text-neutral-100"
              >
                <FolderOpen size={13} />
                Show in Explorer
              </button>
              <div className="mx-2 my-1 border-t border-neutral-800" />
              <button
                onClick={handleRemoveProject}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 size={13} />
                Remove Project
              </button>
            </>
          )}

          {/* Tag submenu */}
          {menu.submenu === 'tag' && (
            <div className="px-2 py-1 space-y-1.5">
              <div className="flex items-center gap-1">
                <input
                  ref={tagInputRef}
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSetTag()
                    if (e.key === 'Escape') setMenu({ ...menu, submenu: undefined })
                  }}
                  placeholder="Add tag..."
                  className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-codefire-orange"
                />
                <button
                  onClick={handleSetTag}
                  disabled={!tagInput.trim()}
                  className="p-1 rounded text-green-400 hover:bg-green-500/10 disabled:opacity-30"
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={() => setMenu({ ...menu, submenu: undefined })}
                  className="p-1 rounded text-neutral-500 hover:text-neutral-300"
                >
                  <X size={13} />
                </button>
              </div>
              {tags.length > 0 && (
                <div className="space-y-0.5">
                  <div className="text-[10px] text-neutral-600 px-1">Current tags:</div>
                  {tags.map((tag) => (
                    <div key={tag} className="flex items-center justify-between px-1 py-0.5 rounded hover:bg-white/[0.04]">
                      <span className="text-xs text-neutral-400">{tag}</span>
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="p-0.5 rounded text-neutral-600 hover:text-red-400"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Group submenu */}
          {menu.submenu === 'group' && (
            <div className="py-0.5">
              <button
                onClick={() => setMenu({ ...menu, submenu: undefined })}
                className="w-full flex items-center gap-2 px-3 py-1 text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-300 text-[11px]"
              >
                <X size={11} />
                Back
              </button>
              <div className="mx-2 my-1 border-t border-neutral-800" />
              {project.clientId && (
                <>
                  <button
                    onClick={() => handleSetGroup(null)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200"
                  >
                    <span className="w-2.5 h-2.5 rounded-full border border-neutral-600" />
                    No Group
                  </button>
                  <div className="mx-2 my-1 border-t border-neutral-800" />
                </>
              )}
              {(clients ?? []).map((client) => (
                <button
                  key={client.id}
                  onClick={() => handleSetGroup(client.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.06] ${
                    project.clientId === client.id ? 'text-codefire-orange' : 'text-neutral-300 hover:text-neutral-100'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: client.color ?? '#6B7280' }}
                  />
                  {client.name}
                  {project.clientId === client.id && (
                    <Check size={12} className="ml-auto text-codefire-orange" />
                  )}
                </button>
              ))}
              {(clients ?? []).length === 0 && (
                <div className="px-3 py-2 text-[11px] text-neutral-600">
                  No groups yet. Create one first.
                </div>
              )}
            </div>
          )}

          {/* Color submenu */}
          {menu.submenu === 'color' && (
            <div className="py-0.5">
              <button
                onClick={() => setMenu({ ...menu, submenu: undefined })}
                className="w-full flex items-center gap-2 px-3 py-1 text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-300 text-[11px]"
              >
                <X size={11} />
                Back
              </button>
              <div className="mx-2 my-1 border-t border-neutral-800" />
              <div className="grid grid-cols-7 gap-1 px-2 py-1.5">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => handleSetColor(c.value)}
                    className={`w-5 h-5 rounded-full border transition-all hover:scale-110 ${
                      project.color === c.value || (!project.color && !c.value)
                        ? 'border-white ring-1 ring-white/50 scale-110'
                        : 'border-neutral-700 hover:border-neutral-500'
                    }`}
                    style={{ backgroundColor: c.value || '#525252' }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Project Settings Modal */}
      {showSettings && (
        <ProjectSettingsModal
          project={project}
          clients={clients ?? []}
          onClose={() => setShowSettings(false)}
          onSaved={() => onRefresh?.()}
        />
      )}
    </>
  )
}

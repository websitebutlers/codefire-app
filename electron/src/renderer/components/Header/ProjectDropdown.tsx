import { useState, useEffect, useCallback, useRef } from 'react'
import { Folder, FolderOpen, Settings, Plus, ChevronDown, Check, X, LayoutGrid, Users, Tag, Trash2 } from 'lucide-react'
import type { Project, Client } from '@shared/models'
import { api } from '@renderer/lib/api'
import SettingsModal from '@renderer/components/Settings/SettingsModal'

function displayName(project: Project): string {
  const name = project.name
  if (name.includes('/') || name.includes('\\')) {
    const segments = name.split(/[/\\]/).filter(Boolean)
    return segments[segments.length - 1] ?? name
  }
  return name
}

function firstTag(project: Project): string | null {
  const tags = project.tags
  if (!tags) return null
  const trimmed = tags.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.length > 0) return String(parsed[0])
    } catch { /* fall through */ }
  }
  const first = trimmed.split(',').map((t) => t.trim()).filter(Boolean)[0]
  return first ?? null
}

interface ProjectContextMenu {
  x: number
  y: number
  project: Project
  submenu?: 'group' | 'tag'
  tagInput?: string
}

export default function ProjectDropdown() {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState('#F97316')
  const [collapsedClients, setCollapsedClients] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<ProjectContextMenu | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const addGroupInputRef = useRef<HTMLInputElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const [projectList, clientList] = await Promise.all([
        api.projects.list(),
        api.clients.list(),
      ])
      setProjects(projectList)
      setClients(clientList)
    } catch (err) {
      console.error('Failed to load projects:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Reload when dropdown opens
  useEffect(() => {
    if (open) load()
  }, [open, load])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowAddGroup(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setShowAddGroup(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const displayProjects = projects.filter((p) => p.id !== '__global__')

  const clientProjectMap = new Map<string, Project[]>()
  const ungrouped: Project[] = []
  for (const project of displayProjects) {
    if (project.clientId) {
      const list = clientProjectMap.get(project.clientId) ?? []
      list.push(project)
      clientProjectMap.set(project.clientId, list)
    } else {
      ungrouped.push(project)
    }
  }

  const toggleClient = (clientId: string) => {
    setCollapsedClients((prev) => {
      const next = new Set(prev)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  const handleOpenProject = (projectId: string) => {
    api.windows.openProject(projectId)
    setOpen(false)
  }

  async function handleOpenFolder() {
    try {
      const folderPath = await api.dialog.selectFolder()
      if (!folderPath) return
      const existing = await api.projects.getByPath(folderPath)
      if (!existing) {
        const sep = folderPath.includes('\\') ? '\\' : '/'
        const name = folderPath.split(sep).filter(Boolean).pop() ?? folderPath
        await api.projects.create({ name, path: folderPath })
      }
    } catch (err) {
      console.error('Failed to open folder:', err)
    }
    await load()
  }

  function handleAddGroup() {
    setShowAddGroup(true)
    setNewGroupName('')
    setNewGroupColor('#F97316')
    setTimeout(() => addGroupInputRef.current?.focus(), 50)
  }

  async function handleAddGroupSubmit() {
    if (!newGroupName.trim()) return
    await api.clients.create({ name: newGroupName.trim(), color: newGroupColor })
    setShowAddGroup(false)
    setNewGroupName('')
    load()
  }

  function handleProjectContextMenu(e: React.MouseEvent, project: Project) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, project })
  }

  async function handleSetGroup(project: Project, clientId: string | null) {
    await api.projects.update(project.id, { clientId })
    setContextMenu(null)
    load()
  }

  async function handleSetTag(project: Project, tag: string) {
    const trimmed = tag.trim()
    await api.projects.update(project.id, {
      tags: trimmed ? JSON.stringify([trimmed]) : null,
    })
    setContextMenu(null)
    load()
  }

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors"
        title="Open a project"
      >
        <Folder size={14} className="text-codefire-orange" />
        <span className="text-sm font-semibold text-neutral-200 max-w-48 truncate">All projects</span>
        <ChevronDown size={12} className={`text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 overflow-hidden">
          {/* Scrollable project list */}
          <div className="max-h-80 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-neutral-600">Loading...</p>
              </div>
            ) : (
              <>
                {/* Client groups */}
                {clients.map((client) => {
                  const clientProjects = clientProjectMap.get(client.id) ?? []
                  const isExpanded = !collapsedClients.has(client.id)
                  return (
                    <div key={client.id}>
                      <button
                        onClick={() => toggleClient(client.id)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]"
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: client.color || '#737373' }}
                        />
                        <span className="truncate font-semibold uppercase tracking-wider">{client.name}</span>
                        <span className="text-neutral-600 text-[10px] ml-1">{clientProjects.length}</span>
                        <span className="ml-auto text-neutral-600">
                          <ChevronDown size={11} className={`transition-transform duration-150 ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
                        </span>
                      </button>
                      {isExpanded && clientProjects.length === 0 && (
                        <div className="pl-7 pr-3 py-1.5 text-[11px] text-neutral-600 italic">
                          No projects — right-click a project to assign
                        </div>
                      )}
                      {isExpanded && clientProjects.map((project) => {
                        const tag = firstTag(project)
                        return (
                          <button
                            key={project.id}
                            onClick={() => handleOpenProject(project.id)}
                            onContextMenu={(e) => handleProjectContextMenu(e, project)}
                            className="w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-[12px] transition-colors text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200"
                          >
                            <Folder size={12} className="flex-shrink-0 text-neutral-600" />
                            <span className="truncate">{displayName(project)}</span>
                            {tag && (
                              <span className="text-[9px] font-medium text-neutral-500 px-1.5 py-0.5 rounded-full bg-neutral-800 shrink-0 ml-auto">
                                {tag}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}

                {/* Ungrouped projects */}
                {ungrouped.length > 0 && (
                  <>
                    {clients.length > 0 && (
                      <div className="px-3 py-1 mt-1">
                        <span className="text-[10px] font-semibold text-neutral-600 uppercase tracking-wider">Projects</span>
                      </div>
                    )}
                    {ungrouped.map((project) => {
                      const tag = firstTag(project)
                      return (
                        <button
                          key={project.id}
                          onClick={() => handleOpenProject(project.id)}
                          onContextMenu={(e) => handleProjectContextMenu(e, project)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200"
                        >
                          <Folder size={12} className="flex-shrink-0 text-neutral-600" />
                          <span className="truncate">{displayName(project)}</span>
                          {tag && (
                            <span className="text-[9px] font-medium text-neutral-500 px-1.5 py-0.5 rounded-full bg-neutral-800 shrink-0 ml-auto">
                              {tag}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </>
                )}

                {displayProjects.length === 0 && (
                  <div className="px-3 py-4 text-center">
                    <p className="text-xs text-neutral-600">No projects yet</p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mx-2 border-t border-neutral-800" />

          {/* Add Group inline form */}
          {showAddGroup && (
            <div className="px-3 py-2 space-y-2 border-b border-neutral-800">
              <div className="flex items-center gap-1.5">
                <input
                  ref={addGroupInputRef}
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddGroupSubmit()
                    if (e.key === 'Escape') setShowAddGroup(false)
                  }}
                  placeholder="Group name..."
                  className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-codefire-orange"
                />
                <button
                  onClick={handleAddGroupSubmit}
                  disabled={!newGroupName.trim()}
                  className="p-1 rounded text-green-400 hover:bg-green-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={() => setShowAddGroup(false)}
                  className="p-1 rounded text-neutral-500 hover:text-neutral-300"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                {['#F97316', '#3B82F6', '#10B981', '#A855F7', '#EF4444', '#F59E0B'].map((color) => (
                  <button
                    key={color}
                    onClick={() => setNewGroupColor(color)}
                    className={`w-4 h-4 rounded-full transition-all ${newGroupColor === color ? 'ring-2 ring-offset-1 ring-offset-neutral-900 ring-white scale-110' : 'hover:scale-110'}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Bottom actions */}
          <div className="flex items-center gap-1 px-2 py-1.5">
            <button
              onClick={() => { setShowSettings(true); setOpen(false) }}
              className="p-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06] transition-colors"
              title="Settings"
            >
              <Settings size={13} />
            </button>
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06] transition-colors"
              title="Open project folder"
            >
              <FolderOpen size={12} />
              <span>Open Folder</span>
            </button>
            <div className="flex-1" />
            <button
              onClick={handleAddGroup}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06] transition-colors"
              title="Add client group"
            >
              <Plus size={11} />
              <span>Group</span>
            </button>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />

      {/* Project Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[9999] min-w-[180px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1 text-[12px]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 200),
            top: Math.min(contextMenu.y, window.innerHeight - 200),
          }}
        >
          {!contextMenu.submenu && (
            <>
              <button
                onClick={() => setContextMenu({ ...contextMenu, submenu: 'tag', tagInput: firstTag(contextMenu.project) ?? '' })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-white/[0.06] hover:text-neutral-100"
              >
                <Tag size={13} />
                Set Tag...
              </button>
              <button
                onClick={() => setContextMenu({ ...contextMenu, submenu: 'group' })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-white/[0.06] hover:text-neutral-100"
              >
                <Users size={13} />
                Set Group
              </button>
              <button
                onClick={() => {
                  if (contextMenu.project.path) api.shell.showInExplorer(contextMenu.project.path)
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-300 hover:bg-white/[0.06] hover:text-neutral-100"
              >
                <FolderOpen size={13} />
                Show in Explorer
              </button>
            </>
          )}

          {contextMenu.submenu === 'tag' && (
            <div className="px-2 py-1.5 space-y-1.5">
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  value={contextMenu.tagInput ?? ''}
                  onChange={(e) => setContextMenu({ ...contextMenu, tagInput: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSetTag(contextMenu.project, contextMenu.tagInput ?? '')
                    if (e.key === 'Escape') setContextMenu({ ...contextMenu, submenu: undefined })
                  }}
                  placeholder="e.g. prod, api, web"
                  className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-codefire-orange"
                />
                <button
                  onClick={() => handleSetTag(contextMenu.project, contextMenu.tagInput ?? '')}
                  className="p-1 rounded text-green-400 hover:bg-green-500/10"
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={() => setContextMenu({ ...contextMenu, submenu: undefined })}
                  className="p-1 rounded text-neutral-500 hover:text-neutral-300"
                >
                  <X size={13} />
                </button>
              </div>
              {firstTag(contextMenu.project) && (
                <button
                  onClick={() => handleSetTag(contextMenu.project, '')}
                  className="text-[11px] text-neutral-500 hover:text-red-400 transition-colors"
                >
                  Clear tag
                </button>
              )}
            </div>
          )}

          {contextMenu.submenu === 'group' && (
            <div className="py-0.5">
              <button
                onClick={() => setContextMenu({ ...contextMenu, submenu: undefined })}
                className="w-full flex items-center gap-2 px-3 py-1 text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-300 text-[11px]"
              >
                <X size={11} />
                Back
              </button>
              <div className="mx-2 my-1 border-t border-neutral-800" />
              {contextMenu.project.clientId && (
                <>
                  <button
                    onClick={() => handleSetGroup(contextMenu.project, null)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200"
                  >
                    <span className="w-2.5 h-2.5 rounded-full border border-neutral-600" />
                    No Group
                  </button>
                  <div className="mx-2 my-1 border-t border-neutral-800" />
                </>
              )}
              {clients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => handleSetGroup(contextMenu.project, client.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.06] ${
                    contextMenu.project.clientId === client.id ? 'text-codefire-orange' : 'text-neutral-300 hover:text-neutral-100'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: client.color ?? '#6B7280' }}
                  />
                  {client.name}
                  {contextMenu.project.clientId === client.id && (
                    <Check size={12} className="ml-auto text-codefire-orange" />
                  )}
                </button>
              ))}
              {clients.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-neutral-600">
                  No groups yet. Create one first.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

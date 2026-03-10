import { useEffect, useState, useCallback, useRef } from 'react'
import { Home, Settings, FolderOpen, Plus, X, Check } from 'lucide-react'
import type { Project, Client } from '@shared/models'
import { api } from '@renderer/lib/api'
import SidebarItem from './SidebarItem'
import ClientGroup from './ClientGroup'
import ProjectItem from './ProjectItem'
import SettingsModal from '@renderer/components/Settings/SettingsModal'

interface SidebarProps {
  selectedProjectId?: string | null
  onProjectSelect?: (projectId: string) => void
  onHomeClick?: () => void
}

type NavView = 'planner' | 'sessions'

export default function Sidebar({ selectedProjectId, onProjectSelect, onHomeClick }: SidebarProps = {}) {
  const [activeNav, setActiveNav] = useState<NavView>('planner')
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState('#F97316')
  const addGroupInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const [projectList, clientList] = await Promise.all([
        api.projects.list(),
        api.clients.list(),
      ])
      setProjects(projectList)
      setClients(clientList)
    } catch (err) {
      console.error('Failed to load sidebar data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Filter out the internal global project from display
  const displayProjects = projects.filter((p) => p.id !== '__global__')

  // Group projects by client
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

  const handleProjectClick = (projectId: string) => {
    api.windows.openProject(projectId)
    onProjectSelect?.(projectId)
  }

  async function handleOpenFolder() {
    try {
      const folderPath = await api.dialog.selectFolder()
      if (!folderPath) return
      // Check if project already exists for this path
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

  const isMac = navigator.platform.toUpperCase().includes('MAC')

  return (
    <div className="h-full flex flex-col bg-neutral-950">
      {/* macOS drag region */}
      {isMac && <div className="drag-region h-7 flex-shrink-0" />}

      {/* Logo */}
      <div className="px-3 pb-2 flex items-center gap-1.5">
        <span className="text-codefire-orange text-sm" aria-hidden>
          &#9632;
        </span>
        <span className="text-sm font-semibold text-neutral-200 tracking-tight">
          CodeFire
        </span>
      </div>

      {/* Navigation */}
      <div className="px-2 space-y-0.5">
        <SidebarItem
          label="Planner"
          icon={<Home size={14} />}
          isActive={activeNav === 'planner' && !selectedProjectId}
          onClick={() => { setActiveNav('planner'); onHomeClick?.() }}
        />
      </div>

      {/* Divider */}
      <div className="mx-3 my-2 border-t border-neutral-800/60" />

      {/* Scrollable project list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="space-y-2 px-3 pt-1">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-4 bg-neutral-800/50 rounded animate-pulse"
                style={{ width: `${60 + Math.random() * 30}%` }}
              />
            ))}
          </div>
        ) : (
          <>
            {/* Client groups */}
            {clients.map((client) => {
              const clientProjects = clientProjectMap.get(client.id) ?? []
              return (
                <ClientGroup
                  key={client.id}
                  client={client}
                  projects={clientProjects}
                  onProjectClick={handleProjectClick}
                  selectedProjectId={selectedProjectId}
                  allClients={clients}
                  onRefresh={load}
                />
              )
            })}

            {/* Projects (ungrouped) */}
            {ungrouped.length > 0 && (
              <>
                <div className="px-3 py-1.5 mt-1 flex items-center">
                  <span className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider">
                    Projects
                  </span>
                </div>
                {ungrouped.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    onClick={() => handleProjectClick(project.id)}
                    isSelected={selectedProjectId === project.id}
                    clients={clients}
                    onRefresh={load}
                  />
                ))}
              </>
            )}

            {/* Empty state */}
            {displayProjects.length === 0 && (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-neutral-600">No projects yet</p>
                <p className="text-[10px] text-neutral-700 mt-1">
                  Open a project folder to get started
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Group inline form */}
      {showAddGroup && (
        <div className="px-3 py-2 border-t border-neutral-800/60 space-y-2">
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
              className="p-1 rounded text-success hover:bg-success/10 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Create"
            >
              <Check size={14} />
            </button>
            <button
              onClick={() => setShowAddGroup(false)}
              className="p-1 rounded text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04]"
              title="Cancel"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {['#F97316', '#3B82F6', '#10B981', '#A855F7', '#EF4444', '#F59E0B', '#EC4899', '#06B6D4'].map((color) => (
              <button
                key={color}
                onClick={() => setNewGroupColor(color)}
                className={`w-5 h-5 rounded-full transition-all ${newGroupColor === color ? 'ring-2 ring-offset-1 ring-offset-neutral-950 ring-white scale-110' : 'hover:scale-110'}`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bottom toolbar */}
      <div className="flex items-center gap-1 px-2 py-2 border-t border-neutral-800/60">
        <button
          onClick={() => setShowSettings(true)}
          className="
            p-1.5 rounded text-neutral-600 hover:text-neutral-300
            hover:bg-white/[0.04] transition-colors duration-100
          "
          title="Settings"
        >
          <Settings size={14} />
        </button>
        <button
          onClick={handleOpenFolder}
          className="
            flex items-center gap-1.5 px-2 py-1 rounded text-[11px]
            text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04]
            transition-colors duration-100
          "
          title="Open project folder"
        >
          <FolderOpen size={13} />
          <span>Open Folder</span>
        </button>
        <div className="flex-1" />
        <button
          onClick={handleAddGroup}
          className="
            flex items-center gap-1 px-2 py-1 rounded text-[11px]
            text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04]
            transition-colors duration-100
          "
          title="Add client group"
        >
          <Plus size={12} />
          <span>Group</span>
        </button>
      </div>

      {/* Settings Modal */}
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}

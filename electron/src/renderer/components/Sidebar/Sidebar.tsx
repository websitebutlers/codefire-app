import { useEffect, useState, useCallback } from 'react'
import { Home, Settings, FolderOpen, Plus } from 'lucide-react'
import type { Project, Client } from '@shared/models'
import { api } from '@renderer/lib/api'
import SidebarItem from './SidebarItem'
import ClientGroup from './ClientGroup'
import ProjectItem from './ProjectItem'
import SettingsModal from '@renderer/components/Settings/SettingsModal'

type NavView = 'planner' | 'sessions'

export default function Sidebar() {
  const [activeNav, setActiveNav] = useState<NavView>('planner')
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

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

  // Group projects by client
  const clientProjectMap = new Map<string, Project[]>()
  const ungrouped: Project[] = []

  for (const project of projects) {
    if (project.clientId) {
      const list = clientProjectMap.get(project.clientId) ?? []
      list.push(project)
      clientProjectMap.set(project.clientId, list)
    } else {
      ungrouped.push(project)
    }
  }

  // Recent projects: last 10 opened, regardless of client
  const recentProjects = [...projects]
    .filter((p) => p.lastOpened)
    .sort((a, b) => new Date(b.lastOpened!).getTime() - new Date(a.lastOpened!).getTime())
    .slice(0, 10)

  const handleProjectClick = (_projectId: string) => {
    // Window opening is handled inside ProjectItem
  }

  async function handleOpenFolder() {
    // Use Electron's dialog via IPC — we need to add a handler for this
    // For now, fall back to prompt
    const folderPath = window.prompt('Enter project folder path:')
    if (!folderPath) return
    const name = folderPath.split('/').filter(Boolean).pop() ?? folderPath
    await api.projects.create({ name, path: folderPath })
    load()
  }

  async function handleAddGroup() {
    const name = window.prompt('Client / group name:')
    if (!name?.trim()) return
    await api.clients.create({ name: name.trim() })
    load()
  }

  return (
    <div className="h-full flex flex-col bg-neutral-950">
      {/* macOS drag region */}
      <div className="drag-region h-7 flex-shrink-0" />

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
          isActive={activeNav === 'planner'}
          onClick={() => setActiveNav('planner')}
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
                />
              )
            })}

            {/* Recent Projects section */}
            {recentProjects.length > 0 && (
              <>
                <div className="px-3 py-1.5 mt-1 flex items-center">
                  <span className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider">
                    Recent Projects
                  </span>
                </div>
                {recentProjects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    onClick={() => handleProjectClick(project.id)}
                  />
                ))}
              </>
            )}

            {/* Ungrouped projects (no client) when no recent */}
            {ungrouped.length > 0 && recentProjects.length === 0 && (
              <div>
                {ungrouped.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    onClick={() => handleProjectClick(project.id)}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {projects.length === 0 && (
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

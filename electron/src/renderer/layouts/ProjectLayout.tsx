import { useState, useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { Project } from '@shared/models'
import { api } from '@renderer/lib/api'
import TerminalPanel from '@renderer/components/Terminal/TerminalPanel'
import TabBar from '@renderer/components/TabBar/TabBar'
import DashboardView from '@renderer/views/DashboardView'
import SessionsView from '@renderer/views/SessionsView'
import TasksView from '@renderer/views/TasksView'
import NotesView from '@renderer/views/NotesView'
import FilesView from '@renderer/views/FilesView'
import MemoryView from '@renderer/views/MemoryView'
import ServicesView from '@renderer/views/ServicesView'
import RulesView from '@renderer/views/RulesView'
import GitView from '@renderer/views/GitView'
import ImagesView from '@renderer/views/ImagesView'
import RecordingsView from '@renderer/views/RecordingsView'
import BrowserView from '@renderer/views/BrowserView'

interface ProjectLayoutProps {
  projectId: string
}

export default function ProjectLayout({ projectId }: ProjectLayoutProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [activeTab, setActiveTab] = useState('Dashboard')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const proj = await api.projects.get(projectId)
        if (cancelled) return

        if (!proj) {
          setError(`Project not found: ${projectId}`)
          return
        }

        setProject(proj)

        // Update window title with project name
        document.title = `${proj.name} — CodeFire`

        // Mark project as recently opened
        api.projects.updateLastOpened(projectId).catch((err) => {
          console.warn('Failed to update lastOpened:', err)
        })
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load project:', err)
          setError('Failed to load project')
        }
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [projectId])

  // ─── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="h-screen bg-neutral-900 text-neutral-200 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-error">{error}</p>
          <p className="text-xs text-neutral-600 mt-2">
            Check the project ID and try again
          </p>
        </div>
      </div>
    )
  }

  // ─── Loading state ──────────────────────────────────────────────────────────
  if (!project) {
    return (
      <div className="h-screen bg-neutral-900 text-neutral-200 flex items-center justify-center">
        <p className="text-xs text-neutral-600">Loading project...</p>
      </div>
    )
  }

  // ─── View renderer ─────────────────────────────────────────────────────────
  function renderActiveView(tab: string, pid: string, onTabChange: (t: string) => void) {
    switch (tab) {
      case 'Dashboard':
        return <DashboardView projectId={pid} onTabChange={onTabChange} />
      case 'Sessions':
        return <SessionsView projectId={pid} />
      case 'Tasks':
        return <TasksView projectId={pid} />
      case 'Notes':
        return <NotesView projectId={pid} />
      case 'Files':
        return <FilesView projectId={pid} projectPath={project!.path} />
      case 'Memory':
        return <MemoryView projectId={pid} projectPath={project!.path} />
      case 'Services':
        return <ServicesView projectId={pid} projectPath={project!.path} />
      case 'Rules':
        return <RulesView projectId={pid} projectPath={project!.path} />
      case 'Git':
        return <GitView projectId={pid} projectPath={project!.path} />
      case 'Images':
        return <ImagesView projectId={pid} />
      case 'Recordings':
        return <RecordingsView projectId={pid} />
      case 'Browser':
        return <BrowserView projectId={pid} />
      default:
        return (
          <div className="flex-1 p-4 overflow-y-auto">
            <h2 className="text-title text-neutral-300">{tab}</h2>
            <p className="text-sm text-neutral-600 mt-1">Coming soon</p>
          </div>
        )
    }
  }

  // ─── Main layout ───────────────────────────────────────────────────────────
  return (
    <div className="h-screen w-screen overflow-hidden bg-neutral-900">
      {/* Drag region for frameless window title bar */}
      <div className="drag-region h-7 flex-shrink-0" />

      <div className="flex flex-col" style={{ height: 'calc(100vh - 28px)' }}>
        <Group orientation="horizontal" id="project-layout">
          {/* Left panel: Terminal */}
          <Panel id="terminal" defaultSize="35%" minSize="25%" maxSize="50%">
            <TerminalPanel projectId={projectId} projectPath={project.path} />
          </Panel>

          {/* Resize handle */}
          <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />

          {/* Right panel: Tab bar + active view */}
          <Panel id="gui">
            <div className="flex flex-col h-full">
              <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

              {/* Active view */}
              <div className="flex-1 overflow-hidden">
                {renderActiveView(activeTab, projectId, setActiveTab)}
              </div>
            </div>
          </Panel>
        </Group>
      </div>
    </div>
  )
}

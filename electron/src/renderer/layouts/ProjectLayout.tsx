import { useState, useEffect, useCallback } from 'react'
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
import VisualizerView from '@renderer/views/VisualizerView'
import CodeFireChat from '@renderer/components/Chat/CodeFireChat'
import BriefingDrawer from '@renderer/components/Dashboard/BriefingDrawer'
import AgentStatusBar from '@renderer/components/StatusBar/AgentStatusBar'
import { ProjectHeaderLeft, ProjectHeaderRight } from '@renderer/components/Header/ProjectHeaderBar'
import { useMCPStatus } from '@renderer/hooks/useMCPStatus'

interface ProjectLayoutProps {
  projectId: string
}

export default function ProjectLayout({ projectId }: ProjectLayoutProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [activeTab, setActiveTab] = useState('Tasks')
  const [error, setError] = useState<string | null>(null)
  const { mcpStatus, mcpSessionCount, startMCP, stopMCP } = useMCPStatus()
  const [indexStatus, setIndexStatus] = useState<'idle' | 'indexing' | 'ready' | 'error'>('idle')
  const [indexLastError, setIndexLastError] = useState<string | undefined>()
  const [showBriefing, setShowBriefing] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [terminalOnLeft, setTerminalOnLeft] = useState(false)
  const [dragOverSide, setDragOverSide] = useState<'left' | 'right' | 'active' | null>(null)

  const handleRequestIndex = useCallback(async () => {
    setIndexStatus('indexing')
    setIndexLastError(undefined)
    try {
      await api.search.reindex(projectId)
      setIndexStatus('ready')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to index project:', err)
      setIndexLastError(message)
      setIndexStatus('error')
    }
  }, [projectId])

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
        document.title = `${proj.name} — CodeFire`
        api.projects.updateLastOpened(projectId).catch((err) => {
          console.warn('Failed to update lastOpened:', err)
        })

        // Always trigger indexing when a project is opened
        handleRequestIndex()
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
  }, [projectId, handleRequestIndex])

  if (error) {
    return (
      <div className="h-screen bg-neutral-900 text-neutral-200 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-error">{error}</p>
          <p className="text-xs text-neutral-600 mt-2">Check the project ID and try again</p>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="h-screen bg-neutral-900 text-neutral-200 flex items-center justify-center">
        <p className="text-xs text-neutral-600">Loading project...</p>
      </div>
    )
  }

  function renderActiveView(tab: string, pid: string, onTabChange: (t: string) => void) {
    switch (tab) {
      case 'Details':
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
      case 'Visualizer':
        return <VisualizerView projectId={pid} projectPath={project!.path} />
      default:
        return (
          <div className="flex-1 p-4 overflow-y-auto">
            <h2 className="text-title text-neutral-300">{tab}</h2>
            <p className="text-sm text-neutral-600 mt-1">Coming soon</p>
          </div>
        )
    }
  }

  function renderTerminalChat() {
    const terminalPanel = (
      <TerminalPanel
        projectId={projectId}
        projectPath={project!.path}
        showChat={showChat}
        onToggleChat={() => setShowChat(v => !v)}
        terminalOnLeft={terminalOnLeft}
        onSwapPanels={() => setTerminalOnLeft(v => !v)}
      />
    )

    if (!showChat) return terminalPanel

    return (
      <Group orientation="vertical" id="terminal-chat-split">
        <Panel id="terminal" defaultSize="50%" minSize="15%">
          {terminalPanel}
        </Panel>
        <Separator className="h-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />
        <Panel id="chat" defaultSize="50%" minSize="15%">
          <CodeFireChat projectId={projectId} projectName={project!.name} />
        </Panel>
      </Group>
    )
  }

  const isMac = navigator.platform.toUpperCase().includes('MAC')

  return (
    <div className="h-screen w-screen overflow-hidden bg-neutral-900">
      {isMac && <div className="drag-region h-7 flex-shrink-0" />}

      <div className="flex flex-col" style={{ height: isMac ? 'calc(100vh - 28px)' : '100vh' }}>
        {/* Top bar with project indicators */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-neutral-800 bg-neutral-950 shrink-0">
          <span className="text-codefire-orange text-sm" aria-hidden>&#9632;</span>
          <span className="text-sm font-semibold text-neutral-200 tracking-tight">CodeFire</span>
          <div className="w-px h-4 bg-neutral-700" />
          <ProjectHeaderLeft projectName={project.name} projectPath={project.path} />
          <div className="flex-1" />
          <ProjectHeaderRight
            mcpStatus={mcpStatus}
            mcpSessionCount={mcpSessionCount}
            indexStatus={indexStatus}
            indexLastError={indexLastError}
            onMCPConnect={startMCP}
            onMCPDisconnect={stopMCP}
            onRequestIndex={handleRequestIndex}
            onBriefingClick={() => { setShowBriefing((v) => !v) }}
          />
        </div>

        {/* Tab bar */}
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Content: view + terminal/chat columns (swappable via drag) */}
        <div
          className="flex-1 overflow-hidden relative"
          onDragOver={(e) => {
            // Activate drop zones when a panel drag is in progress
            if (e.dataTransfer.types.includes('application/x-codefire-panel')) {
              e.preventDefault()
              if (dragOverSide === null) setDragOverSide('active')
            }
          }}
          onDragLeave={(e) => {
            // Only clear if leaving the container entirely
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOverSide(null)
            }
          }}
          onDrop={() => setDragOverSide(null)}
        >
          <Group orientation="horizontal" id="project-layout" key={terminalOnLeft ? 'tl' : 'tr'}>
            {terminalOnLeft ? (
              <>
                <Panel id="terminal-chat" defaultSize="40%" minSize="20%">
                  {renderTerminalChat()}
                </Panel>
                <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />
                <Panel id="content" defaultSize="60%" minSize="30%">
                  <div className="h-full overflow-hidden flex flex-col">
                    {renderActiveView(activeTab, projectId, setActiveTab)}
                  </div>
                </Panel>
              </>
            ) : (
              <>
                <Panel id="content" defaultSize="60%" minSize="30%">
                  <div className="h-full overflow-hidden flex flex-col">
                    {renderActiveView(activeTab, projectId, setActiveTab)}
                  </div>
                </Panel>
                <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />
                <Panel id="terminal-chat" defaultSize="40%" minSize="20%">
                  {renderTerminalChat()}
                </Panel>
              </>
            )}
          </Group>

          {/* Drop zones — full-height overlays on left/right edges, visible during drag */}
          {dragOverSide !== null && (
            <>
              <div
                className={`absolute inset-y-0 left-0 w-1/2 z-40 transition-colors duration-100 ${
                  dragOverSide === 'left'
                    ? 'bg-codefire-orange/10 border-l-4 border-codefire-orange/40'
                    : 'bg-transparent'
                }`}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverSide('left')
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverSide(null)
                  if (!terminalOnLeft) setTerminalOnLeft(true)
                }}
              />
              <div
                className={`absolute inset-y-0 right-0 w-1/2 z-40 transition-colors duration-100 ${
                  dragOverSide === 'right'
                    ? 'bg-codefire-orange/10 border-r-4 border-codefire-orange/40'
                    : 'bg-transparent'
                }`}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverSide('right')
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverSide(null)
                  if (terminalOnLeft) setTerminalOnLeft(false)
                }}
              />
            </>
          )}
        </div>

        {/* Briefing Drawer */}
        {showBriefing && (
          <BriefingDrawer projectId={projectId} onClose={() => setShowBriefing(false)} />
        )}

        {/* Status bar */}
        <AgentStatusBar
          projectId={projectId}
          projectPath={project.path}
          mcpStatus={mcpStatus}
          mcpSessionCount={mcpSessionCount}
          indexStatus={indexStatus}
          indexLastError={indexLastError}
          onMCPConnect={startMCP}
          onMCPDisconnect={stopMCP}
          onRequestIndex={handleRequestIndex}
        />
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Terminal } from 'lucide-react'
import type { Project } from '@shared/models'
import { api } from '@renderer/lib/api'
import TabBar from '@renderer/components/TabBar/TabBar'
import AgentStatusBar from '@renderer/components/StatusBar/AgentStatusBar'
import { ProjectHeaderLeft, ProjectHeaderRight } from '@renderer/components/Header/ProjectHeaderBar'
import ProjectDropdown from '@renderer/components/Header/ProjectDropdown'
import { useDeferredMCPStatus } from '@renderer/hooks/useMCPStatus'
import { useDeferredPremium } from '@renderer/hooks/usePremium'
import NotificationBell from '@renderer/components/NotificationBell'
import { UpdateBanner } from '@renderer/components/UpdateBanner'
import MCPBanner from '@renderer/components/StatusBar/MCPBanner'
import logoIcon from '../../../resources/icon.png'

// Eager: default tab (Tasks) and lightweight views
import TasksView from '@renderer/views/TasksView'
import DashboardView from '@renderer/views/DashboardView'
import NotesView from '@renderer/views/NotesView'

// Lazy: heavy views (CodeMirror, xterm, markdown editor, browser webview)
const SessionsView = lazy(() => import('@renderer/views/SessionsView'))
const FilesView = lazy(() => import('@renderer/views/FilesView'))
const MemoryView = lazy(() => import('@renderer/views/MemoryView'))

const ServicesView = lazy(() => import('@renderer/views/ServicesView'))
const RulesView = lazy(() => import('@renderer/views/RulesView'))
const GitView = lazy(() => import('@renderer/views/GitView'))
const ImagesView = lazy(() => import('@renderer/views/ImagesView'))
const RecordingsView = lazy(() => import('@renderer/views/RecordingsView'))
const BrowserView = lazy(() => import('@renderer/views/BrowserView'))
const VisualizerView = lazy(() => import('@renderer/views/VisualizerView'))
const ActivityView = lazy(() => import('@renderer/views/ActivityView'))
const DocsView = lazy(() => import('@renderer/views/DocsView'))
const ReviewsView = lazy(() => import('@renderer/views/ReviewsView'))

// Lazy: heavy components (node-pty, xterm.js, presence websocket)
const TerminalPanel = lazy(() => import('@renderer/components/Terminal/TerminalPanel'))
const CodeFireChat = lazy(() => import('@renderer/components/Chat/CodeFireChat'))
const BriefingDrawer = lazy(() => import('@renderer/components/Dashboard/BriefingDrawer'))
const PresenceAvatars = lazy(() => import('@renderer/components/Presence/PresenceAvatars'))

interface ProjectLayoutProps {
  projectId: string
}

export default function ProjectLayout({ projectId }: ProjectLayoutProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [activeTab, setActiveTab] = useState('Tasks')
  const [error, setError] = useState<string | null>(null)
  const { mcpStatus, mcpSessionCount, startMCP, stopMCP } = useDeferredMCPStatus()
  const { status: premiumStatus } = useDeferredPremium()
  const [indexStatus, setIndexStatus] = useState<'idle' | 'indexing' | 'ready' | 'error'>('idle')
  const [indexLastError, setIndexLastError] = useState<string | undefined>()
  const [showBriefing, setShowBriefing] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showTerminal, setShowTerminal] = useState(true)
  const [terminalOnLeft, setTerminalOnLeft] = useState(false)
  const [dragOverSide, setDragOverSide] = useState<'left' | 'right' | 'active' | null>(null)
  const [hasReviews, setHasReviews] = useState(false)

  // Check if there are any review requests to decide whether to show the Reviews tab
  useEffect(() => {
    api.premium.listReviewRequests(projectId)
      .then((reviews) => setHasReviews(reviews.length > 0))
      .catch(() => {}) // Silently ignore — tab stays hidden if premium is unavailable
  }, [projectId])

  const hiddenTabs = useMemo(() => {
    const hidden = new Set<string>()
    if (!hasReviews) hidden.add('Reviews')
    return hidden
  }, [hasReviews])

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
        // Fire project fetch and lastOpened update in parallel
        const [proj] = await Promise.all([
          api.projects.get(projectId),
          api.projects.updateLastOpened(projectId).catch((err) => {
            console.warn('Failed to update lastOpened:', err)
          }),
        ])
        if (cancelled) return

        if (!proj) {
          setError(`Project not found: ${projectId}`)
          return
        }

        setProject(proj)
        document.title = `${proj.name} — CodeFire`

        // Check existing index state instead of auto-indexing
        try {
          const state = await api.search.getIndexState(projectId)
          if (state) {
            setIndexStatus(state.status as typeof indexStatus)
            if (state.lastError) setIndexLastError(state.lastError)
          }
          // If no state or status is 'idle', leave as 'idle' — the indicator
          // will show "Not Indexed" with a click-to-index prompt
        } catch {
          // If we can't fetch state, leave as idle
        }
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

  const lazyFallback = (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-neutral-700 border-t-codefire-orange rounded-full animate-spin" />
    </div>
  )

  const projectPath = project?.path

  function renderActiveView(tab: string, pid: string, onTabChange: (t: string) => void) {
    // Eager-loaded views (default tab + lightweight — work with just projectId)
    switch (tab) {
      case 'Tasks':
        return <TasksView projectId={pid} projectPath={projectPath} />
      case 'Dashboard':
        return <DashboardView projectId={pid} projectPath={projectPath} onTabChange={onTabChange} />
      case 'Notes':
        return <NotesView projectId={pid} />
    }

    // Views that need projectPath — show spinner until project loads
    if (!projectPath) return lazyFallback

    // Lazy-loaded views (heavy dependencies)
    return (
      <Suspense fallback={lazyFallback}>
        {tab === 'Sessions' && <SessionsView projectId={pid} />}
        {tab === 'Files' && <FilesView projectId={pid} projectPath={projectPath} />}
        {tab === 'Memory' && <MemoryView projectId={pid} projectPath={projectPath} />}

        {tab === 'Services' && <ServicesView projectId={pid} projectPath={projectPath} />}
        {tab === 'Rules' && <RulesView projectId={pid} projectPath={projectPath} />}
        {tab === 'Git' && <GitView projectId={pid} projectPath={projectPath} />}
        {tab === 'Images' && <ImagesView projectId={pid} />}
        {tab === 'Transcribe' && <RecordingsView projectId={pid} />}
        {tab === 'Browser' && <BrowserView projectId={pid} />}
        {tab === 'Visualize' && <VisualizerView projectId={pid} projectPath={projectPath} />}
        {tab === 'Activity' && <ActivityView projectId={pid} />}
        {tab === 'Docs' && <DocsView projectId={pid} />}
        {tab === 'Reviews' && <ReviewsView projectId={pid} />}
        {!['Sessions','Files','Memory','Services','Rules','Git','Images','Transcribe','Browser','Visualize','Activity','Docs','Reviews'].includes(tab) && (
          <div className="flex-1 p-4 overflow-y-auto">
            <h2 className="text-title text-neutral-300">{tab}</h2>
            <p className="text-sm text-neutral-600 mt-1">Coming soon</p>
          </div>
        )}
      </Suspense>
    )
  }

  function renderTerminalChat() {
    if (!projectPath) {
      return (
        <div className="h-full flex items-center justify-center bg-neutral-950">
          <div className="w-5 h-5 border-2 border-neutral-700 border-t-codefire-orange rounded-full animate-spin" />
        </div>
      )
    }

    const terminalPanel = (
      <Suspense fallback={lazyFallback}>
        <TerminalPanel
          projectId={projectId}
          projectPath={projectPath}
          showChat={showChat}
          onToggleChat={() => setShowChat(v => !v)}
          terminalOnLeft={terminalOnLeft}
          onSwapPanels={() => setTerminalOnLeft(v => !v)}
        />
      </Suspense>
    )

    if (!showChat) return terminalPanel

    return (
      <Group orientation="vertical" id="terminal-chat-split">
        <Panel id="terminal" defaultSize="50%" minSize="15%">
          {terminalPanel}
        </Panel>
        <Separator className="h-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />
        <Panel id="chat" defaultSize="50%" minSize="15%">
          <Suspense fallback={lazyFallback}>
            <CodeFireChat projectId={projectId} projectName={project?.name ?? ''} />
          </Suspense>
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
        <div className="flex items-center gap-1 px-4 py-2 border-b border-neutral-800 bg-neutral-950 shrink-0">
          <img src={logoIcon} alt="CodeFire" className="w-[22px] h-[22px]" />
          <span className="text-sm font-semibold text-neutral-200 tracking-tight">CodeFire</span>
          <ProjectDropdown />
          <div className="w-px h-4 bg-neutral-700" />
          <ProjectHeaderLeft projectName={project?.name ?? '...'} projectPath={project?.path ?? ''} />
          <div className="flex-1" />
          {premiumStatus?.enabled && premiumStatus.authenticated && (
            <Suspense fallback={null}>
              <PresenceAvatars projectId={projectId} />
            </Suspense>
          )}
          <button
            onClick={() => setShowTerminal(v => !v)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
              showTerminal
                ? 'text-codefire-orange bg-codefire-orange/10 hover:bg-codefire-orange/20'
                : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
            }`}
            title={showTerminal ? 'Hide Terminal' : 'Show Terminal'}
          >
            <Terminal size={13} />
            <span className="hidden sm:inline">Terminal</span>
          </button>
          <NotificationBell />
          <div className="w-px h-4 bg-neutral-700" />
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

        <UpdateBanner />
        {project && <MCPBanner projectPath={project.path} />}

        {/* Tab bar */}
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} hiddenTabs={hiddenTabs} />

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
          {showTerminal ? (
            <Group orientation="horizontal" id="project-layout">
              <Panel id="content" defaultSize="60%" minSize="30%" style={{ order: terminalOnLeft ? 2 : 1 }}>
                <div className="h-full overflow-hidden flex flex-col">
                  {renderActiveView(activeTab, projectId, setActiveTab)}
                </div>
              </Panel>
              <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" style={{ order: terminalOnLeft ? 2 : 2 }} />
              <Panel id="terminal-chat" defaultSize="40%" minSize="20%" style={{ order: terminalOnLeft ? 1 : 3 }}>
                {renderTerminalChat()}
              </Panel>
            </Group>
          ) : (
            <div className="h-full overflow-hidden flex flex-col">
              {renderActiveView(activeTab, projectId, setActiveTab)}
            </div>
          )}

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
          <Suspense fallback={null}>
            <BriefingDrawer projectId={projectId} onClose={() => setShowBriefing(false)} />
          </Suspense>
        )}

        {/* Status bar */}
        <AgentStatusBar
          projectId={projectId}
          projectPath={project?.path ?? ''}
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

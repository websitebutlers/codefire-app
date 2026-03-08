import { useState, useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Terminal } from 'lucide-react'
import logoIcon from '../../../resources/icon.png'
import { api } from '@renderer/lib/api'
import TerminalPanel from '@renderer/components/Terminal/TerminalPanel'
import CodeFireChat from '@renderer/components/Chat/CodeFireChat'
import ProjectDropdown from '@renderer/components/Header/ProjectDropdown'
import MCPIndicator from '@renderer/components/StatusBar/MCPIndicator'
import AllProjectsView from '@renderer/views/AllProjectsView'
import { useMCPStatus } from '@renderer/hooks/useMCPStatus'
import NotificationBell from '@renderer/components/NotificationBell'
import { UpdateBanner } from '@renderer/components/UpdateBanner'

const isMac = navigator.platform.toUpperCase().includes('MAC')

export default function MainLayout() {
  const { mcpStatus, mcpSessionCount, startMCP, stopMCP } = useMCPStatus()
  const [defaultTerminalPath, setDefaultTerminalPath] = useState('')
  const [showTerminal, setShowTerminal] = useState(true)
  const [terminalOnLeft, setTerminalOnLeft] = useState(false)
  const [showChat, setShowChat] = useState(true)
  const [dragOverSide, setDragOverSide] = useState<'left' | 'right' | 'active' | null>(null)

  useEffect(() => {
    document.title = 'CodeFire'
    api.settings.get().then((cfg) => {
      if (cfg.defaultTerminalPath) setDefaultTerminalPath(cfg.defaultTerminalPath)
    }).catch(() => {})
  }, [])

  const terminalProjectPath = defaultTerminalPath || window.api.homePath

  function renderTerminalChat() {
    const terminalPanel = (
      <TerminalPanel
        key="__global__"
        projectId="__global__"
        projectPath={terminalProjectPath}
        showChat={showChat}
        onToggleChat={() => setShowChat(v => !v)}
        terminalOnLeft={terminalOnLeft}
        onSwapPanels={() => setTerminalOnLeft(v => !v)}
      />
    )

    if (!showChat) return terminalPanel

    return (
      <Group orientation="vertical" id="main-terminal-chat-split">
        <Panel id="terminal" defaultSize="50%" minSize="15%">
          {terminalPanel}
        </Panel>
        <Separator className="h-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />
        <Panel id="chat" defaultSize="50%" minSize="15%">
          <CodeFireChat />
        </Panel>
      </Group>
    )
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-neutral-900">
      {isMac && <div className="drag-region h-7 flex-shrink-0" />}

      <div className="flex flex-col" style={{ height: isMac ? 'calc(100vh - 28px)' : '100vh' }}>
        {/* Top bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 bg-neutral-950 shrink-0">
          <img src={logoIcon} alt="CodeFire" className="w-4 h-4" />
          <span className="text-sm font-semibold text-neutral-200 tracking-tight">CodeFire</span>

          <ProjectDropdown />

          <div className="flex-1" />

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
          <MCPIndicator status={mcpStatus} sessionCount={mcpSessionCount} onConnect={startMCP} onDisconnect={stopMCP} />
        </div>

        <UpdateBanner />

        {/* Main content area: dashboard + terminal/chat columns (swappable via drag) */}
        <div
          className="flex-1 overflow-hidden relative"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-codefire-panel')) {
              e.preventDefault()
              if (dragOverSide === null) setDragOverSide('active')
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOverSide(null)
            }
          }}
          onDrop={() => setDragOverSide(null)}
        >
          {showTerminal ? (
            <Group orientation="horizontal" id="main-layout" key={terminalOnLeft ? 'tl' : 'tr'}>
              {terminalOnLeft ? (
                <>
                  <Panel id="terminal-chat" defaultSize="40%" minSize="20%">
                    {renderTerminalChat()}
                  </Panel>
                  <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />
                  <Panel id="content" defaultSize="60%" minSize="30%">
                    <AllProjectsView />
                  </Panel>
                </>
              ) : (
                <>
                  <Panel id="content" defaultSize="60%" minSize="30%">
                    <AllProjectsView />
                  </Panel>
                  <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />
                  <Panel id="terminal-chat" defaultSize="40%" minSize="20%">
                    {renderTerminalChat()}
                  </Panel>
                </>
              )}
            </Group>
          ) : (
            <AllProjectsView />
          )}

          {/* Drop zones for dragging terminal left/right */}
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

        {/* Status bar */}
        <div className="w-full h-7 flex-shrink-0 flex items-center px-3 bg-neutral-950 border-t border-neutral-800 no-drag">
          <MCPIndicator status={mcpStatus} sessionCount={mcpSessionCount} onConnect={startMCP} onDisconnect={stopMCP} />
        </div>
      </div>

    </div>
  )
}

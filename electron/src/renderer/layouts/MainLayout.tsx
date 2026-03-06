import { useState, useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import logoIcon from '../../../resources/icon.png'
import { api } from '@renderer/lib/api'
import TerminalPanel from '@renderer/components/Terminal/TerminalPanel'
import CodeFireChat from '@renderer/components/Chat/CodeFireChat'
import ProjectDropdown from '@renderer/components/Header/ProjectDropdown'
import MCPIndicator from '@renderer/components/StatusBar/MCPIndicator'
import AllProjectsView from '@renderer/views/AllProjectsView'
import { useMCPStatus } from '@renderer/hooks/useMCPStatus'

const isMac = navigator.platform.toUpperCase().includes('MAC')

export default function MainLayout() {
  const { mcpStatus, mcpSessionCount, startMCP, stopMCP } = useMCPStatus()
  const [defaultTerminalPath, setDefaultTerminalPath] = useState('')

  useEffect(() => {
    document.title = 'CodeFire'
    api.settings.get().then((cfg) => {
      if (cfg.defaultTerminalPath) setDefaultTerminalPath(cfg.defaultTerminalPath)
    }).catch(() => {})
  }, [])

  const terminalProjectPath = defaultTerminalPath || window.api.homePath

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

          <MCPIndicator status={mcpStatus} sessionCount={mcpSessionCount} onConnect={startMCP} onDisconnect={stopMCP} />
        </div>

        {/* Main content area: dashboard left + terminal/chat right */}
        <div className="flex-1 overflow-hidden">
          <Group orientation="horizontal" id="main-layout">
            <Panel id="content" defaultSize="60%" minSize="30%">
              <AllProjectsView />
            </Panel>

            <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />

            {/* Right panel: Terminal (top) + CodeFire Chat (bottom) */}
            <Panel id="terminal-chat" defaultSize="40%" minSize="20%">
              <Group orientation="vertical" id="main-terminal-chat-split">
                <Panel id="terminal" defaultSize="50%" minSize="15%">
                  <TerminalPanel key="__global__" projectId="__global__" projectPath={terminalProjectPath} />
                </Panel>

                <Separator className="h-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />

                <Panel id="chat" defaultSize="50%" minSize="15%">
                  <CodeFireChat />
                </Panel>
              </Group>
            </Panel>
          </Group>
        </div>

        {/* Status bar */}
        <div className="w-full h-7 flex-shrink-0 flex items-center px-3 bg-neutral-950 border-t border-neutral-800 no-drag">
          <MCPIndicator status={mcpStatus} sessionCount={mcpSessionCount} onConnect={startMCP} onDisconnect={stopMCP} />
        </div>
      </div>

    </div>
  )
}

import { Group, Panel, Separator } from 'react-resizable-panels'
import Sidebar from '@renderer/components/Sidebar/Sidebar'
import HomeView from '@renderer/views/HomeView'
import MCPIndicator from '@renderer/components/StatusBar/MCPIndicator'

const isMac = navigator.platform.toUpperCase().includes('MAC')

export default function MainLayout() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-neutral-900">
      {/* Drag region for macOS frameless window title bar */}
      {isMac && <div className="drag-region h-7 flex-shrink-0" />}

      <div className="flex flex-col" style={{ height: isMac ? 'calc(100vh - 28px)' : '100vh' }}>
        <div className="flex-1 overflow-hidden">
          <Group orientation="horizontal" id="main-layout">
            {/* Sidebar panel */}
            <Panel id="sidebar" defaultSize="22%" minSize="14%" maxSize="30%">
              <Sidebar />
            </Panel>

            {/* Resize handle */}
            <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />

            {/* Home/Planner content area */}
            <Panel id="home">
              <HomeView />
            </Panel>
          </Group>
        </div>

        {/* Status bar */}
        <div className="w-full h-7 flex-shrink-0 flex items-center px-3 bg-neutral-950 border-t border-neutral-800 no-drag">
          <MCPIndicator status="disconnected" />
        </div>
      </div>
    </div>
  )
}

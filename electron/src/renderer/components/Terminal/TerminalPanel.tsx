import { useState, useEffect, useCallback, useRef } from 'react'
import { MessageCircle, GripVertical } from 'lucide-react'
import TerminalTab from './TerminalTab'
import CLIQuickLaunch from './CLIQuickLaunch'

interface TerminalPanelProps {
  /** Project ID, used as a prefix for terminal session IDs */
  projectId: string
  /** Filesystem path for the project, used as the shell's cwd */
  projectPath: string
  /** Whether the chat panel is currently visible */
  showChat?: boolean
  /** Callback to toggle the chat panel */
  onToggleChat?: () => void
  /** Whether the terminal panel is on the left side */
  terminalOnLeft?: boolean
  /** Callback to swap panel positions */
  onSwapPanels?: () => void
}

interface TabInfo {
  id: string
  label: string
}

let tabCounter = 0

function createTabId(projectId: string): string {
  tabCounter++
  return `${projectId}-term-${tabCounter}`
}

/**
 * Terminal panel with a tab bar for managing multiple terminal sessions.
 *
 * - Sits on the left side of the project window
 * - Each tab is a separate PTY session
 * - "+" button adds a new tab
 * - Tabs can be closed via middle-click or context menu
 * - First tab is created automatically on mount
 */
export default function TerminalPanel({ projectId, projectPath, showChat, onToggleChat, terminalOnLeft, onSwapPanels }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    tabId: string
  } | null>(null)
  const mountedRef = useRef(false)
  const [terminalAvailable, setTerminalAvailable] = useState<boolean | null>(null)

  // ─── Create a new terminal tab ──────────────────────────────────────────
  const addTab = useCallback(async () => {
    const id = createTabId(projectId)

    // Tell main process to create the PTY
    await window.api.invoke('terminal:create', id, projectPath)

    setTabs((prev) => [...prev, { id, label: `Terminal ${prev.length + 1}` }])
    setActiveTabId(id)
  }, [projectId, projectPath])

  // ─── Close a terminal tab ──────────────────────────────────────────────
  const closeTab = useCallback(
    async (tabId: string) => {
      // Kill the PTY in main process
      await window.api.invoke('terminal:kill', tabId)

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabId)

        // If we're closing the active tab, switch to the last remaining tab
        if (activeTabId === tabId) {
          const newActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null
          setActiveTabId(newActive)
        }

        return remaining
      })
    },
    [activeTabId]
  )

  // ─── Launch a CLI tool in a new terminal tab ──────────────────────────────
  const launchCLI = useCallback(async (label: string, command: string) => {
    const id = createTabId(projectId)
    await window.api.invoke('terminal:create', id, projectPath)
    setTabs((prev) => [...prev, { id, label }])
    setActiveTabId(id)
    // Brief delay to let the shell initialize, then write the command
    setTimeout(() => {
      window.api.send('terminal:write', id, command + '\n')
    }, 300)
  }, [projectId, projectPath])

  // ─── Check availability and create first tab on mount ────────────────────
  useEffect(() => {
    // Guard against React Strict Mode double-mount
    if (mountedRef.current) return
    mountedRef.current = true

    window.api.invoke('terminal:available').then((available: unknown) => {
      const isAvailable = available === true
      setTerminalAvailable(isAvailable)
      if (isAvailable) addTab()
    }).catch(() => {
      setTerminalAvailable(false)
    })

    // Cleanup: kill all terminals when panel unmounts
    return () => {
      setTabs((currentTabs) => {
        currentTabs.forEach((tab) => {
          window.api.invoke('terminal:kill', tab.id).catch(() => {})
        })
        return currentTabs
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Context menu close handler ─────────────────────────────────────────
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])

  // ─── Listen for PTY exit to update tabs ─────────────────────────────────
  useEffect(() => {
    const removeListener = window.api.on(
      'terminal:exit',
      (id: unknown) => {
        // Optionally auto-close the tab or just let the user see the exit message
        // For now, keep the tab open so the user sees the exit message
      }
    )
    return removeListener
  }, [])

  if (terminalAvailable === false) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#171717] text-neutral-400 gap-3 px-8 text-center">
        <span className="text-2xl">⚠</span>
        <p className="text-sm font-medium text-neutral-300">Terminal not available</p>
        <p className="text-xs leading-relaxed">
          The terminal requires native build tools that weren&apos;t found during installation.
          Install build tools for your platform and reinstall CodeFire:
        </p>
        <ul className="text-xs text-neutral-500 list-disc text-left space-y-1">
          <li><strong>Windows:</strong> Install Visual Studio Build Tools with &quot;Desktop development with C++&quot;</li>
          <li><strong>Linux:</strong> <code className="bg-neutral-800 px-1 rounded">sudo apt install build-essential python3</code></li>
        </ul>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#171717]">
      {/* ─── Tab Bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center h-9 bg-[#0a0a0a] border-b border-[#262626] select-none shrink-0">
        {/* Drag grip for swapping columns */}
        {onSwapPanels && (
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-codefire-panel', 'terminal')
              e.dataTransfer.effectAllowed = 'move'
            }}
            className="flex items-center justify-center w-7 h-9 cursor-grab active:cursor-grabbing text-[#525252] hover:text-[#737373] transition-colors"
            title="Drag to swap panel position"
          >
            <GripVertical size={14} />
          </div>
        )}
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-none">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`
                flex items-center gap-1.5 px-3 h-9 text-xs font-medium whitespace-nowrap
                border-r border-[#262626] transition-colors
                ${
                  tab.id === activeTabId
                    ? 'bg-[#171717] text-[#e5e5e5]'
                    : 'bg-[#0a0a0a] text-[#737373] hover:text-[#a3a3a3] hover:bg-[#0f0f0f]'
                }
              `}
              onClick={() => setActiveTabId(tab.id)}
              onAuxClick={(e) => {
                // Middle-click to close
                if (e.button === 1) {
                  e.preventDefault()
                  closeTab(tab.id)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
              }}
            >
              <span className="text-[#f97316] text-[10px]">&#9654;</span>
              <span>{tab.label}</span>
              {tabs.length > 1 && (
                <span
                  className="ml-1 text-[#525252] hover:text-[#e5e5e5] cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }}
                >
                  &times;
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Add tab button */}
        <button
          className="flex items-center justify-center w-9 h-9 text-[#737373] hover:text-[#e5e5e5] hover:bg-[#1a1a1a] transition-colors"
          onClick={addTab}
          title="New Terminal"
        >
          <span className="text-lg leading-none">+</span>
        </button>

        {/* CLI Quick Launch */}
        <div className="w-px h-4 bg-[#262626]" />
        <CLIQuickLaunch onLaunch={launchCLI} projectPath={projectPath} />

        {/* Chat Mode toggle */}
        {onToggleChat && (
          <>
            <div className="w-px h-4 bg-[#262626]" />
            <button
              className={`flex items-center gap-1.5 px-3 h-9 text-xs font-medium transition-colors ${
                showChat
                  ? 'text-[#f97316] bg-[#f97316]/10'
                  : 'text-[#737373] hover:text-[#e5e5e5] hover:bg-[#1a1a1a]'
              }`}
              onClick={onToggleChat}
              title="Toggle Chat Mode"
            >
              <MessageCircle size={13} />
              <span>Chat Mode</span>
            </button>
          </>
        )}
      </div>

      {/* ─── Terminal Content ──────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {tabs.map((tab) => (
          <TerminalTab
            key={tab.id}
            terminalId={tab.id}
            isActive={tab.id === activeTabId}
          />
        ))}
      </div>

      {/* ─── Context Menu ──────────────────────────────────────────────────── */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1a1a1a] border border-[#333333] rounded shadow-lg py-1 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-xs text-left text-[#e5e5e5] hover:bg-[#2a2a2a] transition-colors"
            onClick={() => {
              closeTab(contextMenu.tabId)
              setContextMenu(null)
            }}
          >
            Close Terminal
          </button>
        </div>
      )}
    </div>
  )
}

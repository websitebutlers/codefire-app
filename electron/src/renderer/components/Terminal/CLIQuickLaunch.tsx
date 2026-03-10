import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, Settings, FileText, Plug } from 'lucide-react'
import { api } from '@renderer/lib/api'

interface CLIQuickLaunchProps {
  onLaunch: (label: string, command: string) => void
  projectPath?: string
}

interface CLIInfo {
  id: string
  label: string
  command: string
  color: string
  installed: boolean | null
}

const CLI_DEFS: Omit<CLIInfo, 'installed'>[] = [
  { id: 'claude', label: 'Claude', command: 'claude', color: '#c084fc' },
  { id: 'gemini', label: 'Gemini', command: 'gemini', color: '#60a5fa' },
  { id: 'codex', label: 'Codex', command: 'codex', color: '#34d399' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode', color: '#f97316' },
]

export default function CLIQuickLaunch({ onLaunch, projectPath }: CLIQuickLaunchProps) {
  const [clis, setClis] = useState<CLIInfo[]>(
    CLI_DEFS.map((c) => ({ ...c, installed: null }))
  )
  const [preferredCLI, setPreferredCLI] = useState<string>('claude')
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  // Detect installed CLIs and load preferred setting
  useEffect(() => {
    detectCLIs()
    api.settings.get().then((config) => {
      if (config?.preferredCLI) setPreferredCLI(config.preferredCLI)
    }).catch(() => {})
  }, [])

  const detectCLIs = useCallback(async () => {
    const results = await Promise.all(
      CLI_DEFS.map(async (cli) => {
        try {
          // Use which/where to check if CLI is on PATH
          const result = await window.api.invoke('terminal:available') as boolean
          if (!result) return { ...cli, installed: false }
          // We can't easily run `which` via IPC, so just mark as unknown
          // and let the user try to launch
          return { ...cli, installed: null }
        } catch {
          return { ...cli, installed: null }
        }
      })
    )
    setClis(results)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!openMenu) return
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-cli-menu]')) setOpenMenu(null)
    }
    document.addEventListener('click', handle)
    return () => document.removeEventListener('click', handle)
  }, [openMenu])

  function handleLaunch(cli: CLIInfo) {
    setOpenMenu(null)
    onLaunch(cli.label, cli.command)
  }

  async function handleSetPreferred(cliId: string) {
    setPreferredCLI(cliId)
    setOpenMenu(null)
    await api.settings.set({ preferredCLI: cliId as 'claude' | 'gemini' | 'codex' }).catch(() => {})
  }

  async function handleSetupMCP(cliId: string) {
    setOpenMenu(null)
    await api.context.installMCP(cliId).catch(() => {})
  }

  async function handleSetupInstructions(cliId: string) {
    setOpenMenu(null)
    if (projectPath) {
      await api.context.injectInstruction(cliId, projectPath).catch(() => {})
    }
  }

  return (
    <div className="flex items-center gap-0.5 px-1">
      {clis.map((cli) => {
        const isPreferred = cli.id === preferredCLI
        const isOpen = openMenu === cli.id

        return (
          <div key={cli.id} className="relative" data-cli-menu>
            {/* Main launch button */}
            <div
              className={`flex items-stretch rounded transition-colors ${
                isPreferred
                  ? 'bg-[#1a1a1a] border border-[#333]'
                  : 'hover:bg-[#1a1a1a]'
              }`}
            >
              <button
                className="flex items-center gap-1 px-2 py-1 rounded-l text-[10px] font-medium"
                style={{ color: cli.color }}
                onClick={() => handleLaunch(cli)}
                title={`Launch ${cli.label}`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: cli.color, opacity: 0.7 }}
                />
                {cli.label}
              </button>
              <button
                className={`flex items-center px-1 rounded-r text-[10px] transition-colors ${
                  isPreferred ? 'border-l border-[#333]' : ''
                }`}
                style={{ color: cli.color }}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpenMenu(isOpen ? null : cli.id)
                }}
              >
                <ChevronDown size={10} />
              </button>
            </div>

            {/* Dropdown menu */}
            {isOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-[#1a1a1a] border border-[#333] rounded shadow-lg py-1 min-w-[160px]">
                <button
                  className="w-full px-3 py-1.5 text-[11px] text-left text-[#e5e5e5] hover:bg-[#2a2a2a] flex items-center gap-2"
                  onClick={() => handleLaunch(cli)}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cli.color }} />
                  Launch {cli.label}
                </button>
                <div className="h-px bg-[#333] my-1" />
                <button
                  className="w-full px-3 py-1.5 text-[11px] text-left text-[#a3a3a3] hover:bg-[#2a2a2a] flex items-center gap-2"
                  onClick={() => handleSetupMCP(cli.id)}
                >
                  <Plug size={10} />
                  Setup MCP
                </button>
                <button
                  className="w-full px-3 py-1.5 text-[11px] text-left text-[#a3a3a3] hover:bg-[#2a2a2a] flex items-center gap-2"
                  onClick={() => handleSetupInstructions(cli.id)}
                >
                  <FileText size={10} />
                  Setup Instructions
                </button>
                <div className="h-px bg-[#333] my-1" />
                <button
                  className={`w-full px-3 py-1.5 text-[11px] text-left flex items-center gap-2 ${
                    isPreferred ? 'text-[#f97316]' : 'text-[#a3a3a3] hover:bg-[#2a2a2a]'
                  }`}
                  onClick={() => handleSetPreferred(cli.id)}
                >
                  <Settings size={10} />
                  {isPreferred ? 'Preferred CLI ✓' : 'Set as Preferred'}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

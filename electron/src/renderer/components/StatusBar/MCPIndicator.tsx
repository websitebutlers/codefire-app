import { useState, useRef, useEffect } from 'react'
import { Radio, Copy, Check, ExternalLink } from 'lucide-react'
import { api } from '@renderer/lib/api'

interface MCPIndicatorProps {
  status: 'connected' | 'disconnected' | 'error'
  sessionCount?: number
  onConnect?: () => void
  onDisconnect?: () => void
}

function buildSnippet(serverPath: string): string {
  const escaped = serverPath.replace(/\\/g, '\\\\')
  return JSON.stringify({
    mcpServers: {
      codefire: {
        command: 'node',
        args: [escaped],
      },
    },
  }, null, 2)
}

function getCLIProviders(serverPath: string) {
  const snippet = buildSnippet(serverPath)
  return [
    {
      name: 'Claude Code',
      id: 'claude',
      docsHint: 'Add to .mcp.json in your project root',
      snippet,
    },
    {
      name: 'Gemini CLI',
      id: 'gemini',
      docsHint: 'Add to ~/.gemini/settings.json',
      snippet,
    },
    {
      name: 'Codex CLI',
      id: 'codex',
      docsHint: 'Add to ~/.codex/config.json',
      snippet,
    },
    {
      name: 'OpenCode',
      id: 'opencode',
      docsHint: 'Add to ~/.opencode/config.json',
      snippet,
    },
  ]
}

export default function MCPIndicator({
  status,
  sessionCount,
  onConnect,
  onDisconnect,
}: MCPIndicatorProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [serverPath, setServerPath] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.mcp.getServerPath().then(setServerPath).catch(() => {})
  }, [])

  const providers = getCLIProviders(serverPath)

  const isConnected = status === 'connected'
  const isError = status === 'error'

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const statusColor = isConnected
    ? 'text-success'
    : isError
      ? 'text-error'
      : 'text-neutral-500'

  const dotColor = isConnected
    ? 'bg-success'
    : isError
      ? 'bg-error'
      : 'bg-neutral-600'

  const bgColor = isConnected
    ? 'bg-success/10'
    : isError
      ? 'bg-error/10'
      : 'bg-transparent'

  const tooltipText = isConnected
    ? `MCP connected${sessionCount ? ` (${sessionCount} session${sessionCount !== 1 ? 's' : ''})` : ''} — click to disconnect`
    : isError
      ? 'MCP connection error — click to reconnect'
      : 'MCP not connected — click to connect'

  function handleIndicatorClick() {
    if (isConnected) {
      onDisconnect?.()
    } else {
      onConnect?.()
    }
    setMenuOpen(!menuOpen)
  }

  async function handleCopy(snippet: string, id: string) {
    await navigator.clipboard.writeText(snippet)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="relative" ref={menuRef}>
      {/* Indicator button */}
      <button
        onClick={handleIndicatorClick}
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors hover:bg-neutral-800 ${bgColor}`}
        title={tooltipText}
      >
        <span
          className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dotColor} ${isConnected ? 'animate-pulse' : ''}`}
        />
        <Radio className={`w-3 h-3 flex-shrink-0 ${statusColor}`} />
        <span className={`text-tiny font-medium ${statusColor}`}>
          MCP
        </span>
        {isConnected && sessionCount !== undefined && sessionCount > 0 && (
          <span className="ml-0.5 px-1 py-px rounded-full bg-success text-white text-[9px] font-bold leading-none">
            {sessionCount}
          </span>
        )}
      </button>

      {/* Setup menu */}
      {menuOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-neutral-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotColor}`} />
                <span className="text-xs font-semibold text-neutral-200">
                  MCP Server — {isConnected ? 'Connected' : isError ? 'Error' : 'Not Connected'}
                </span>
              </div>
              {isConnected ? (
                <button
                  onClick={() => { onDisconnect?.(); setMenuOpen(false) }}
                  className="px-2 py-0.5 rounded text-[10px] font-semibold text-error hover:bg-error/10 transition-colors"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => { onConnect?.(); setMenuOpen(false) }}
                  className="px-2 py-0.5 rounded text-[10px] font-semibold text-success hover:bg-success/10 transition-colors"
                >
                  Connect
                </button>
              )}
            </div>
            {isConnected && sessionCount !== undefined && sessionCount > 0 && (
              <p className="text-[10px] text-neutral-500 mt-1 ml-[18px]">
                {sessionCount} active session{sessionCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>

          {/* Provider list */}
          <div className="py-1">
            <div className="px-3 py-1.5">
              <span className="text-[10px] font-semibold text-neutral-600 uppercase tracking-wider">
                Setup for CLI Provider
              </span>
            </div>
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="px-3 py-2 hover:bg-neutral-800/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-300">
                    {provider.name}
                  </span>
                  <button
                    onClick={() => handleCopy(provider.snippet, provider.id)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700 transition-colors"
                    title="Copy config snippet"
                  >
                    {copiedId === provider.id ? (
                      <>
                        <Check size={10} className="text-success" />
                        <span className="text-success">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={10} />
                        <span>Copy Config</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[10px] text-neutral-600 mt-0.5">{provider.docsHint}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

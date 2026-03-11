import { useState, useEffect } from 'react'
import { Plug, X } from 'lucide-react'

interface MCPBannerProps {
  projectPath: string
}

export default function MCPBanner({ projectPath }: MCPBannerProps) {
  const [visible, setVisible] = useState(false)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    window.api.invoke('mcp:checkProjectConfig', projectPath).then((raw) => {
      const result = raw as { connected: boolean }
      if (!result.connected) {
        window.api.invoke('settings:get').then((rawConfig) => {
          const config = rawConfig as { mcpDismissedProjects?: string[] }
          const dismissed = config.mcpDismissedProjects || []
          if (!dismissed.includes(projectPath)) {
            setVisible(true)
          }
        })
      }
    })
  }, [projectPath])

  if (!visible) return null

  const handleConnect = async () => {
    setConnecting(true)
    try {
      await window.api.invoke('mcp:installProjectConfig', projectPath)
      setVisible(false)
    } catch (err) {
      console.error('Failed to install MCP config:', err)
    } finally {
      setConnecting(false)
    }
  }

  const handleDismiss = async () => {
    setVisible(false)
    try {
      const config = await window.api.invoke('settings:get') as { mcpDismissedProjects?: string[] }
      const dismissed = [...(config.mcpDismissedProjects || []), projectPath]
      await window.api.invoke('settings:set', { mcpDismissedProjects: dismissed })
    } catch { /* non-critical */ }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border-b border-blue-500/20 text-xs text-blue-300">
      <Plug size={14} />
      <span>This project isn't connected to CodeFire's MCP server.</span>
      <button
        onClick={handleConnect}
        disabled={connecting}
        className="px-2 py-0.5 bg-blue-500/20 hover:bg-blue-500/30 rounded text-blue-200 transition-colors"
      >
        {connecting ? 'Connecting...' : 'Connect'}
      </button>
      <button
        onClick={handleDismiss}
        className="ml-auto p-0.5 hover:bg-white/10 rounded transition-colors"
        title="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  )
}

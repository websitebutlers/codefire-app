import { useState, useEffect, useCallback } from 'react'
import { api } from '@renderer/lib/api'

type MCPStatus = 'connected' | 'disconnected' | 'error'

export function useMCPStatus() {
  const [mcpStatus, setMcpStatus] = useState<MCPStatus>('disconnected')
  const [mcpSessionCount, setMcpSessionCount] = useState(0)

  useEffect(() => {
    // Initial fetch
    api.mcp.status().then(({ status, sessionCount }) => {
      setMcpStatus(status)
      setMcpSessionCount(sessionCount)
    }).catch(() => {
      // Handler may not be registered if mcpServerAutoStart is off
    })

    // Listen for status change events from main process
    const unsub = window.api.on('mcp:statusChanged', (data: unknown) => {
      const { status, sessionCount } = data as { status: MCPStatus; sessionCount: number }
      setMcpStatus(status)
      setMcpSessionCount(sessionCount)
    })

    return unsub
  }, [])

  const startMCP = useCallback(async () => {
    await api.mcp.start()
  }, [])

  const stopMCP = useCallback(async () => {
    await api.mcp.stop()
  }, [])

  return { mcpStatus, mcpSessionCount, startMCP, stopMCP }
}

/**
 * Deferred variant — delays the initial IPC fetch so it doesn't compete
 * with critical window-load calls (project data, tasks).
 */
export function useDeferredMCPStatus() {
  const [mcpStatus, setMcpStatus] = useState<MCPStatus>('disconnected')
  const [mcpSessionCount, setMcpSessionCount] = useState(0)

  useEffect(() => {
    // Defer initial fetch to after first paint
    const id = setTimeout(() => {
      api.mcp.status().then(({ status, sessionCount }) => {
        setMcpStatus(status)
        setMcpSessionCount(sessionCount)
      }).catch(() => {})
    }, 300)

    const unsub = window.api.on('mcp:statusChanged', (data: unknown) => {
      const { status, sessionCount } = data as { status: MCPStatus; sessionCount: number }
      setMcpStatus(status)
      setMcpSessionCount(sessionCount)
    })

    return () => {
      clearTimeout(id)
      unsub()
    }
  }, [])

  const startMCP = useCallback(async () => {
    await api.mcp.start()
  }, [])

  const stopMCP = useCallback(async () => {
    await api.mcp.stop()
  }, [])

  return { mcpStatus, mcpSessionCount, startMCP, stopMCP }
}

import { useState, useEffect, useCallback } from 'react'
import type { AgentMonitorState } from '@shared/models'

const EMPTY_STATE: AgentMonitorState = { claudeProcess: null, agents: [] }

/**
 * Hook that subscribes to agent process detection updates from the main process.
 * Returns the current state of detected Claude Code agents.
 */
export function useAgentMonitor(): AgentMonitorState {
  const [state, setState] = useState<AgentMonitorState>(EMPTY_STATE)

  // Fetch initial state on mount
  const fetchState = useCallback(async () => {
    try {
      const result = await window.api.invoke('agent:getState') as AgentMonitorState | null
      if (result) setState(result)
    } catch {
      // agent:getState not yet registered (during startup)
    }
  }, [])

  useEffect(() => {
    fetchState()

    // Subscribe to push updates from main process
    const unsubscribe = window.api.on('agent:update', (data: unknown) => {
      setState(data as AgentMonitorState)
    })

    return unsubscribe
  }, [fetchState])

  return state
}

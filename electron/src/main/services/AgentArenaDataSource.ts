import { AgentMonitor, AgentProcessInfo } from './AgentMonitor'
import { LiveSessionWatcher } from './LiveSessionWatcher'
import { parseLiveSession, LiveSessionState } from './SessionParser'
import fs from 'fs'
import path from 'path'

/** State structure pushed to the Arena HTML canvas */
interface ArenaState {
  orchestrator?: {
    active: boolean
    elapsed: number
  }
  agents: AgentAgentState[]
}

interface AgentAgentState {
  id: string
  type: string
  state: 'active' | 'idle' | 'frozen'
  elapsed: number
}

/** Maps tool_use activity to agent type names */
const AGENT_TOOL_NAMES = ['Task', 'Agent', 'agent']

/**
 * Merges process monitoring data (AgentMonitor) with live session activity
 * (LiveSessionWatcher) to produce the state structure consumed by the
 * agent-arena.html canvas renderer.
 */
export class AgentArenaDataSource {
  private monitor: AgentMonitor
  private sessionWatcher: LiveSessionWatcher
  private lastState: ArenaState | null = null
  private agentTypeCache = new Map<number, string>()

  constructor(monitor: AgentMonitor, sessionWatcher: LiveSessionWatcher) {
    this.monitor = monitor
    this.sessionWatcher = sessionWatcher
  }

  /**
   * Build the current arena state by merging process + session data.
   */
  getState(): ArenaState {
    const main = this.monitor.mainProcess
    const agents = this.monitor.agents

    if (!main) {
      this.agentTypeCache.clear()
      return { agents: [] }
    }

    // Try to extract agent types from live session activity
    const sessionActivity = this.getRecentSessionActivity()

    const agentStates: AgentAgentState[] = agents.map((agent, index) => {
      // Try to determine the agent type from session activity
      const agentType = this.resolveAgentType(agent, index, sessionActivity)

      // Determine state
      let state: 'active' | 'idle' | 'frozen' = 'active'
      if (agent.elapsedSeconds > 180) {
        state = 'frozen'
      }

      return {
        id: String(agent.pid),
        type: agentType,
        state,
        elapsed: agent.elapsedSeconds,
      }
    })

    const arenaState: ArenaState = {
      orchestrator: {
        active: agents.length > 0,
        elapsed: main.elapsedSeconds,
      },
      agents: agentStates,
    }

    this.lastState = arenaState
    return arenaState
  }

  /**
   * Returns the arena state as a JSON string for injection into the WebView.
   */
  jsonString(): string | null {
    const state = this.getState()
    if (!state.orchestrator && state.agents.length === 0) return null
    return JSON.stringify(state)
  }

  /**
   * Attempt to extract recent activity from the live session to identify agent types.
   */
  private getRecentSessionActivity(): Array<{ toolName: string; detail: string }> {
    // Find the active session file and parse it
    const sessionFile = this.sessionWatcher.findActiveSession()
    if (!sessionFile) return []

    try {
      const content = fs.readFileSync(sessionFile, 'utf-8')
      const sessionId = path.basename(sessionFile, '.jsonl')
      const state: LiveSessionState = parseLiveSession(content, sessionId)

      // Extract tool_use activities that look like agent spawns
      return state.recentActivity
        .filter((a) => a.type === 'toolUse' && AGENT_TOOL_NAMES.some((t) => a.detail.includes(t)))
        .map((a) => {
          // Activity detail format: "ToolName" or "ToolName  description"
          const parts = a.detail.split(/\s{2,}/)
          return {
            toolName: parts[0] || '',
            detail: parts[1] || parts[0] || 'Agent',
          }
        })
    } catch {
      return []
    }
  }

  /**
   * Resolve the agent type/name for a given process.
   * Uses cached types when available, falls back to session activity analysis.
   */
  private resolveAgentType(
    agent: AgentProcessInfo,
    index: number,
    activity: Array<{ toolName: string; detail: string }>
  ): string {
    // Check cache first
    if (this.agentTypeCache.has(agent.pid)) {
      return this.agentTypeCache.get(agent.pid)!
    }

    // Try to match from recent activity (newest first)
    if (activity.length > index) {
      const match = activity[index]
      if (match) {
        this.agentTypeCache.set(agent.pid, match.detail)
        return match.detail
      }
    }

    // Fallback: try to extract type from command line
    const cmd = agent.command
    if (cmd.includes('Explore')) {
      this.agentTypeCache.set(agent.pid, 'Explore')
      return 'Explore'
    }

    // Default
    const defaultType = 'Agent'
    this.agentTypeCache.set(agent.pid, defaultType)
    return defaultType
  }
}

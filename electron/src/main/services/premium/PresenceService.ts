import { getSupabaseClient } from './SupabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { PresenceState } from '../../../shared/premium-models'

export class PresenceService {
  private channels: Map<string, RealtimeChannel> = new Map()
  private presenceState: Map<string, PresenceState[]> = new Map()
  private onPresenceChange: ((projectId: string, states: PresenceState[]) => void) | null = null

  setOnPresenceChange(callback: (projectId: string, states: PresenceState[]) => void) {
    this.onPresenceChange = callback
  }

  async joinProject(projectId: string, userState: Omit<PresenceState, 'status'>) {
    const client = getSupabaseClient()
    if (!client) return

    // Leave existing channel for this project if any
    await this.leaveProject(projectId)

    const channel = client.channel(`presence:${projectId}`, {
      config: { presence: { key: userState.userId } }
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const seen = new Map<string, PresenceState>()
        for (const [, presences] of Object.entries(state)) {
          // Each key can have multiple connections — take only the latest per userId
          for (const p of presences as any[]) {
            if (!seen.has(p.userId)) {
              seen.set(p.userId, {
                userId: p.userId,
                displayName: p.displayName,
                avatarUrl: p.avatarUrl || null,
                activeFile: p.activeFile,
                gitBranch: p.gitBranch,
                onlineAt: p.onlineAt,
                status: 'active',
              })
            }
          }
        }
        const states = Array.from(seen.values())
        this.presenceState.set(projectId, states)
        this.onPresenceChange?.(projectId, states)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId: userState.userId,
            displayName: userState.displayName,
            avatarUrl: userState.avatarUrl,
            activeFile: userState.activeFile,
            gitBranch: userState.gitBranch,
            onlineAt: new Date().toISOString(),
          })
        }
      })

    this.channels.set(projectId, channel)
  }

  async leaveProject(projectId: string) {
    const channel = this.channels.get(projectId)
    if (channel) {
      await channel.untrack()
      const client = getSupabaseClient()
      client?.removeChannel(channel)
      this.channels.delete(projectId)
      this.presenceState.delete(projectId)
    }
  }

  getPresence(projectId: string): PresenceState[] {
    return this.presenceState.get(projectId) || []
  }

  async leaveAll() {
    for (const projectId of this.channels.keys()) {
      await this.leaveProject(projectId)
    }
  }
}

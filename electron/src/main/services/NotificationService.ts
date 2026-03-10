import { Notification } from 'electron'
import { readConfig } from './ConfigStore'

/**
 * System notification service — sends native OS notifications
 * for events like email arrival and CLI session completion.
 */
export class NotificationService {
  private static instance: NotificationService | null = null

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService()
    }
    return NotificationService.instance
  }

  private isSupported(): boolean {
    try {
      return Notification.isSupported()
    } catch {
      return false
    }
  }

  /** Notify when new actionable emails arrive (if setting enabled) */
  notifyNewEmails(count: number): void {
    const config = readConfig()
    if (!config.notifyOnNewEmail) return
    if (!this.isSupported()) return

    const n = new Notification({
      title: 'New Emails',
      body: count === 1
        ? '1 new actionable email'
        : `${count} new actionable emails`,
    })
    n.show()
  }

  /** Notify when a CLI session (Claude, Gemini, etc.) finishes */
  notifyClaudeDone(terminalId: string): void {
    const config = readConfig()
    if (!config.notifyOnClaudeDone) return
    if (!this.isSupported()) return

    const label = friendlyTerminalName(terminalId)

    const n = new Notification({
      title: `${label} Finished`,
      body: `${label} session has completed`,
    })
    n.show()
  }
}

function friendlyTerminalName(id: string): string {
  const lower = id.toLowerCase()
  if (lower.includes('claude')) return 'Claude Code'
  if (lower.includes('gemini')) return 'Gemini CLI'
  if (lower.includes('codex')) return 'Codex CLI'
  if (lower.includes('opencode')) return 'OpenCode'
  return 'Terminal'
}

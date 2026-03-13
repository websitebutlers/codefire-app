import Database from 'better-sqlite3'

export interface AuditLogEntry {
  id: number
  timestamp: string
  agentPid: number | null
  projectId: string | null
  toolName: string
  toolCategory: string | null
  parameters: string | null
  resultStatus: string
  durationMs: number | null
  sessionSlug: string | null
}

const SENSITIVE_KEYS = ['token', 'password', 'secret', 'key', 'cookie', 'authorization', 'credential']

function redactParams(params: Record<string, unknown> | undefined): string | null {
  if (!params || Object.keys(params).length === 0) return null
  const redacted: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    if (SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s))) {
      redacted[k] = '[REDACTED]'
    } else {
      redacted[k] = v
    }
  }
  return JSON.stringify(redacted)
}

export class AuditLogDAO {
  constructor(private db: Database.Database) {}

  log(entry: {
    agentPid?: number
    projectId?: string
    toolName: string
    toolCategory?: string
    parameters?: Record<string, unknown>
    resultStatus: string
    durationMs?: number
    sessionSlug?: string
  }): void {
    this.db
      .prepare(
        `INSERT INTO agentAuditLog (agentPid, projectId, toolName, toolCategory, parameters, resultStatus, durationMs, sessionSlug)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.agentPid ?? null,
        entry.projectId ?? null,
        entry.toolName,
        entry.toolCategory ?? null,
        redactParams(entry.parameters),
        entry.resultStatus,
        entry.durationMs ?? null,
        entry.sessionSlug ?? null
      )
  }

  listByProject(projectId: string, limit = 100, offset = 0): AuditLogEntry[] {
    return this.db
      .prepare('SELECT * FROM agentAuditLog WHERE projectId = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?')
      .all(projectId, limit, offset) as AuditLogEntry[]
  }

  listByTool(toolName: string, limit = 100): AuditLogEntry[] {
    return this.db
      .prepare('SELECT * FROM agentAuditLog WHERE toolName = ? ORDER BY timestamp DESC LIMIT ?')
      .all(toolName, limit) as AuditLogEntry[]
  }

  listRecent(limit = 100): AuditLogEntry[] {
    return this.db
      .prepare('SELECT * FROM agentAuditLog ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as AuditLogEntry[]
  }

  cleanup(olderThanDays = 30): number {
    const result = this.db
      .prepare("DELETE FROM agentAuditLog WHERE timestamp < datetime('now', '-' || ? || ' days')")
      .run(olderThanDays)
    return result.changes
  }
}

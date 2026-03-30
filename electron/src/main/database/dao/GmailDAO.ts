import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { GmailAccount, WhitelistRule, ProcessedEmail } from '@shared/models'

export class GmailDAO {
  constructor(private db: Database.Database) {}

  // ─── Accounts ────────────────────────────────────────────────────────────────

  list(): GmailAccount[] {
    return this.db
      .prepare('SELECT * FROM gmailAccounts ORDER BY createdAt DESC')
      .all() as GmailAccount[]
  }

  getById(id: string): GmailAccount | undefined {
    return this.db
      .prepare('SELECT * FROM gmailAccounts WHERE id = ?')
      .get(id) as GmailAccount | undefined
  }

  getByEmail(email: string): GmailAccount | undefined {
    return this.db
      .prepare('SELECT * FROM gmailAccounts WHERE email = ?')
      .get(email) as GmailAccount | undefined
  }

  create(data: {
    email: string
    accessToken: string
    refreshToken: string
    expiresAt: string
  }): GmailAccount {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO gmailAccounts (id, email, isActive, createdAt, accessToken, refreshToken, tokenExpiresAt)
         VALUES (?, ?, 1, ?, ?, ?, ?)`
      )
      .run(id, data.email, now, data.accessToken, data.refreshToken, data.expiresAt)
    return this.getById(id)!
  }

  updateTokens(id: string, accessToken: string, refreshToken: string, expiresAt: string): void {
    this.db
      .prepare(
        `UPDATE gmailAccounts SET accessToken = ?, refreshToken = ?, tokenExpiresAt = ? WHERE id = ?`
      )
      .run(accessToken, refreshToken, expiresAt, id)
  }

  update(
    id: string,
    data: Partial<
      Pick<GmailAccount, 'email' | 'lastHistoryId' | 'isActive' | 'lastSyncAt'>
    >
  ): void {
    const existing = this.getById(id)
    if (!existing) return

    this.db
      .prepare(
        `UPDATE gmailAccounts
         SET email = ?, lastHistoryId = ?, isActive = ?, lastSyncAt = ?
         WHERE id = ?`
      )
      .run(
        data.email ?? existing.email,
        data.lastHistoryId !== undefined
          ? data.lastHistoryId
          : existing.lastHistoryId,
        data.isActive !== undefined ? data.isActive : existing.isActive,
        data.lastSyncAt !== undefined ? data.lastSyncAt : existing.lastSyncAt,
        id
      )
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM gmailAccounts WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  // ─── Whitelist Rules ─────────────────────────────────────────────────────────

  listRules(accountId?: string): WhitelistRule[] {
    if (accountId) {
      // WhitelistRules are global (not per-account in the schema), but we
      // provide this parameter for API compatibility.
      return this.db
        .prepare(
          'SELECT * FROM whitelistRules WHERE isActive = 1 ORDER BY priority DESC'
        )
        .all() as WhitelistRule[]
    }
    return this.db
      .prepare('SELECT * FROM whitelistRules ORDER BY priority DESC')
      .all() as WhitelistRule[]
  }

  createRule(data: {
    pattern: string
    clientId?: string
    priority?: number
    note?: string
  }): WhitelistRule {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO whitelistRules (id, pattern, clientId, priority, isActive, createdAt, note)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        id,
        data.pattern,
        data.clientId ?? null,
        data.priority ?? 0,
        now,
        data.note ?? null
      )
    return this.db
      .prepare('SELECT * FROM whitelistRules WHERE id = ?')
      .get(id) as WhitelistRule
  }

  deleteRule(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM whitelistRules WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  // ─── Processed Emails ────────────────────────────────────────────────────────

  isProcessed(messageId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM processedEmails WHERE gmailMessageId = ?')
      .get(messageId)
    return !!row
  }

  markProcessed(data: {
    messageId: string
    threadId: string
    accountId: string
    senderEmail: string
    senderName?: string
    subject: string
    snippet?: string
    body?: string
    receivedAt?: string
    taskId?: number
    triageType?: string
  }): ProcessedEmail {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO processedEmails
           (gmailMessageId, gmailThreadId, gmailAccountId, fromAddress, fromName, subject, snippet, body, receivedAt, taskId, triageType, importedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.messageId,
        data.threadId,
        data.accountId,
        data.senderEmail,
        data.senderName ?? null,
        data.subject,
        data.snippet ?? null,
        data.body ?? null,
        data.receivedAt ?? now,
        data.taskId ?? null,
        data.triageType ?? null,
        now
      )
    return this.db
      .prepare('SELECT * FROM processedEmails WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as ProcessedEmail
  }

  getProcessedEmailByMessageId(messageId: string): ProcessedEmail | undefined {
    return this.db
      .prepare('SELECT * FROM processedEmails WHERE gmailMessageId = ?')
      .get(messageId) as ProcessedEmail | undefined
  }

  getProcessedEmailByThreadId(threadId: string): ProcessedEmail[] {
    return this.db
      .prepare('SELECT * FROM processedEmails WHERE gmailThreadId = ? ORDER BY receivedAt ASC')
      .all(threadId) as ProcessedEmail[]
  }

  listProcessedEmails(accountId: string): ProcessedEmail[] {
    return this.db
      .prepare(
        'SELECT * FROM processedEmails WHERE gmailAccountId = ? ORDER BY importedAt DESC'
      )
      .all(accountId) as ProcessedEmail[]
  }
}

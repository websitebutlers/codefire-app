import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { TaskDAO } from '../database/dao/TaskDAO'
import { NoteDAO } from '../database/dao/NoteDAO'
import { SessionDAO } from '../database/dao/SessionDAO'
import { ProjectDAO } from '../database/dao/ProjectDAO'
import type { SearchEngine } from '../services/SearchEngine'

const MAX_CONTEXT_CHARS = 8000

function assembleContext(
  db: Database.Database,
  projectId: string,
  codeSnippets?: { filePath: string | null; content: string; symbolName: string | null; startLine: number | null; endLine: number | null }[]
): string {
  const projectDAO = new ProjectDAO(db)
  const taskDAO = new TaskDAO(db)
  const noteDAO = new NoteDAO(db)
  const sessionDAO = new SessionDAO(db)

  const project = projectDAO.getById(projectId)
  const projectName = project?.name?.split(/[/\\]/).pop() ?? 'this project'

  const parts: string[] = [
    `You are a helpful coding assistant with context about "${projectName}". Use the project context below to give informed answers. Be concise and helpful.`,
  ]

  // Code search results (RAG)
  if (codeSnippets && codeSnippets.length > 0) {
    parts.push('\nRELEVANT CODE (matching the question):')
    for (const s of codeSnippets.slice(0, 5)) {
      const loc = s.filePath
        ? `${s.filePath}${s.startLine ? `:${s.startLine}-${s.endLine}` : ''}`
        : 'unknown'
      const symbol = s.symbolName ? ` (${s.symbolName})` : ''
      parts.push(`--- ${loc}${symbol} ---\n${s.content.slice(0, 500)}`)
    }
  }

  // Active tasks (non-done, top 20 by priority)
  try {
    const tasks = taskDAO.list(projectId)
      .filter((t) => t.status !== 'done')
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .slice(0, 20)
    if (tasks.length > 0) {
      parts.push(`\nACTIVE TASKS (${tasks.length}):`)
      for (const t of tasks) {
        const priority = ['none', 'low', 'medium', 'high', 'critical'][t.priority ?? 0] ?? ''
        const desc = t.description ? `\n  ${t.description.slice(0, 120)}` : ''
        parts.push(`- [${priority}] ${t.title} (status: ${t.status})${desc}`)
      }
    }
  } catch { /* tasks table may not exist */ }

  // Pinned notes (top 5)
  try {
    const pinned = noteDAO.list(projectId, true).slice(0, 5)
    if (pinned.length > 0) {
      parts.push('\nPINNED NOTES:')
      for (const n of pinned) {
        parts.push(`## ${n.title}\n${(n.content ?? '').slice(0, 300)}`)
      }
    }
  } catch { /* notes table may not exist */ }

  // Recent sessions (top 5)
  try {
    const sessions = sessionDAO.list(projectId).slice(0, 5)
    if (sessions.length > 0) {
      parts.push('\nRECENT SESSIONS:')
      for (const s of sessions) {
        const date = s.startedAt ? new Date(s.startedAt).toLocaleDateString() : '?'
        const summary = s.summary ? `"${s.summary.slice(0, 80)}"` : 'no summary'
        parts.push(`- ${date}: ${summary} (${s.model ?? 'unknown model'})`)
      }
    }
  } catch { /* sessions table may not exist */ }

  // Enforce character budget
  let context = parts.join('\n')
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS) + '\n...(truncated)'
  }
  return context
}

export function registerChatHandlers(db: Database.Database, searchEngine?: SearchEngine, browserSessionToken?: string) {
  console.log('[chat-handlers] Registering chat IPC handlers')

  ipcMain.handle('chat:listConversations', (_e, projectId: string) => {
    try {
      return db
        .prepare('SELECT * FROM chatConversations WHERE projectId = ? ORDER BY updatedAt DESC')
        .all(projectId)
    } catch (err) {
      console.error('[chat:listConversations] Error:', err)
      return []
    }
  })

  ipcMain.handle('chat:getConversation', (_e, id: number) => {
    return db
      .prepare('SELECT * FROM chatConversations WHERE id = ?')
      .get(id)
  })

  ipcMain.handle('chat:createConversation', (_e, data: { projectId: string; title: string }) => {
    console.log('[chat:createConversation] Creating conversation:', data)
    try {
      const now = new Date().toISOString()
      const result = db
        .prepare('INSERT INTO chatConversations (projectId, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
        .run(data.projectId, data.title, now, now)
      const row = db
        .prepare('SELECT * FROM chatConversations WHERE id = ?')
        .get(result.lastInsertRowid)
      console.log('[chat:createConversation] Created:', row)
      return row
    } catch (err) {
      console.error('[chat:createConversation] Error:', err)
      throw err
    }
  })

  ipcMain.handle('chat:listMessages', (_e, conversationId: number) => {
    return db
      .prepare('SELECT * FROM chatMessages WHERE conversationId = ? ORDER BY createdAt ASC')
      .all(conversationId)
  })

  ipcMain.handle('chat:sendMessage', (_e, data: { conversationId: number; role: string; content: string }) => {
    console.log('[chat:sendMessage] Saving message for conversation:', data.conversationId, 'role:', data.role)
    try {
      const now = new Date().toISOString()
      const result = db
        .prepare('INSERT INTO chatMessages (conversationId, role, content, createdAt) VALUES (?, ?, ?, ?)')
        .run(data.conversationId, data.role, data.content, now)

      // Update conversation updatedAt
      db.prepare('UPDATE chatConversations SET updatedAt = ? WHERE id = ?')
        .run(now, data.conversationId)

      return db
        .prepare('SELECT * FROM chatMessages WHERE id = ?')
        .get(result.lastInsertRowid)
    } catch (err) {
      console.error('[chat:sendMessage] Error:', err)
      throw err
    }
  })

  ipcMain.handle('chat:deleteConversation', (_e, id: number) => {
    db.prepare('DELETE FROM chatMessages WHERE conversationId = ?').run(id)
    const result = db.prepare('DELETE FROM chatConversations WHERE id = ?').run(id)
    return result.changes > 0
  })

  // Insert a browser command into the browserCommands table for the BrowserView to execute
  const ALLOWED_BROWSER_TOOLS = new Set([
    'browser_navigate',
    'browser_snapshot',
    'browser_screenshot',
    'browser_click',
    'browser_type',
    'browser_console_logs',
    // browser_eval intentionally excluded — unrestricted JS execution
  ])

  ipcMain.handle('chat:getContext', async (_e, projectId: string, query?: string) => {
    try {
      let codeSnippets: { filePath: string | null; content: string; symbolName: string | null; startLine: number | null; endLine: number | null }[] | undefined
      if (query && searchEngine) {
        try {
          const results = await searchEngine.search(projectId, query, { limit: 5 })
          codeSnippets = results.map((r) => ({
            filePath: r.filePath,
            content: r.content,
            symbolName: r.symbolName,
            startLine: r.startLine,
            endLine: r.endLine,
          }))
        } catch {
          // Search failed — fall back to static context
        }
      }
      return assembleContext(db, projectId, codeSnippets)
    } catch (err) {
      console.error('[chat:getContext] Error:', err)
      return 'You are a helpful coding assistant integrated into CodeFire. Be concise and helpful.'
    }
  })

  ipcMain.handle('chat:browserCommand', (_e, tool: string, argsJSON: string) => {
    if (!tool || typeof tool !== 'string' || !ALLOWED_BROWSER_TOOLS.has(tool)) {
      throw new Error(`Invalid browser command tool: ${tool}`)
    }
    const now = new Date().toISOString()
    const result = db
      .prepare('INSERT INTO browserCommands (tool, args, status, createdAt, authToken) VALUES (?, ?, ?, ?, ?)')
      .run(tool, argsJSON, 'pending', now, browserSessionToken ?? null)
    return { id: result.lastInsertRowid }
  })
}

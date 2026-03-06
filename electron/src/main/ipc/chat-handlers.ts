import { ipcMain } from 'electron'
import Database from 'better-sqlite3'

export function registerChatHandlers(db: Database.Database) {
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
  ipcMain.handle('chat:browserCommand', (_e, tool: string, argsJSON: string) => {
    const now = new Date().toISOString()
    const result = db
      .prepare('INSERT INTO browserCommands (tool, args, status, createdAt) VALUES (?, ?, ?, ?)')
      .run(tool, argsJSON, 'pending', now)
    return { id: result.lastInsertRowid }
  })
}

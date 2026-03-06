import { ipcMain } from 'electron'
import Database from 'better-sqlite3'

export function registerBriefingHandlers(db: Database.Database) {
  ipcMain.handle('briefing:listDigests', () => {
    return db
      .prepare('SELECT * FROM briefingDigests ORDER BY generatedAt DESC LIMIT 20')
      .all()
  })

  ipcMain.handle('briefing:getDigest', (_e, id: number) => {
    return db
      .prepare('SELECT * FROM briefingDigests WHERE id = ?')
      .get(id)
  })

  ipcMain.handle('briefing:getItems', (_e, digestId: number) => {
    return db
      .prepare('SELECT * FROM briefingItems WHERE digestId = ? ORDER BY relevanceScore DESC')
      .all(digestId)
  })

  ipcMain.handle('briefing:generate', async (_e, _projectId: string) => {
    // Create a new digest record
    const now = new Date().toISOString()
    const result = db
      .prepare('INSERT INTO briefingDigests (generatedAt, itemCount, status) VALUES (?, 0, ?)')
      .run(now, 'generating')

    const digestId = result.lastInsertRowid as number

    // For now, mark as ready with 0 items (AI generation requires OpenRouter)
    // The actual generation happens client-side via the OpenRouter API
    db.prepare('UPDATE briefingDigests SET status = ? WHERE id = ?').run('ready', digestId)

    return db.prepare('SELECT * FROM briefingDigests WHERE id = ?').get(digestId)
  })

  ipcMain.handle('briefing:markRead', (_e, itemId: number) => {
    db.prepare('UPDATE briefingItems SET isRead = 1 WHERE id = ?').run(itemId)
  })

  ipcMain.handle('briefing:saveItem', (_e, itemId: number) => {
    db.prepare('UPDATE briefingItems SET isSaved = 1 WHERE id = ?').run(itemId)
  })
}

import Database from 'better-sqlite3'
import { registerProjectHandlers } from './project-handlers'
import { registerTaskHandlers } from './task-handlers'
import { registerNoteHandlers } from './note-handlers'
import { registerSessionHandlers } from './session-handlers'
import { registerClientHandlers } from './client-handlers'
import { registerWindowHandlers } from './window-handlers'
import { registerTerminalHandlers } from './terminal-handlers'
import type { WindowManager } from '../windows/WindowManager'
import type { TerminalService } from '../services/TerminalService'

export function registerAllHandlers(
  db: Database.Database,
  windowManager?: WindowManager,
  terminalService?: TerminalService
) {
  registerProjectHandlers(db)
  registerTaskHandlers(db)
  registerNoteHandlers(db)
  registerSessionHandlers(db)
  registerClientHandlers(db)
  if (windowManager) {
    registerWindowHandlers(windowManager)
  }
  if (terminalService) {
    registerTerminalHandlers(terminalService)
  }
}

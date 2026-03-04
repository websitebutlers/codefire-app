import Database from 'better-sqlite3'
import { registerProjectHandlers } from './project-handlers'
import { registerTaskHandlers } from './task-handlers'
import { registerNoteHandlers } from './note-handlers'
import { registerSessionHandlers } from './session-handlers'
import { registerClientHandlers } from './client-handlers'
import { registerWindowHandlers } from './window-handlers'
import { registerTerminalHandlers } from './terminal-handlers'
import { registerDiscoveryHandlers } from './discovery-handlers'
import { registerGitHandlers } from './git-handlers'
import { registerSearchHandlers } from './search-handlers'
import { registerGitHubHandlers } from './github-handlers'
import { registerGmailHandlers } from './gmail-handlers'
import { registerFileHandlers } from './file-handlers'
import { registerMemoryHandlers } from './memory-handlers'
import { registerRulesHandlers } from './rules-handlers'
import { registerServiceHandlers } from './service-handlers'
import { registerImageHandlers } from './image-handlers'
import { registerRecordingHandlers } from './recording-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import type { WindowManager } from '../windows/WindowManager'
import type { TerminalService } from '../services/TerminalService'
import type { GitService } from '../services/GitService'
import type { GitHubService } from '../services/GitHubService'
import type { GmailService } from '../services/GmailService'
import type { SearchEngine } from '../services/SearchEngine'
import type { ContextEngine } from '../services/ContextEngine'

export function registerAllHandlers(
  db: Database.Database,
  windowManager?: WindowManager,
  terminalService?: TerminalService,
  gitService?: GitService,
  githubService?: GitHubService,
  gmailService?: GmailService,
  searchEngine?: SearchEngine,
  contextEngine?: ContextEngine
) {
  registerProjectHandlers(db)
  registerTaskHandlers(db)
  registerNoteHandlers(db)
  registerSessionHandlers(db)
  registerClientHandlers(db)
  registerDiscoveryHandlers(db)
  if (windowManager) {
    registerWindowHandlers(windowManager)
  }
  if (terminalService) {
    registerTerminalHandlers(terminalService)
  }
  if (gitService) {
    registerGitHandlers(gitService)
  }
  if (githubService) {
    registerGitHubHandlers(githubService)
  }
  if (gmailService) {
    registerGmailHandlers(gmailService)
  }
  if (searchEngine && contextEngine) {
    registerSearchHandlers(db, searchEngine, contextEngine)
  }
  registerFileHandlers()
  registerMemoryHandlers()
  registerRulesHandlers()
  registerServiceHandlers()
  registerImageHandlers(db)
  registerRecordingHandlers(db)
  registerSettingsHandlers(db)
}

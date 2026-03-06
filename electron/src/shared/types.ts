// ─── IPC Channel Names ───────────────────────────────────────────────────────

export type ProjectChannel =
  | 'projects:list'
  | 'projects:get'
  | 'projects:getByPath'
  | 'projects:create'
  | 'projects:update'
  | 'projects:updateLastOpened'
  | 'projects:delete'

export type TaskChannel =
  | 'tasks:list'
  | 'tasks:listGlobal'
  | 'tasks:listAll'
  | 'tasks:get'
  | 'tasks:create'
  | 'tasks:update'
  | 'tasks:delete'
  | 'tasks:addAttachment'
  | 'tasks:removeAttachment'

export type TaskNoteChannel = 'taskNotes:list' | 'taskNotes:create'

export type NoteChannel =
  | 'notes:list'
  | 'notes:get'
  | 'notes:create'
  | 'notes:update'
  | 'notes:delete'
  | 'notes:search'

export type SessionChannel =
  | 'sessions:list'
  | 'sessions:get'
  | 'sessions:create'
  | 'sessions:update'
  | 'sessions:search'
  | 'sessions:getLiveState'

export type ClientChannel = 'clients:list' | 'clients:get' | 'clients:create' | 'clients:update' | 'clients:delete'

export type WindowChannel =
  | 'window:openProject'
  | 'window:closeProject'
  | 'window:getProjectWindows'
  | 'window:focusMain'

export type DiscoveryChannel = 'discovery:scanProjects' | 'discovery:importSessions'

export type GitChannel =
  | 'git:status'
  | 'git:diff'
  | 'git:log'
  | 'git:stage'
  | 'git:unstage'
  | 'git:commit'

export type GitHubChannel =
  | 'github:setToken'
  | 'github:getRepoInfo'
  | 'github:listPRs'
  | 'github:getPR'
  | 'github:listWorkflows'
  | 'github:listIssues'
  | 'github:listCommits'

export type ShellChannel = 'shell:showInExplorer' | 'shell:openExternal'

export type FileChannel = 'files:list' | 'files:read' | 'files:write' | 'dialog:selectFolder' | 'dialog:selectFiles'

export type MemoryChannel =
  | 'memory:getDir'
  | 'memory:list'
  | 'memory:read'
  | 'memory:write'
  | 'memory:delete'
  | 'memory:create'

export type RulesChannel = 'rules:list' | 'rules:read' | 'rules:write' | 'rules:create'

export type ServiceChannel =
  | 'services:detect'
  | 'services:listEnvFiles'
  | 'services:readEnvFile'
  | 'services:scanTemplates'

export type ImageChannel =
  | 'images:list'
  | 'images:get'
  | 'images:create'
  | 'images:delete'
  | 'images:generate'

export type RecordingChannel =
  | 'recordings:list'
  | 'recordings:get'
  | 'recordings:create'
  | 'recordings:update'
  | 'recordings:delete'
  | 'recordings:saveAudio'
  | 'recordings:transcribe'

export type MCPChannel = 'mcp:status' | 'mcp:getServerPath' | 'mcp:start' | 'mcp:stop'

export type BriefingChannel =
  | 'briefing:listDigests'
  | 'briefing:getDigest'
  | 'briefing:getItems'
  | 'briefing:generate'
  | 'briefing:markRead'
  | 'briefing:saveItem'

export type ChatChannel =
  | 'chat:listConversations'
  | 'chat:getConversation'
  | 'chat:createConversation'
  | 'chat:listMessages'
  | 'chat:sendMessage'
  | 'chat:deleteConversation'
  | 'chat:browserCommand'

export type UpdateChannel = 'update:check' | 'update:download'

/** Deep link result pushed from main → renderer */
export type DeepLinkReceiveChannel = 'deeplink:result'

export type SettingsChannel = 'settings:get' | 'settings:set'

export type DialogChannel = 'dialog:selectFolder'

export type SearchChannel = 'search:query' | 'search:reindex' | 'search:getIndexState' | 'search:clearIndex'

export type GmailChannel =
  | 'gmail:listAccounts'
  | 'gmail:authenticate'
  | 'gmail:removeAccount'
  | 'gmail:listRules'
  | 'gmail:addRule'
  | 'gmail:removeRule'
  | 'gmail:pollEmails'
  | 'gmail:listRecentEmails'
  | 'gmail:getEmailByMessageId'

/** Channels that use ipcMain.handle (request-response) */
export type TerminalHandleChannel = 'terminal:create' | 'terminal:kill'

/** Channels that use ipcRenderer.send (fire-and-forget, renderer → main) */
export type TerminalSendChannel = 'terminal:write' | 'terminal:resize'

/** Channels that use webContents.send (main → renderer) */
export type TerminalReceiveChannel = 'terminal:data' | 'terminal:exit'

export type IpcChannel =
  | ProjectChannel
  | TaskChannel
  | TaskNoteChannel
  | NoteChannel
  | SessionChannel
  | ClientChannel
  | WindowChannel
  | TerminalHandleChannel
  | DiscoveryChannel
  | GitChannel
  | GitHubChannel
  | SearchChannel
  | GmailChannel
  | FileChannel
  | MemoryChannel
  | RulesChannel
  | ServiceChannel
  | ImageChannel
  | RecordingChannel
  | MCPChannel
  | BriefingChannel
  | ChatChannel
  | UpdateChannel
  | SettingsChannel
  | DialogChannel
  | ShellChannel

// ─── Electron API ────────────────────────────────────────────────────────────

export interface ElectronAPI {
  invoke: (channel: IpcChannel, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  send: (channel: string, ...args: unknown[]) => void
  homePath: string
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

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

export type TaskNoteChannel = 'taskNotes:list' | 'taskNotes:create' | 'taskNotes:delete'

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
  | 'git:discard'
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

export type RulesChannel = 'rules:list' | 'rules:read' | 'rules:write' | 'rules:create' | 'rules:generate'

export type ServiceChannel =
  | 'services:detect'
  | 'services:listEnvFiles'
  | 'services:readEnvFile'
  | 'services:scanTemplates'
  | 'services:scanArchitecture'
  | 'services:scanSchema'

export type ImageChannel =
  | 'images:list'
  | 'images:get'
  | 'images:create'
  | 'images:delete'
  | 'images:generate'
  | 'images:edit'
  | 'images:readFile'
  | 'images:resetConversation'

export type RecordingChannel =
  | 'recordings:list'
  | 'recordings:get'
  | 'recordings:create'
  | 'recordings:update'
  | 'recordings:delete'
  | 'recordings:saveAudio'
  | 'recordings:transcribe'
  | 'recordings:importFile'

export type MCPChannel = 'mcp:status' | 'mcp:getServerPath' | 'mcp:listConnections' | 'mcp:start' | 'mcp:stop' | 'mcp:checkProjectConfig' | 'mcp:installProjectConfig'

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
  | 'chat:getContext'
  | 'chat:browserCommand'

export type UpdateChannel = 'update:check' | 'update:download'

/** Deep link result pushed from main → renderer */
export type DeepLinkReceiveChannel = 'deeplink:result'

export type SettingsChannel = 'settings:get' | 'settings:set'

export type ContextChannel =
  | 'context:setupProject'
  | 'context:injectInstruction'
  | 'context:removeInstruction'
  | 'context:hasInstruction'
  | 'context:installMCP'

export type AgentChannel = 'agent:getState'

export type BrowserCommandChannel = 'browser:executeCommand'

export type PremiumChannel =
  | 'premium:getStatus'
  | 'premium:signUp'
  | 'premium:signIn'
  | 'premium:signOut'
  | 'premium:createTeam'
  | 'premium:getTeam'
  | 'premium:listMembers'
  | 'premium:inviteMember'
  | 'premium:removeMember'
  | 'premium:updateMemberRole'
  | 'premium:listInvites'
  | 'premium:cancelInvite'
  | 'premium:acceptInvite'
  | 'premium:getMyInvites'
  | 'premium:acceptInviteById'
  | 'premium:syncProject'
  | 'premium:unsyncProject'
  | 'premium:listSyncedProjects'
  | 'premium:inviteToProject'
  | 'premium:getSyncStatus'
  | 'premium:getNotifications'
  | 'premium:markNotificationRead'
  | 'premium:markAllNotificationsRead'
  | 'premium:getActivityFeed'
  | 'premium:listSessionSummaries'
  | 'premium:shareSessionSummary'
  | 'premium:listProjectDocs'
  | 'premium:getProjectDoc'
  | 'premium:createProjectDoc'
  | 'premium:updateProjectDoc'
  | 'premium:deleteProjectDoc'
  | 'premium:requestReview'
  | 'premium:resolveReview'
  | 'premium:listReviewRequests'
  | 'premium:sendTeamMessage'
  | 'premium:joinPresence'
  | 'premium:leavePresence'
  | 'premium:getPresence'
  | 'premium:getBillingPortalUrl'
  | 'premium:createCheckoutSession'
  | 'premium:createCheckout'
  | 'premium:getBillingPortal'
  | 'premium:admin:isSuperAdmin'
  | 'premium:admin:searchUsers'
  | 'premium:admin:grantTeam'
  | 'premium:admin:revokeGrant'
  | 'premium:admin:listGrants'

export type ProjectDocChannel =
  | 'projectDocs:list'
  | 'projectDocs:get'
  | 'projectDocs:create'
  | 'projectDocs:update'
  | 'projectDocs:delete'

export type PatternChannel =
  | 'patterns:list'
  | 'patterns:get'
  | 'patterns:create'
  | 'patterns:update'
  | 'patterns:delete'
  | 'patterns:categories'

export type SearchChannel = 'search:query' | 'search:reindex' | 'search:getIndexState' | 'search:clearIndex'

export type GmailChannel =
  | 'gmail:listAccounts'
  | 'gmail:authenticate'
  | 'gmail:removeAccount'
  | 'gmail:listRules'
  | 'gmail:addRule'
  | 'gmail:removeRule'
  | 'gmail:pollEmails'
  | 'gmail:processNewEmails'
  | 'gmail:listRecentEmails'
  | 'gmail:getEmailByMessageId'

/** Channels that use ipcMain.handle (request-response) */
export type TerminalHandleChannel = 'terminal:create' | 'terminal:kill' | 'terminal:available' | 'terminal:saveClipboardImage'

/** Channels that use ipcRenderer.send (fire-and-forget, renderer → main) */
export type TerminalSendChannel = 'terminal:write' | 'terminal:writeToActive' | 'terminal:resize'

/** Channels that use webContents.send (main → renderer) */
export type TerminalReceiveChannel = 'terminal:data' | 'terminal:exit' | 'terminal:created'

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
  | ShellChannel
  | BrowserCommandChannel
  | PremiumChannel
  | ProjectDocChannel
  | PatternChannel
  | ContextChannel
  | AgentChannel

// ─── Electron API ────────────────────────────────────────────────────────────

export interface ElectronAPI {
  invoke: (channel: IpcChannel, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  send: (channel: string, ...args: unknown[]) => void
  homePath: string
  /**
   * Returns the absolute filesystem path for an HTML `File` object.
   * Replaces the deprecated `File.path` monkey-patch that Electron
   * removed in v32. Call on files from drag-drop events or file inputs.
   */
  getPathForFile: (file: File) => string
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

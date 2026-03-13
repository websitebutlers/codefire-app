// ─── Core Models ──────────────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  path: string
  claudeProject: string | null
  lastOpened: string | null
  createdAt: string
  clientId: string | null
  tags: string | null
  sortOrder: number
  repoUrl: string | null
  color: string | null
}

export interface Session {
  id: string
  projectId: string
  slug: string | null
  startedAt: string | null
  endedAt: string | null
  model: string | null
  gitBranch: string | null
  title: string | null
  summary: string | null
  messageCount: number
  toolUseCount: number
  filesChanged: string | null
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

export interface LiveSessionState {
  sessionId: string
  slug: string | null
  model: string | null
  gitBranch: string | null
  startedAt: string | null
  lastActivity: string | null
  totalInputTokens: number
  totalOutputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  latestContextTokens: number
  messageCount: number
  userMessageCount: number
  toolUseCount: number
  filesChanged: string[]
  toolCounts: { name: string; count: number }[]
  recentActivity: { timestamp: string; type: 'userMessage' | 'assistantText' | 'toolUse'; detail: string }[]
  estimatedCost: number
  contextUsagePercent: number
  elapsedFormatted: string
  isActive: boolean
}

export interface TaskItem {
  id: number
  projectId: string
  title: string
  description: string | null
  status: string // 'todo' | 'in_progress' | 'done'
  priority: number // 0-4
  sourceSession: string | null
  source: string // 'manual' | 'claude' | 'ai-extracted'
  labels: string | null // JSON array
  attachments: string | null // JSON array
  isGlobal: number // 0 or 1 (SQLite boolean)
  gmailThreadId: string | null
  gmailMessageId: string | null
  recordingId: string | null
  remoteOwnerId: string | null
  remoteOwnerName: string | null
  completedBy: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string | null
  completedAt: string | null
}

export interface TaskNote {
  id: number
  taskId: number
  content: string
  source: string // 'manual' | 'claude' | 'system'
  sessionId: string | null
  mentions: string | null // JSON array of user UUIDs
  createdAt: string
}

export interface Note {
  id: number
  projectId: string
  title: string
  content: string
  pinned: number // 0 or 1
  sessionId: string | null
  isGlobal: number // 0 or 1
  remoteOwnerId: string | null
  remoteOwnerName: string | null
  createdAt: string
  updatedAt: string
}

export interface Client {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: string
}

// ─── Context Engine Models ────────────────────────────────────────────────────

export interface CodeChunk {
  id: string
  fileId: string
  projectId: string
  chunkType: string
  symbolName: string | null
  content: string
  startLine: number | null
  endLine: number | null
  embedding: Buffer | null
}

export interface IndexedFile {
  id: string
  projectId: string
  relativePath: string
  contentHash: string
  language: string | null
  lastIndexedAt: string
}

export interface IndexState {
  projectId: string
  status: string // 'idle' | 'indexing' | etc.
  lastFullIndexAt: string | null
  totalChunks: number
  lastError: string | null
}

export interface IndexRequest {
  id: number
  projectId: string
  projectPath: string
  status: string // 'pending' | 'processing' | 'done'
  createdAt: string
}

// ─── Browser Models ───────────────────────────────────────────────────────────

export interface BrowserCommand {
  id: number
  tool: string
  args: string | null
  status: string // 'pending' | 'running' | 'done' | 'error'
  result: string | null
  createdAt: string
  completedAt: string | null
}

export interface BrowserScreenshot {
  id: number
  projectId: string
  filePath: string
  pageURL: string | null
  pageTitle: string | null
  createdAt: string
}

// ─── Gmail Models ─────────────────────────────────────────────────────────────

export interface GmailAccount {
  id: string
  email: string
  lastHistoryId: string | null
  isActive: number // 0 or 1
  createdAt: string
  lastSyncAt: string | null
}

export interface ProcessedEmail {
  id: number
  gmailMessageId: string
  gmailThreadId: string
  gmailAccountId: string
  fromAddress: string
  fromName: string | null
  subject: string
  snippet: string | null
  body: string | null
  receivedAt: string
  taskId: number | null
  triageType: string | null
  isRead: number // 0 or 1
  repliedAt: string | null
  importedAt: string
}

export interface WhitelistRule {
  id: string
  pattern: string
  clientId: string | null
  priority: number
  isActive: number // 0 or 1
  createdAt: string
  note: string | null
}

// ─── Chat Models ──────────────────────────────────────────────────────────────

export interface ChatConversation {
  id: number
  projectId: string | null
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  id: number
  conversationId: number
  role: string // 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

// ─── Briefing Models ──────────────────────────────────────────────────────────

export interface BriefingDigest {
  id: number
  generatedAt: string
  itemCount: number
  status: string // 'generating' | 'ready'
}

export interface BriefingItem {
  id: number
  digestId: number
  title: string
  summary: string
  category: string
  sourceUrl: string
  sourceName: string
  publishedAt: string | null
  relevanceScore: number
  isSaved: number // 0 or 1
  isRead: number // 0 or 1
}

// ─── Media Models ─────────────────────────────────────────────────────────────

export interface GeneratedImage {
  id: number
  projectId: string
  prompt: string
  responseText: string | null
  filePath: string
  model: string
  aspectRatio: string | null
  imageSize: string | null
  parentImageId: number | null
  createdAt: string
}

export interface Recording {
  id: string
  projectId: string
  title: string
  audioPath: string
  duration: number
  transcript: string | null
  status: string // 'recording' | 'transcribing' | 'done' | 'error'
  errorMessage: string | null
  createdAt: string
}

// ─── Agent Monitor Models ────────────────────────────────────────────────────

export interface AgentInfo {
  pid: number
  parentPid: number
  elapsedSeconds: number
  command: string // "Claude Code"
  isPotentiallyFrozen: boolean
  isIdle: boolean
  agentIndex: number
}

export interface MCPActivity {
  category: string       // e.g. "Git", "Tasks", "Search", "Browser"
  toolName: string       // most recent tool name in this category
  callCount: number      // calls in the activity window
  lastCallAt: string     // ISO timestamp
  isActive: boolean      // had activity in the last 15s
}

export interface AgentMonitorState {
  claudeProcess: AgentInfo | null
  agents: AgentInfo[]
  mcpActivity: MCPActivity[]
}

// ─── MCP Connection ──────────────────────────────────────────────────────────

export interface MCPConnection {
  pid: number
  cwd: string
  projectId: string | null
  projectName: string | null
  connectedAt: string
}

// ─── App Config ──────────────────────────────────────────────────────────────

export interface AppConfig {
  // Profile (Me)
  profileName: string
  profileAvatarUrl: string

  // General
  checkForUpdates: boolean
  notifyOnNewEmail: boolean
  notifyOnClaudeDone: boolean
  demoMode: boolean
  preferredCLI: 'claude' | 'gemini' | 'codex'
  cliExtraArgs: string

  // Terminal
  terminalFontSize: number
  scrollbackLines: number
  defaultTerminalPath: string

  // Engine
  openAiKey: string
  autoTranscribe: boolean
  openRouterKey: string
  contextSearchEnabled: boolean
  embeddingModel: string
  chatModel: string
  chatMode: 'context' | 'agent'
  autoSnapshotSessions: boolean
  autoUpdateCodebaseTree: boolean
  mcpServerAutoStart: boolean
  instructionInjection: boolean
  snapshotDebounce: number

  // Gmail
  googleClientId: string
  googleClientSecret: string
  gmailSyncEnabled: boolean
  gmailSyncInterval: number

  // Browser
  browserAllowedDomains: string[]
  networkBodyLimit: number

  // Briefing
  briefingStalenessHours: number
  briefingRSSFeeds: string[]
  briefingSubreddits: string[]

  // Teams (opt-in cloud sync for team collaboration)
  premiumEnabled: boolean
  supabaseUrl: string
  supabaseAnonKey: string
  autoShareSessions: boolean
  // MCP auto-setup
  mcpAutoSetupDismissed: boolean
  mcpDismissedProjects: string[]
}

// ─── Snapshot & Pattern Models ────────────────────────────────────────────────

export interface CodebaseSnapshot {
  id: number
  projectId: string
  capturedAt: string
  fileTree: string | null
  schemaHash: string | null
  keySymbols: string | null
  profileText: string | null
}

export interface Pattern {
  id: number
  projectId: string
  category: string
  title: string
  description: string
  sourceSession: string | null
  autoDetected: number // 0 or 1
  createdAt: string
}

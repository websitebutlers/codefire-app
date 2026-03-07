import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import type { AppConfig } from '@shared/models'

const CONFIG_FILE = 'codefire-settings.json'

export const APP_CONFIG_DEFAULTS: AppConfig = {
  // General
  checkForUpdates: true,
  notifyOnNewEmail: true,
  notifyOnClaudeDone: true,
  demoMode: false,
  preferredCLI: 'claude',

  // Terminal
  terminalFontSize: 13,
  scrollbackLines: 10000,
  defaultTerminalPath: '',

  // Engine
  openRouterKey: '',
  contextSearchEnabled: true,
  embeddingModel: 'openai/text-embedding-3-small',
  chatModel: 'google/gemini-3.1-pro-preview',
  chatMode: 'context' as const,
  autoSnapshotSessions: true,
  autoUpdateCodebaseTree: true,
  mcpServerAutoStart: true,
  instructionInjection: true,
  snapshotDebounce: 30,

  // Gmail
  googleClientId: '',
  googleClientSecret: '',
  gmailSyncEnabled: false,
  gmailSyncInterval: 300,

  // Browser
  browserAllowedDomains: [],
  networkBodyLimit: 51200,

  // Briefing
  briefingStalenessHours: 6,
  briefingRSSFeeds: [
    'https://www.anthropic.com/feed',
    'https://openai.com/blog/rss.xml',
    'https://blog.google/technology/ai/rss/',
    'https://simonwillison.net/atom/everything/',
    'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    'https://techcrunch.com/category/artificial-intelligence/feed/',
    'https://blog.langchain.dev/rss/',
    'https://huggingface.co/blog/feed.xml',
  ],
  briefingSubreddits: ['programming', 'MachineLearning', 'LocalLLaMA'],

  // Premium
  premiumEnabled: true,
  supabaseUrl: 'https://hofreldxofygaerodowt.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvZnJlbGR4b2Z5Z2Flcm9kb3d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4Mjc2NjksImV4cCI6MjA4ODQwMzY2OX0.MBwqQBeDfu9uxb99tYTZD54P_U3tjuh2zddMUjTlCuA',
  autoShareSessions: false,
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

export function readConfig(): AppConfig {
  try {
    const data = fs.readFileSync(getConfigPath(), 'utf-8')
    const stored = JSON.parse(data) as Partial<AppConfig>
    return { ...APP_CONFIG_DEFAULTS, ...stored }
  } catch {
    return { ...APP_CONFIG_DEFAULTS }
  }
}

/** Read raw stored values without defaults merged (for knowing what user explicitly set) */
export function readRawConfig(): Partial<AppConfig> {
  try {
    const data = fs.readFileSync(getConfigPath(), 'utf-8')
    return JSON.parse(data) as Partial<AppConfig>
  } catch {
    return {}
  }
}

export function writeConfig(config: Partial<AppConfig>): void {
  const existing = readRawConfig()
  const merged = { ...existing, ...config }
  fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), 'utf-8')
}

export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return readConfig()[key]
}

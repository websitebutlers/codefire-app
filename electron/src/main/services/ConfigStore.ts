import { app, safeStorage } from 'electron'
import path from 'path'
import fs from 'fs'
import type { AppConfig } from '@shared/models'

const CONFIG_FILE = 'codefire-settings.json'

/** Keys that contain secrets and should be encrypted at rest */
const SECRET_KEYS: (keyof AppConfig)[] = [
  'openRouterKey',
  'googleClientId',
  'googleClientSecret',
]

export const APP_CONFIG_DEFAULTS: AppConfig = {
  // Profile (Me)
  profileName: '',
  profileAvatarUrl: '',

  // General
  checkForUpdates: true,
  notifyOnNewEmail: true,
  notifyOnClaudeDone: true,
  demoMode: false,
  preferredCLI: 'claude',
  cliExtraArgs: '',

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

  // Teams (opt-in cloud sync for team collaboration)
  premiumEnabled: false,
  supabaseUrl: process.env.CODEFIRE_SUPABASE_URL || 'https://hofreldxofygaerodowt.supabase.co',
  supabaseAnonKey: process.env.CODEFIRE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvZnJlbGR4b2Z5Z2Flcm9kb3d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4Mjc2NjksImV4cCI6MjA4ODQwMzY2OX0.MBwqQBeDfu9uxb99tYTZD54P_U3tjuh2zddMUjTlCuA',
  autoShareSessions: false,
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

/**
 * Encrypt a secret value using Electron's safeStorage (DPAPI on Windows, Keychain on macOS).
 * Falls back to plaintext if safeStorage is not available (e.g., in tests or CI).
 */
function encryptSecret(value: string): string {
  if (!value) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value)
      return 'enc:' + encrypted.toString('base64')
    }
  } catch {
    // safeStorage not available
  }
  return value
}

/**
 * Decrypt a secret value. Handles both encrypted (enc:...) and legacy plaintext values.
 */
function decryptSecret(value: string): string {
  if (!value) return ''
  if (value.startsWith('enc:')) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const buffer = Buffer.from(value.slice(4), 'base64')
        return safeStorage.decryptString(buffer)
      }
    } catch {
      // Decryption failed — value may be corrupted
      return ''
    }
  }
  // Legacy plaintext value — return as-is (will be re-encrypted on next write)
  return value
}

export function readConfig(): AppConfig {
  try {
    const data = fs.readFileSync(getConfigPath(), 'utf-8')
    const stored = JSON.parse(data) as Partial<AppConfig>

    // Decrypt secret values
    for (const key of SECRET_KEYS) {
      if (stored[key] && typeof stored[key] === 'string') {
        ;(stored as Record<string, string>)[key] = decryptSecret(stored[key] as string)
      }
    }

    return { ...APP_CONFIG_DEFAULTS, ...stored }
  } catch {
    return { ...APP_CONFIG_DEFAULTS }
  }
}

/** Read raw stored values without defaults merged (for knowing what user explicitly set) */
export function readRawConfig(): Partial<AppConfig> {
  try {
    const data = fs.readFileSync(getConfigPath(), 'utf-8')
    const stored = JSON.parse(data) as Partial<AppConfig>

    // Decrypt secret values
    for (const key of SECRET_KEYS) {
      if (stored[key] && typeof stored[key] === 'string') {
        ;(stored as Record<string, string>)[key] = decryptSecret(stored[key] as string)
      }
    }

    return stored
  } catch {
    return {}
  }
}

export function writeConfig(config: Partial<AppConfig>): void {
  const existing = readRawConfig()
  const merged = { ...existing, ...config }

  // Encrypt secret values before writing to disk
  const toWrite = { ...merged }
  for (const key of SECRET_KEYS) {
    if (toWrite[key] && typeof toWrite[key] === 'string') {
      ;(toWrite as Record<string, string>)[key] = encryptSecret(toWrite[key] as string)
    }
  }

  fs.writeFileSync(getConfigPath(), JSON.stringify(toWrite, null, 2), 'utf-8')
}

export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return readConfig()[key]
}

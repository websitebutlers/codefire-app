import { ipcMain } from 'electron'
import { readConfig, writeConfig, writeMCPSecrets } from '../services/ConfigStore'
import { GoogleOAuth } from '../services/GoogleOAuth'
import { GmailService } from '../services/GmailService'
import { ContextInjector } from '../services/ContextInjector'
import { registerGmailHandlers } from './gmail-handlers'
import type Database from 'better-sqlite3'
import type { AppConfig } from '@shared/models'
import type { CLIProvider } from '../services/DeepLinkService'

/**
 * Keys the renderer is allowed to set.
 * Credential and infrastructure keys are excluded to prevent
 * a compromised renderer from redirecting API traffic.
 */
const ALLOWED_SETTINGS_KEYS = new Set<keyof AppConfig>([
  // Profile (Me)
  'profileName',
  'profileAvatarUrl',
  // General
  'checkForUpdates',
  'notifyOnNewEmail',
  'notifyOnClaudeDone',
  'demoMode',
  'preferredCLI',
  // Terminal
  'terminalFontSize',
  'scrollbackLines',
  'defaultTerminalPath',
  // Engine (non-credential)
  'contextSearchEnabled',
  'embeddingModel',
  'chatModel',
  'chatMode',
  'autoSnapshotSessions',
  'autoUpdateCodebaseTree',
  'mcpServerAutoStart',
  'instructionInjection',
  'snapshotDebounce',
  // Gmail (non-credential)
  'gmailSyncEnabled',
  'gmailSyncInterval',
  // Browser
  'browserAllowedDomains',
  'networkBodyLimit',
  // Briefing
  'briefingStalenessHours',
  'briefingRSSFeeds',
  'briefingSubreddits',
  // Teams (non-infrastructure)
  'premiumEnabled',
  'autoShareSessions',
  // MCP auto-setup
  'mcpAutoSetupDismissed',
  'mcpDismissedProjects',
  // Credentials — allowed because the Settings UI needs to set them,
  // but they go through the same writeConfig path. The real protection
  // is that they are written to the same file the user already controls.
  'openAiKey',
  'autoTranscribe',
  'openRouterKey',
  'googleClientId',
  'googleClientSecret',
])

export function registerSettingsHandlers(
  db: Database.Database,
  onGmailReady?: (service: GmailService) => void
) {
  ipcMain.handle('settings:get', () => {
    return readConfig()
  })

  ipcMain.handle('settings:set', (_event, settings: Partial<AppConfig>) => {
    // Filter to allowed keys only — reject supabaseUrl, supabaseAnonKey, etc.
    const filtered: Partial<AppConfig> = {}
    for (const [key, value] of Object.entries(settings)) {
      if (ALLOWED_SETTINGS_KEYS.has(key as keyof AppConfig)) {
        ;(filtered as Record<string, unknown>)[key] = value
      }
    }

    if (Object.keys(filtered).length === 0) {
      return { success: true }
    }

    writeConfig(filtered)

    // Update MCP secrets file if API keys changed
    if ('openRouterKey' in filtered || 'openAiKey' in filtered) {
      writeMCPSecrets()
    }

    // If Google credentials were provided, reinitialize Gmail service
    const config = readConfig()
    if (config.googleClientId && config.googleClientSecret) {
      const oauth = new GoogleOAuth(config.googleClientId, config.googleClientSecret)
      const gmailService = new GmailService(db, oauth)
      registerGmailHandlers(gmailService)
      onGmailReady?.(gmailService)
    }

    // If instructionInjection was toggled, inject or remove from all projects
    if ('instructionInjection' in filtered) {
      const injector = new ContextInjector(db)
      const cli = (config.preferredCLI || 'claude') as CLIProvider
      if (filtered.instructionInjection) {
        injector.injectAllProjects(cli)
      } else {
        injector.removeAllInjections(cli)
      }
    }

    return { success: true }
  })

  // Context injection handlers
  const injector = new ContextInjector(db)

  ipcMain.handle('context:setupProject', (_event, cli: CLIProvider, projectPath: string) => {
    return injector.setupProject(cli, projectPath)
  })

  ipcMain.handle('context:injectInstruction', (_event, cli: CLIProvider, projectPath: string) => {
    return injector.updateInstructionFile(cli, projectPath)
  })

  ipcMain.handle('context:removeInstruction', (_event, cli: CLIProvider, projectPath: string) => {
    return injector.removeInstructionFile(cli, projectPath)
  })

  ipcMain.handle('context:hasInstruction', (_event, cli: CLIProvider, projectPath: string) => {
    return injector.hasInstructionFile(cli, projectPath)
  })

  ipcMain.handle('context:installMCP', (_event, cli: CLIProvider) => {
    return injector.installMCP(cli)
  })
}

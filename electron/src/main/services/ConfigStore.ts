import { app } from 'electron'
import path from 'path'
import fs from 'fs'

interface AppConfig {
  openRouterKey?: string
  googleClientId?: string
  googleClientSecret?: string
}

const CONFIG_FILE = 'codefire-settings.json'

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

export function readConfig(): AppConfig {
  try {
    const data = fs.readFileSync(getConfigPath(), 'utf-8')
    return JSON.parse(data) as AppConfig
  } catch {
    return {}
  }
}

export function writeConfig(config: AppConfig): void {
  const existing = readConfig()
  const merged = { ...existing, ...config }
  fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), 'utf-8')
}

export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return readConfig()[key]
}

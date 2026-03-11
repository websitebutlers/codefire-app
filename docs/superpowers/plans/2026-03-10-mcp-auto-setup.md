# MCP Auto-Setup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MCP server "just work" — auto-copy to a stable path, auto-register with AI CLIs on first launch, and show a per-project banner when MCP isn't connected.

**Architecture:** On app launch, copy the bundled MCP server to `app.getPath('userData')/mcp-server/`. Then check if `codefire` is registered in CLI configs (`~/.claude.json`, etc.). If missing, show a confirmation dialog. Per-project banners detect missing `.mcp.json` entries.

**Tech Stack:** Electron (main process: Node.js/fs), React (renderer: banner component), IPC handlers

**Spec:** `docs/superpowers/specs/2026-03-10-mcp-auto-setup-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/services/MCPServerManager.ts` | Modify | Replace `syncMcpServerForLinux()` with `syncMcpServer()`, simplify `getMcpServerPath()` |
| `src/main/services/MCPAutoSetup.ts` | Create | Global auto-register logic: detect CLIs, check configs, show dialog, register |
| `src/main/services/DeepLinkService.ts` | Modify | Accept `serverPath` param in `installMCP()`, add `.claude.json` backup |
| `src/main/services/ConfigStore.ts` | Modify | Add `openAiKey` to `writeMCPSecrets()`, add atomic write |
| `src/shared/models.ts` | Modify | Add `mcpAutoSetupDismissed` and `mcpDismissedProjects` to `AppConfig` |
| `src/main/services/ConfigStore.ts` | Modify | Add defaults for new `AppConfig` keys |
| `src/main/ipc/settings-handlers.ts` | Modify | Trigger `writeMCPSecrets()` on `openAiKey` change, add new keys to allowlist |
| `src/main/ipc/mcp-handlers.ts` | Modify | Add `mcp:checkProjectConfig` and `mcp:installProjectConfig` handlers |
| `src/main/index.ts` | Modify | Call `syncMcpServer()` then `MCPAutoSetup.run()` after window shows |
| `src/renderer/components/StatusBar/MCPBanner.tsx` | Create | Per-project "Connect to CodeFire" banner |
| `src/renderer/layouts/ProjectLayout.tsx` | Modify | Mount `MCPBanner` component |

---

## Chunk 1: Stable Path Sync

### Task 1: Cross-platform `syncMcpServer()` in MCPServerManager

**Files:**
- Modify: `electron/src/main/services/MCPServerManager.ts`

- [ ] **Step 1: Replace `LINUX_MCP_DIR` constant with cross-platform `getStableMcpDir()`**

In `MCPServerManager.ts`, replace lines 1-9:

```typescript
import { ChildProcess, fork } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { app } from 'electron'
import type { MCPConnection } from '@shared/models'

/** Stable install directory for the MCP server — survives app updates */
function getStableMcpDir(): string {
  return path.join(app.getPath('userData'), 'mcp-server')
}
```

- [ ] **Step 2: Replace `syncMcpServerForLinux()` with cross-platform `syncMcpServer()`**

Replace the `syncMcpServerForLinux` method (lines 177-196) with:

```typescript
/**
 * Copy the bundled MCP server to a stable user-data path so AI CLIs
 * can find it at a predictable location that survives app updates.
 * Should be called early in app startup, before any MCP registration.
 */
static syncMcpServer(): void {
  if (!app.isPackaged) return

  const source = path.join(process.resourcesPath, 'mcp-server')
  if (!fs.existsSync(source)) {
    console.warn('[MCP] Bundled mcp-server not found at', source)
    return
  }

  const target = getStableMcpDir()

  // Skip copy if versions match (avoid unnecessary startup delay)
  try {
    const sourcePkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf-8'))
    const targetPkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf-8'))
    if (sourcePkg.version === targetPkg.version) {
      console.log('[MCP] Stable MCP server is up-to-date (v' + sourcePkg.version + ')')
      return
    }
  } catch {
    // Target doesn't exist or is corrupted — proceed with copy
  }

  try {
    fs.mkdirSync(target, { recursive: true })
    fs.cpSync(source, target, { recursive: true, force: true })
    console.log('[MCP] Synced MCP server to stable path:', target)
  } catch (err) {
    console.error('[MCP] Failed to sync MCP server to stable path:', err)
  }
}
```

- [ ] **Step 3: Simplify `getMcpServerPath()` to always use stable path**

Replace the `getMcpServerPath` method (lines 156-170) with:

```typescript
/** Get the path to the MCP server for CLI configuration */
static getMcpServerPath(): string {
  if (!app.isPackaged) {
    return path.join(__dirname, '..', 'mcp', 'server.js')
  }
  return path.join(getStableMcpDir(), 'server.js')
}
```

- [ ] **Step 4: Update `src/main/index.ts` to call `syncMcpServer()` on all platforms**

In `src/main/index.ts`, replace line 64-65:

```typescript
// On Linux AppImage, copy the MCP server to a stable path before anything else
MCPServerManager.syncMcpServerForLinux()
```

With:

```typescript
// Copy bundled MCP server to a stable user-data path (all platforms)
MCPServerManager.syncMcpServer()
```

- [ ] **Step 5: Verify the sync works**

Run: `cd electron && npm run build && npx electron . 2>&1 | head -20`

Expected: Log line `[MCP] Synced MCP server to stable path: .../CodeFire/mcp-server` on first run, then `[MCP] Stable MCP server is up-to-date` on second run.

- [ ] **Step 6: Commit**

```bash
git add electron/src/main/services/MCPServerManager.ts electron/src/main/index.ts
git commit -m "feat: cross-platform MCP server sync to stable user-data path"
```

---

### Task 2: Fix `writeMCPSecrets()` to include `openAiKey` and trigger on key change

**Files:**
- Modify: `electron/src/main/services/ConfigStore.ts`
- Modify: `electron/src/main/ipc/settings-handlers.ts`

- [ ] **Step 1: Add `openAiKey` to `writeMCPSecrets()` and use atomic write**

In `ConfigStore.ts`, replace the `writeMCPSecrets` function (lines 182-190):

```typescript
/**
 * Write decrypted API keys to a file the MCP server can read.
 * The MCP server runs as a separate Node process without access to Electron's
 * safeStorage, so it can't decrypt keys from codefire-settings.json.
 * See CodeFire note: "OpenRouter API Key Security — Intentionally Not Hardened"
 */
export function writeMCPSecrets(): void {
  try {
    const config = readConfig()
    const secrets: Record<string, string> = {}
    if (config.openRouterKey) secrets.openRouterKey = config.openRouterKey
    if (config.openAiKey) secrets.openAiKey = config.openAiKey
    const secretsPath = path.join(app.getPath('userData'), 'mcp-secrets.json')
    // Atomic write: write to temp file then rename (prevents corrupt reads)
    const tmpPath = secretsPath + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(secrets, null, 2), { mode: 0o600 })
    fs.renameSync(tmpPath, secretsPath)
  } catch { /* non-critical */ }
}
```

- [ ] **Step 2: Trigger `writeMCPSecrets()` when `openAiKey` changes**

In `settings-handlers.ts`, replace lines 86-89:

```typescript
    // Update MCP secrets file if API keys changed
    if ('openRouterKey' in filtered) {
      writeMCPSecrets()
    }
```

With:

```typescript
    // Update MCP secrets file if API keys changed
    if ('openRouterKey' in filtered || 'openAiKey' in filtered) {
      writeMCPSecrets()
    }
```

- [ ] **Step 3: Commit**

```bash
git add electron/src/main/services/ConfigStore.ts electron/src/main/ipc/settings-handlers.ts
git commit -m "fix: include openAiKey in MCP secrets, atomic write, trigger on key change"
```

---

## Chunk 2: Global Auto-Register

### Task 3: Add `mcpAutoSetupDismissed` and `mcpDismissedProjects` to AppConfig

**Files:**
- Modify: `electron/src/shared/models.ts`
- Modify: `electron/src/main/services/ConfigStore.ts`
- Modify: `electron/src/main/ipc/settings-handlers.ts`

- [ ] **Step 1: Add fields to `AppConfig` interface**

In `models.ts`, add these fields inside the `AppConfig` interface, after the Teams section (before the closing `}`):

```typescript
  // MCP auto-setup
  mcpAutoSetupDismissed: boolean
  mcpDismissedProjects: string[]
```

- [ ] **Step 2: Add defaults in `ConfigStore.ts`**

In `ConfigStore.ts`, add to `APP_CONFIG_DEFAULTS` object, after the `autoShareSessions` line:

```typescript
  // MCP auto-setup
  mcpAutoSetupDismissed: false,
  mcpDismissedProjects: [],
```

- [ ] **Step 3: Add to `ALLOWED_SETTINGS_KEYS` in `settings-handlers.ts`**

In `settings-handlers.ts`, add these keys to the `ALLOWED_SETTINGS_KEYS` set, after `'autoShareSessions'`:

```typescript
  // MCP auto-setup
  'mcpAutoSetupDismissed',
  'mcpDismissedProjects',
```

- [ ] **Step 4: Commit**

```bash
git add electron/src/shared/models.ts electron/src/main/services/ConfigStore.ts electron/src/main/ipc/settings-handlers.ts
git commit -m "feat: add mcpAutoSetupDismissed and mcpDismissedProjects config keys"
```

---

### Task 4: Create `MCPAutoSetup` service

**Files:**
- Create: `electron/src/main/services/MCPAutoSetup.ts`

- [ ] **Step 1: Create the MCPAutoSetup service**

Create `electron/src/main/services/MCPAutoSetup.ts`:

```typescript
import { dialog, BrowserWindow } from 'electron'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { readConfig, writeConfig } from './ConfigStore'
import { MCPServerManager } from './MCPServerManager'
import { DeepLinkService } from './DeepLinkService'

interface DetectedCLI {
  name: string
  binary: string
  configPath: string
  isRegistered: boolean
}

/**
 * Auto-detects AI CLIs and registers CodeFire's MCP server on first launch.
 * Shows a confirmation dialog before modifying any CLI config.
 */
export class MCPAutoSetup {
  /**
   * Run the full auto-setup flow. Call after main window is visible.
   */
  static async run(mainWindow: BrowserWindow): Promise<void> {
    const config = readConfig()
    if (config.mcpAutoSetupDismissed) return

    // Update any stale paths in existing registrations (silent, no prompt)
    this.updateStalePaths()

    // Detect which CLIs need registration
    const unregistered = this.detectUnregisteredCLIs()
    if (unregistered.length === 0) return

    // Show confirmation dialog
    const cliNames = unregistered.map(c => c.name).join(', ')
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Set up CodeFire MCP Server',
      message: `CodeFire can register its MCP server with ${cliNames} so your AI agent has access to your tasks, notes, and project context.\n\nSet up now?`,
      buttons: ['Yes', 'Not now', "Don't ask again"],
      defaultId: 0,
      cancelId: 1,
    })

    if (result.response === 2) {
      // "Don't ask again"
      writeConfig({ mcpAutoSetupDismissed: true })
      return
    }

    if (result.response === 1) {
      // "Not now" — will check again next launch
      return
    }

    // "Yes" — register with all detected CLIs
    const deepLink = new DeepLinkService()
    const serverPath = MCPServerManager.getMcpServerPath()

    for (const cli of unregistered) {
      try {
        if (cli.binary === 'claude') {
          deepLink.installMCPWithPath('claude', serverPath)
        } else if (cli.binary === 'gemini') {
          deepLink.installMCPWithPath('gemini', serverPath)
        } else if (cli.binary === 'codex') {
          deepLink.installMCPWithPath('codex', serverPath)
        }
        console.log(`[MCPAutoSetup] Registered with ${cli.name}`)
      } catch (err) {
        console.error(`[MCPAutoSetup] Failed to register with ${cli.name}:`, err)
      }
    }
  }

  /**
   * Detect which AI CLIs are installed but don't have CodeFire registered.
   */
  private static detectUnregisteredCLIs(): DetectedCLI[] {
    const clis: DetectedCLI[] = []

    // Claude Code
    if (this.isBinaryInPath('claude')) {
      const configPath = path.join(os.homedir(), '.claude.json')
      const registered = this.isRegisteredInJSON(configPath, 'mcpServers')
      if (!registered) {
        clis.push({ name: 'Claude Code', binary: 'claude', configPath, isRegistered: false })
      }
    }

    // Gemini CLI
    if (this.isBinaryInPath('gemini')) {
      const configPath = path.join(os.homedir(), '.gemini', 'settings.json')
      const registered = this.isRegisteredInJSON(configPath, 'mcpServers')
      if (!registered) {
        clis.push({ name: 'Gemini CLI', binary: 'gemini', configPath, isRegistered: false })
      }
    }

    // Codex CLI
    if (this.isBinaryInPath('codex')) {
      const configPath = path.join(os.homedir(), '.codex', 'config.toml')
      const registered = this.isRegisteredInTOML(configPath)
      if (!registered) {
        clis.push({ name: 'Codex CLI', binary: 'codex', configPath, isRegistered: false })
      }
    }

    return clis
  }

  /**
   * If CodeFire is registered but points to an old path, update it silently.
   */
  private static updateStalePaths(): void {
    const currentPath = MCPServerManager.getMcpServerPath()

    // Check Claude Code config
    const claudeConfig = path.join(os.homedir(), '.claude.json')
    try {
      if (fs.existsSync(claudeConfig)) {
        const config = JSON.parse(fs.readFileSync(claudeConfig, 'utf-8'))
        const entry = config?.mcpServers?.codefire
        if (entry?.args?.[0] && entry.args[0] !== currentPath) {
          // Skip if it looks like a dev path
          if (entry.args[0].includes('dist-electron')) return
          // Back up before modifying
          fs.copyFileSync(claudeConfig, claudeConfig + '.bak')
          entry.args[0] = currentPath
          fs.writeFileSync(claudeConfig, JSON.stringify(config, null, 2) + '\n', 'utf-8')
          console.log('[MCPAutoSetup] Updated stale Claude Code MCP path')
        }
      }
    } catch (err) {
      console.error('[MCPAutoSetup] Failed to update Claude Code config:', err)
    }

    // Check Gemini CLI config
    const geminiConfig = path.join(os.homedir(), '.gemini', 'settings.json')
    try {
      if (fs.existsSync(geminiConfig)) {
        const config = JSON.parse(fs.readFileSync(geminiConfig, 'utf-8'))
        const entry = config?.mcpServers?.codefire
        if (entry?.args?.[0] && entry.args[0] !== currentPath) {
          if (entry.args[0].includes('dist-electron')) return
          entry.args[0] = currentPath
          fs.writeFileSync(geminiConfig, JSON.stringify(config, null, 2) + '\n', 'utf-8')
          console.log('[MCPAutoSetup] Updated stale Gemini CLI MCP path')
        }
      }
    } catch (err) {
      console.error('[MCPAutoSetup] Failed to update Gemini config:', err)
    }
  }

  private static isBinaryInPath(binary: string): boolean {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      execFileSync(cmd, [binary], { stdio: 'ignore', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  private static isRegisteredInJSON(configPath: string, topKey: string): boolean {
    try {
      if (!fs.existsSync(configPath)) return false
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return !!config?.[topKey]?.codefire
    } catch {
      return false
    }
  }

  private static isRegisteredInTOML(configPath: string): boolean {
    try {
      if (!fs.existsSync(configPath)) return false
      const content = fs.readFileSync(configPath, 'utf-8')
      return content.includes('[mcp_servers.codefire]')
    } catch {
      return false
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/src/main/services/MCPAutoSetup.ts
git commit -m "feat: add MCPAutoSetup service for first-launch MCP registration"
```

---

### Task 5: Refactor `DeepLinkService.installMCP()` to accept a path parameter

**Files:**
- Modify: `electron/src/main/services/DeepLinkService.ts`

- [ ] **Step 1: Add `installMCPWithPath()` public method and backup logic**

In `DeepLinkService.ts`, add this method to the class, after the `handleURL` method:

```typescript
  /**
   * Install MCP config for a CLI using a specific server path.
   * Used by both deep links and MCPAutoSetup.
   */
  installMCPWithPath(cli: CLIProvider, serverPath: string): DeepLinkResult {
    const displayName = CLI_DISPLAY_NAMES[cli]
    try {
      if (cli === 'claude') {
        return this.installClaudeMCP(cli, displayName, serverPath)
      }
      switch (cli) {
        case 'gemini':
          this.installJSONMCP(
            path.join(os.homedir(), '.gemini', 'settings.json'),
            'mcpServers',
            { command: 'node', args: [serverPath] }
          )
          break
        case 'codex':
          this.installCodexMCP(
            path.join(os.homedir(), '.codex', 'config.toml'),
            serverPath
          )
          break
        case 'opencode':
          return { success: false, cli, displayName, error: 'OpenCode requires a project context to configure MCP.' }
      }
      return { success: true, cli, displayName }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, cli, displayName, error: message }
    }
  }
```

- [ ] **Step 2: Add `.claude.json` backup in `installJSONMCP()`**

In the `installJSONMCP` method, add a backup step before writing. Replace lines 119-137:

```typescript
  private installJSONMCP(configPath: string, topKey: string, serverEntry: Record<string, unknown>): void {
    const dir = path.dirname(configPath)
    fs.mkdirSync(dir, { recursive: true })

    let config: Record<string, unknown> = {}
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        // Back up before modifying
        fs.copyFileSync(configPath, configPath + '.bak')
      } catch {
        // Corrupted file — start fresh (backup the corrupted file too)
        try { fs.copyFileSync(configPath, configPath + '.corrupted.bak') } catch { /* ignore */ }
      }
    }

    const servers = (config[topKey] as Record<string, unknown>) ?? {}
    servers['codefire'] = serverEntry
    config[topKey] = servers

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  }
```

- [ ] **Step 3: Update existing `installMCP()` to use `installMCPWithPath()`**

Replace the private `installMCP` method (lines 57-91) with:

```typescript
  private installMCP(cli: CLIProvider): DeepLinkResult {
    const mcpServerPath = MCPServerManager.getMcpServerPath()
    return this.installMCPWithPath(cli, mcpServerPath)
  }
```

- [ ] **Step 4: Commit**

```bash
git add electron/src/main/services/DeepLinkService.ts
git commit -m "refactor: DeepLinkService accepts server path, backs up configs before writing"
```

---

### Task 6: Wire up auto-setup in app startup

**Files:**
- Modify: `electron/src/main/index.ts`

- [ ] **Step 1: Add import for `MCPAutoSetup`**

In `index.ts`, add after the `DeepLinkService` import (line 18):

```typescript
import { MCPAutoSetup } from './services/MCPAutoSetup'
```

- [ ] **Step 2: Call `MCPAutoSetup.run()` after main window shows**

Find the section where the main window is created and shown. Add the auto-setup call after the window's `show` event. Look for `windowManager` usage — add after the main window is created:

```typescript
// After main window shows, check MCP registration
const mainWin = windowManager.getMainWindow()
if (mainWin) {
  mainWin.once('show', () => {
    MCPAutoSetup.run(mainWin).catch(err => {
      console.error('[MCPAutoSetup] Error:', err)
    })
  })
}
```

If the main window is already shown by the time this code runs, use `setImmediate` instead:

```typescript
// Run MCP auto-setup after main window is visible
setImmediate(() => {
  const mainWin = windowManager.getMainWindow()
  if (mainWin) {
    MCPAutoSetup.run(mainWin).catch(err => {
      console.error('[MCPAutoSetup] Error:', err)
    })
  }
})
```

Place this after the `initDeferredServices()` call (around line 153+).

- [ ] **Step 3: Commit**

```bash
git add electron/src/main/index.ts
git commit -m "feat: run MCP auto-setup after main window shows"
```

---

## Chunk 3: Per-Project Banner

### Task 7: Add IPC handlers for project MCP config detection

**Files:**
- Modify: `electron/src/main/ipc/mcp-handlers.ts`

- [ ] **Step 1: Add project config check and install handlers**

In `mcp-handlers.ts`, add these handlers inside `registerMCPHandlers()`, after the existing handlers:

```typescript
  ipcMain.handle('mcp:checkProjectConfig', (_event, projectPath: string) => {
    // Check if project has .mcp.json with codefire entry
    const mcpJsonPath = path.join(projectPath, '.mcp.json')
    try {
      if (fs.existsSync(mcpJsonPath)) {
        const config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'))
        if (config?.mcpServers?.codefire) return { connected: true }
      }
    } catch { /* ignore parse errors */ }
    return { connected: false }
  })

  ipcMain.handle('mcp:installProjectConfig', (_event, projectPath: string) => {
    const serverPath = MCPServerManager.getMcpServerPath()
    const mcpJsonPath = path.join(projectPath, '.mcp.json')

    let config: Record<string, unknown> = {}
    try {
      if (fs.existsSync(mcpJsonPath)) {
        config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'))
      }
    } catch { /* start fresh */ }

    const servers = (config.mcpServers as Record<string, unknown>) ?? {}
    servers['codefire'] = {
      type: 'stdio',
      command: 'node',
      args: [serverPath],
    }
    config.mcpServers = servers

    fs.mkdirSync(path.dirname(mcpJsonPath), { recursive: true })
    fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

    return { success: true }
  })
```

- [ ] **Step 2: Add required imports at the top of `mcp-handlers.ts`**

Add after existing imports:

```typescript
import path from 'path'
import fs from 'fs'
```

- [ ] **Step 3: Add IPC channel types in `src/shared/types.ts`**

Find the MCP-related channel types and add:

```typescript
  'mcp:checkProjectConfig': string
  'mcp:installProjectConfig': string
```

- [ ] **Step 4: Commit**

```bash
git add electron/src/main/ipc/mcp-handlers.ts electron/src/shared/types.ts
git commit -m "feat: add IPC handlers for per-project MCP config check and install"
```

---

### Task 8: Create MCPBanner component

**Files:**
- Create: `electron/src/renderer/components/StatusBar/MCPBanner.tsx`

- [ ] **Step 1: Create the banner component**

Create `electron/src/renderer/components/StatusBar/MCPBanner.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { Plug, X } from 'lucide-react'

interface MCPBannerProps {
  projectPath: string
}

export default function MCPBanner({ projectPath }: MCPBannerProps) {
  const [visible, setVisible] = useState(false)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    // Check if this project has MCP configured
    window.api.invoke('mcp:checkProjectConfig', projectPath).then((result: { connected: boolean }) => {
      if (!result.connected) {
        // Check if user dismissed this project's banner
        window.api.invoke('settings:get').then((config: { mcpDismissedProjects?: string[] }) => {
          const dismissed = config.mcpDismissedProjects || []
          if (!dismissed.includes(projectPath)) {
            setVisible(true)
          }
        })
      }
    })
  }, [projectPath])

  if (!visible) return null

  const handleConnect = async () => {
    setConnecting(true)
    try {
      await window.api.invoke('mcp:installProjectConfig', projectPath)
      setVisible(false)
    } catch (err) {
      console.error('Failed to install MCP config:', err)
    } finally {
      setConnecting(false)
    }
  }

  const handleDismiss = async () => {
    setVisible(false)
    try {
      const config = await window.api.invoke('settings:get') as { mcpDismissedProjects?: string[] }
      const dismissed = [...(config.mcpDismissedProjects || []), projectPath]
      await window.api.invoke('settings:set', { mcpDismissedProjects: dismissed })
    } catch { /* non-critical */ }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border-b border-blue-500/20 text-xs text-blue-300">
      <Plug size={14} />
      <span>This project isn't connected to CodeFire's MCP server.</span>
      <button
        onClick={handleConnect}
        disabled={connecting}
        className="px-2 py-0.5 bg-blue-500/20 hover:bg-blue-500/30 rounded text-blue-200 transition-colors"
      >
        {connecting ? 'Connecting...' : 'Connect'}
      </button>
      <button
        onClick={handleDismiss}
        className="ml-auto p-0.5 hover:bg-white/10 rounded transition-colors"
        title="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/src/renderer/components/StatusBar/MCPBanner.tsx
git commit -m "feat: add MCPBanner component for per-project MCP connection prompt"
```

---

### Task 9: Mount MCPBanner in ProjectLayout

**Files:**
- Modify: `electron/src/renderer/layouts/ProjectLayout.tsx`

- [ ] **Step 1: Import MCPBanner**

Add import at the top of `ProjectLayout.tsx`, after the other component imports:

```typescript
import MCPBanner from '@renderer/components/StatusBar/MCPBanner'
```

- [ ] **Step 2: Add MCPBanner to the layout**

Find where the `<UpdateBanner />` component is rendered in the JSX. Add `<MCPBanner>` right after it (or in a similar position at the top of the layout). The banner needs the `project.path` prop:

```tsx
{project && <MCPBanner projectPath={project.path} />}
```

- [ ] **Step 3: Commit**

```bash
git add electron/src/renderer/layouts/ProjectLayout.tsx
git commit -m "feat: mount MCPBanner in project layout for per-project MCP detection"
```

---

## Chunk 4: Integration & Verification

### Task 10: End-to-end verification

- [ ] **Step 1: Build and run the app**

```bash
cd electron && npm run build && npx electron .
```

Verify:
1. Console shows `[MCP] Synced MCP server to stable path: .../CodeFire/mcp-server`
2. Dialog appears asking to register with Claude Code (if `claude` is in PATH)
3. After clicking "Yes", check `~/.claude.json` has a `codefire` entry with the stable path
4. Open a project — banner appears if `.mcp.json` doesn't have a codefire entry
5. Click "Connect" — `.mcp.json` is created in the project root
6. Banner disappears after connecting
7. Click "Dismiss" on another project — banner doesn't show again for that project

- [ ] **Step 2: Verify MCP server works from the stable path**

```bash
node ~/Library/Application\ Support/CodeFire/mcp-server/server.js &
sleep 2 && kill $!
```

Expected: `CodeFire MCP server started (pid ..., connection file: ...)`

- [ ] **Step 3: Verify mcp-secrets.json has both keys**

```bash
cat ~/Library/Application\ Support/CodeFire/mcp-secrets.json
```

Expected: JSON with both `openRouterKey` and `openAiKey` (if configured in settings).

- [ ] **Step 4: Final commit with all changes**

```bash
git add -A
git commit -m "feat: MCP auto-setup — stable path sync, first-launch registration, per-project banner"
```

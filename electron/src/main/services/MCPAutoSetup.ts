import { dialog, BrowserWindow, Notification } from 'electron'
import { execFile, execFileSync } from 'child_process'
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

    // Update any stale or broken paths in existing registrations (silent, no prompt)
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
      writeConfig({ mcpAutoSetupDismissed: true })
      return
    }

    if (result.response === 1) {
      return
    }

    // "Yes" — register with all detected CLIs
    const deepLink = new DeepLinkService()
    const serverPath = MCPServerManager.getMcpServerPath()
    const failures: string[] = []

    for (const cli of unregistered) {
      try {
        const cliType = cli.binary as 'claude' | 'gemini' | 'codex' | 'opencode'
        const installResult = deepLink.installMCPWithPath(cliType, serverPath)
        if (!installResult.success) {
          failures.push(`${cli.name}: ${installResult.error}`)
          console.error(`[MCPAutoSetup] Failed to register with ${cli.name}:`, installResult.error)
        } else {
          console.log(`[MCPAutoSetup] Registered with ${cli.name}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failures.push(`${cli.name}: ${msg}`)
        console.error(`[MCPAutoSetup] Failed to register with ${cli.name}:`, err)
      }
    }

    if (failures.length > 0) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'MCP Setup Issue',
        message: 'Some CLI tools could not be configured:\n\n' + failures.join('\n') +
          '\n\nYou can retry from Settings > MCP.',
      })
    } else {
      // Run health check on the first registered CLI to verify MCP works
      this.verifyMCPServer(serverPath)
    }
  }

  /**
   * Spawn the MCP server and verify it starts and responds to initialize.
   * Logs result but does not block — this is a best-effort diagnostic.
   */
  private static verifyMCPServer(serverPath: string): void {
    let nodePath: string
    try {
      nodePath = DeepLinkService.resolveNodePath()
    } catch {
      console.warn('[MCPAutoSetup] Health check skipped — node not found')
      return
    }

    const child = execFile(nodePath, [serverPath], {
      timeout: 10000,
      env: { ...process.env, CODEFIRE_MCP_HEALTHCHECK: '1' },
    }, (err) => {
      if (err) {
        console.warn('[MCPAutoSetup] MCP health check failed:', err.message)
      }
    })

    // Send a minimal JSON-RPC initialize request via stdin
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'codefire-healthcheck', version: '1.0.0' } },
    }) + '\n'

    child.stdin?.write(initRequest)
    child.stdin?.end()

    let output = ''
    child.stdout?.on('data', (data: Buffer) => { output += data.toString() })

    child.on('close', () => {
      if (output.includes('"result"')) {
        console.log('[MCPAutoSetup] MCP health check passed')
      } else {
        console.warn('[MCPAutoSetup] MCP health check: no valid response. Output:', output.slice(0, 200))
      }
    })
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

    // OpenCode
    if (this.isBinaryInPath('opencode')) {
      const configPath = path.join(os.homedir(), '.config', 'opencode', 'config.json')
      const registered = this.isRegisteredInJSON(configPath, 'mcp')
      if (!registered) {
        clis.push({ name: 'OpenCode', binary: 'opencode', configPath, isRegistered: false })
      }
    }

    return clis
  }

  /**
   * If CodeFire is registered but points to an old or broken path, update it silently.
   * Also fixes bare "node" commands and validates that the command binary exists on disk.
   */
  private static updateStalePaths(): void {
    const currentPath = MCPServerManager.getMcpServerPath()
    let nodePath: string | null = null
    try {
      nodePath = DeepLinkService.resolveNodePath()
    } catch {
      // Can't resolve node — we'll still fix stale server paths but can't fix command
    }

    const configs: Array<{ path: string; topKey: string; backup: boolean }> = [
      { path: path.join(os.homedir(), '.claude.json'), topKey: 'mcpServers', backup: true },
      { path: path.join(os.homedir(), '.gemini', 'settings.json'), topKey: 'mcpServers', backup: false },
      { path: path.join(os.homedir(), '.mcp.json'), topKey: 'mcpServers', backup: false },
      { path: path.join(os.homedir(), '.config', 'opencode', 'config.json'), topKey: 'mcp', backup: false },
    ]

    for (const cfg of configs) {
      try {
        if (!fs.existsSync(cfg.path)) continue
        const config = JSON.parse(fs.readFileSync(cfg.path, 'utf-8'))
        const entry = config?.[cfg.topKey]?.codefire
        if (!entry) continue

        let changed = false

        // Update stale server path (skip dev paths)
        if (entry.args?.[0] && entry.args[0] !== currentPath) {
          if (entry.args[0].includes('dist-electron')) continue
          entry.args[0] = currentPath
          changed = true
        }

        // Fix bare "node" or non-absolute command path
        if (nodePath && entry.command && !path.isAbsolute(entry.command)) {
          entry.command = nodePath
          changed = true
        }

        // Validate command binary exists on disk
        if (entry.command && path.isAbsolute(entry.command) && !fs.existsSync(entry.command)) {
          if (nodePath) {
            entry.command = nodePath
            changed = true
          } else {
            console.warn(`[MCPAutoSetup] Config ${cfg.path} has broken command: ${entry.command}`)
          }
        }

        if (changed) {
          if (cfg.backup) {
            fs.copyFileSync(cfg.path, cfg.path + '.bak')
          }
          fs.writeFileSync(cfg.path, JSON.stringify(config, null, 2) + '\n', 'utf-8')
          console.log(`[MCPAutoSetup] Updated MCP config: ${cfg.path}`)
        }
      } catch (err) {
        console.error(`[MCPAutoSetup] Failed to update config ${cfg.path}:`, err)
      }
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

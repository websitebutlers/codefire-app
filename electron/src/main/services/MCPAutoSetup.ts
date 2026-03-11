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
    const nodePath = DeepLinkService.resolveNodePath()

    // Check Claude Code config
    const claudeConfig = path.join(os.homedir(), '.claude.json')
    try {
      if (fs.existsSync(claudeConfig)) {
        const config = JSON.parse(fs.readFileSync(claudeConfig, 'utf-8'))
        const entry = config?.mcpServers?.codefire
        if (entry) {
          let changed = false
          // Update stale server path
          if (entry.args?.[0] && entry.args[0] !== currentPath) {
            if (entry.args[0].includes('dist-electron')) return
            entry.args[0] = currentPath
            changed = true
          }
          // Update bare "node" to absolute path
          if (entry.command === 'node') {
            entry.command = nodePath
            changed = true
          }
          if (changed) {
            fs.copyFileSync(claudeConfig, claudeConfig + '.bak')
            fs.writeFileSync(claudeConfig, JSON.stringify(config, null, 2) + '\n', 'utf-8')
            console.log('[MCPAutoSetup] Updated Claude Code MCP config')
          }
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
        if (entry) {
          let changed = false
          if (entry.args?.[0] && entry.args[0] !== currentPath) {
            if (entry.args[0].includes('dist-electron')) return
            entry.args[0] = currentPath
            changed = true
          }
          if (entry.command === 'node') {
            entry.command = nodePath
            changed = true
          }
          if (changed) {
            fs.writeFileSync(geminiConfig, JSON.stringify(config, null, 2) + '\n', 'utf-8')
            console.log('[MCPAutoSetup] Updated Gemini CLI MCP config')
          }
        }
      }
    } catch (err) {
      console.error('[MCPAutoSetup] Failed to update Gemini config:', err)
    }

    // Check project-level .mcp.json in home directory
    const homeMcpJson = path.join(os.homedir(), '.mcp.json')
    try {
      if (fs.existsSync(homeMcpJson)) {
        const config = JSON.parse(fs.readFileSync(homeMcpJson, 'utf-8'))
        const entry = config?.mcpServers?.codefire
        if (entry) {
          let changed = false
          if (entry.args?.[0] && entry.args[0] !== currentPath) {
            if (entry.args[0].includes('dist-electron')) return
            entry.args[0] = currentPath
            changed = true
          }
          if (entry.command === 'node') {
            entry.command = nodePath
            changed = true
          }
          if (changed) {
            fs.writeFileSync(homeMcpJson, JSON.stringify(config, null, 2) + '\n', 'utf-8')
            console.log('[MCPAutoSetup] Updated ~/.mcp.json MCP config')
          }
        }
      }
    } catch (err) {
      console.error('[MCPAutoSetup] Failed to update ~/.mcp.json:', err)
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

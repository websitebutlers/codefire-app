import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { MCPServerManager } from './MCPServerManager'

export type CLIProvider = 'claude' | 'gemini' | 'codex' | 'opencode'

const CLI_DISPLAY_NAMES: Record<CLIProvider, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
}

export interface DeepLinkResult {
  success: boolean
  cli: CLIProvider
  displayName: string
  error?: string
}

/**
 * Parses codefire:// deep link URLs and installs MCP configuration
 * for the specified CLI provider.
 *
 * URL format: codefire://install-mcp?client=claude
 */
export class DeepLinkService {
  /**
   * Parse and handle a codefire:// URL.
   * Returns null if the URL is not a valid deep link.
   */
  handleURL(urlString: string): DeepLinkResult | null {
    let url: URL
    try {
      url = new URL(urlString)
    } catch {
      return null
    }

    if (url.protocol !== 'codefire:') return null

    if (url.hostname === 'auth' || url.pathname?.startsWith('/callback')) {
      // Auth callback from Supabase email confirmation — handled by renderer
      return { success: true, cli: 'claude' as CLIProvider, displayName: 'Auth callback' }
    }

    if (url.hostname !== 'install-mcp') return null

    const client = url.searchParams.get('client') as CLIProvider | null
    if (!client || !CLI_DISPLAY_NAMES[client]) return null

    return this.installMCP(client)
  }

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

  private installMCP(cli: CLIProvider): DeepLinkResult {
    const mcpServerPath = MCPServerManager.getMcpServerPath()
    return this.installMCPWithPath(cli, mcpServerPath)
  }

  private installClaudeMCP(cli: CLIProvider, displayName: string, mcpServerPath: string): DeepLinkResult {
    // Try `claude mcp add` command first
    try {
      const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude'
      execFileSync(claudeCmd, ['mcp', 'add', 'codefire', '--', 'node', mcpServerPath], {
        stdio: 'ignore',
        timeout: 10000,
      })
      return { success: true, cli, displayName }
    } catch {
      // Fall back to writing ~/.claude.json directly
    }

    // Fallback: write to global claude config
    const configPath = path.join(os.homedir(), '.claude.json')
    this.installJSONMCP(configPath, 'mcpServers', {
      command: 'node',
      args: [mcpServerPath],
    })
    return { success: true, cli, displayName }
  }

  /**
   * Merge-safe JSON MCP config writer.
   * Only adds/updates the "codefire" entry under the specified top-level key.
   */
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

  /**
   * Merge-safe TOML MCP config writer for Codex CLI.
   */
  private installCodexMCP(configPath: string, mcpServerPath: string): void {
    const dir = path.dirname(configPath)
    fs.mkdirSync(dir, { recursive: true })

    const escapedPath = mcpServerPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const section = `\n[mcp_servers.codefire]\ncommand = "node"\nargs = ["${escapedPath}"]\n`

    if (fs.existsSync(configPath)) {
      let content = fs.readFileSync(configPath, 'utf-8')
      // Remove existing codefire section if present
      content = content.replace(/\[mcp_servers\.codefire\][^\[]*/s, '')
      content = content.trimEnd()
      content += '\n' + section
      fs.writeFileSync(configPath, content, 'utf-8')
    } else {
      fs.writeFileSync(configPath, section.trimStart(), 'utf-8')
    }
  }
}

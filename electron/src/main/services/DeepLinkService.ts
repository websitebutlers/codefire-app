import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { MCPServerManager } from './MCPServerManager'

/**
 * Resolve the absolute path of a binary by checking common locations and `which`.
 * GUI-spawned processes on macOS don't inherit the user's shell PATH (nvm, Homebrew,
 * Volta, etc.), so bare command names like "node" or "claude" fail with ENOENT.
 *
 * Returns the absolute path if found, or the bare name as a last resort for
 * non-critical binaries (like CLI tools). Use resolveNodePath() for node — it
 * will throw if resolution fails.
 */
function resolveAbsoluteBinary(name: string, extraPaths: string[] = []): string {
  // 1. Check well-known locations first (no shell needed)
  for (const candidate of extraPaths) {
    if (fs.existsSync(candidate)) return candidate
  }

  // 2. Try `which` inside a login shell to pick up nvm/Homebrew/Volta PATH.
  //    Uses execFileSync with explicit shell args to avoid shell injection.
  const shell = process.env.SHELL || '/bin/zsh'
  for (const flag of ['-lc', '-ic']) {
    try {
      const result = execFileSync(shell, [flag, `which ${name}`], {
        timeout: 5000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      if (result && fs.existsSync(result)) return result
    } catch { /* not found via this shell mode */ }
  }

  // 3. Fallback: return bare name (caller should validate for critical binaries)
  return name
}

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

      // For all other CLIs, write JSON/TOML config files
      const nodePath = DeepLinkService.resolveNodePath()
      switch (cli) {
        case 'gemini':
          this.installJSONMCP(
            path.join(os.homedir(), '.gemini', 'settings.json'),
            'mcpServers',
            { command: nodePath, args: [serverPath] }
          )
          break
        case 'codex':
          this.installCodexMCP(
            path.join(os.homedir(), '.codex', 'config.toml'),
            serverPath,
            nodePath
          )
          break
        case 'opencode':
          this.installJSONMCP(
            path.join(os.homedir(), '.config', 'opencode', 'config.json'),
            'mcp',
            { type: 'local', command: [nodePath, serverPath] }
          )
          break
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
    const nodePath = DeepLinkService.resolveNodePath()

    // Try `claude mcp add` command first
    try {
      const claudeCmd = resolveAbsoluteBinary(
        process.platform === 'win32' ? 'claude.cmd' : 'claude',
        [
          '/usr/local/bin/claude',
          '/opt/homebrew/bin/claude',
          path.join(os.homedir(), '.claude', 'local', 'claude'),
          path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
        ]
      )
      execFileSync(claudeCmd, ['mcp', 'add', 'codefire', '--', nodePath, mcpServerPath], {
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
      command: nodePath,
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
   * Resolve the absolute path to the node binary.
   * Throws if node cannot be found — callers must handle the error and show
   * a diagnostic message rather than writing broken MCP config.
   */
  static resolveNodePath(): string {
    const resolved = resolveAbsoluteBinary('node', [
      // macOS — Homebrew (Apple Silicon first, then Intel)
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      // macOS/Linux — version managers
      path.join(os.homedir(), '.nvm/current/bin/node'),
      path.join(os.homedir(), '.volta/bin/node'),
      path.join(os.homedir(), '.fnm/aliases/default/bin/node'),
      path.join(os.homedir(), '.local/share/fnm/aliases/default/bin/node'),
      path.join(os.homedir(), '.asdf/shims/node'),
      path.join(os.homedir(), '.mise/shims/node'),
      path.join(os.homedir(), '.proto/shims/node'),
      path.join(os.homedir(), '.local/bin/node'),
      // Linux — system packages
      '/usr/bin/node',
      // Windows
      'C:\\Program Files\\nodejs\\node.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
    ])
    if (resolved === 'node' || !path.isAbsolute(resolved)) {
      throw new Error(
        'Could not find Node.js. CodeFire needs Node.js to run its MCP server. ' +
        'Please install Node.js (https://nodejs.org) and restart CodeFire.'
      )
    }
    return resolved
  }

  /**
   * Merge-safe TOML MCP config writer for Codex CLI.
   */
  private installCodexMCP(configPath: string, mcpServerPath: string, nodePath: string): void {
    const dir = path.dirname(configPath)
    fs.mkdirSync(dir, { recursive: true })

    const escapedPath = mcpServerPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const escapedNode = nodePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const section = `\n[mcp_servers.codefire]\ncommand = "${escapedNode}"\nargs = ["${escapedPath}"]\n`

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

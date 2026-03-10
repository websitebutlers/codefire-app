import { ipcMain, net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { readConfig } from '../services/ConfigStore'

export interface RuleFile {
  scope: 'global' | 'project' | 'local'
  label: string
  path: string
  exists: boolean
  color: 'blue' | 'purple' | 'orange'
}

const TEMPLATES: Record<string, string> = {
  global: `# Global Claude Code Instructions

## Coding Style
<!-- Your preferred coding conventions across all projects -->

## Communication
<!-- How you want Claude to communicate (concise, detailed, etc.) -->

## Tool Preferences
<!-- Tools or approaches you always want Claude to use or avoid -->
`,
  project: `# Project Instructions

## Architecture
<!-- Key architectural decisions and patterns -->

## Conventions
<!-- Coding standards, naming conventions, file organization -->

## Dependencies
<!-- Important libraries, frameworks, and how to use them -->
`,
  local: `# Local Instructions

## Environment
<!-- Local dev environment details, paths, API keys references -->

## Personal Overrides
<!-- Your personal preferences that differ from team standards -->
`,
}

const DEFAULT_TEMPLATE = TEMPLATES.project

/**
 * Register IPC handlers for CLAUDE.md rule file operations.
 */
export function registerRulesHandlers() {
  ipcMain.handle(
    'rules:list',
    (_event, projectPath: string): RuleFile[] => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }

      const globalPath = path.join(os.homedir(), '.claude', 'CLAUDE.md')
      const projectFilePath = path.join(projectPath, 'CLAUDE.md')
      const localPath = path.join(projectPath, '.claude', 'CLAUDE.md')

      return [
        {
          scope: 'global',
          label: 'Global (~/.claude/CLAUDE.md)',
          path: globalPath,
          exists: fs.existsSync(globalPath),
          color: 'blue',
        },
        {
          scope: 'project',
          label: 'Project (CLAUDE.md)',
          path: projectFilePath,
          exists: fs.existsSync(projectFilePath),
          color: 'purple',
        },
        {
          scope: 'local',
          label: 'Local (.claude/CLAUDE.md)',
          path: localPath,
          exists: fs.existsSync(localPath),
          color: 'orange',
        },
      ]
    }
  )

  ipcMain.handle(
    'rules:read',
    (_event, filePath: string): string => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }

      try {
        return fs.readFileSync(filePath, 'utf-8')
      } catch (err) {
        throw new Error(
          `Failed to read rule file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'rules:write',
    (_event, filePath: string, content: string): void => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }
      if (typeof content !== 'string') {
        throw new Error('content must be a string')
      }

      try {
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(filePath, content, 'utf-8')
      } catch (err) {
        throw new Error(
          `Failed to write rule file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'rules:create',
    (_event, filePath: string, templateOrScope?: string): void => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }

      try {
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        // If templateOrScope matches a known scope key, use its template; otherwise treat as raw template
        const content = TEMPLATES[templateOrScope ?? ''] ?? templateOrScope ?? DEFAULT_TEMPLATE
        fs.writeFileSync(filePath, content, 'utf-8')
      } catch (err) {
        throw new Error(
          `Failed to create rule file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  // ── AI Rule Generation ──────────────────────────────────────────────────
  ipcMain.handle(
    'rules:generate',
    async (_event, projectPath: string, scope: string): Promise<string> => {
      const config = readConfig()
      const apiKey = config.openRouterKey
      if (!apiKey) throw new Error('OpenRouter API key not configured. Set it in Settings > Engine.')

      const tree = quickFileTree(projectPath, 500)
      const existingRules = readExistingRules(projectPath)

      const scopeDesc =
        scope === 'global'
          ? 'global rules that apply to ALL projects'
          : scope === 'project'
            ? 'project-specific rules for this codebase'
            : 'local/personal rules for this developer'

      const prompt = `Analyze this project and generate a CLAUDE.md rules file (${scopeDesc}).

PROJECT FILE TREE:
${tree}

${existingRules ? `EXISTING RULES (other scopes — avoid duplicating):\n${existingRules}\n` : ''}
Generate a well-structured CLAUDE.md with sections like:
- Project Overview (what this project is, key tech)
- Code Style (conventions, formatting, naming)
- Important Patterns (architecture patterns, key abstractions)
- Testing (how to run tests, testing patterns)
- Key Commands (build, dev, test commands)

Be concise and specific to this project. Use markdown. Output ONLY the file content, no explanations.`

      const body = JSON.stringify({
        model: config.chatModel || 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      })

      return new Promise<string>((resolve, reject) => {
        const request = net.request({
          method: 'POST',
          url: 'https://openrouter.ai/api/v1/chat/completions',
        })
        request.setHeader('Content-Type', 'application/json')
        request.setHeader('Authorization', `Bearer ${apiKey}`)

        let responseData = ''

        request.on('response', (response) => {
          response.on('data', (chunk) => {
            responseData += chunk.toString()
          })
          response.on('end', () => {
            try {
              const json = JSON.parse(responseData) as {
                choices?: Array<{ message?: { content?: string } }>
                error?: { message?: string }
              }
              if (json.error) {
                reject(new Error(json.error.message || 'API error'))
                return
              }
              const content = json.choices?.[0]?.message?.content
              if (!content) {
                reject(new Error('No content in API response'))
                return
              }
              resolve(content.trim())
            } catch (err) {
              reject(new Error(`Failed to parse API response: ${err instanceof Error ? err.message : String(err)}`))
            }
          })
        })

        request.on('error', (err) => reject(new Error(`API request failed: ${err.message}`)))
        request.write(body)
        request.end()
      })
    }
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '__pycache__',
  '.venv', 'venv', 'target', '.gradle', '.idea', '.vscode', 'coverage',
  '.turbo', '.output', '.cache', '.parcel-cache',
])

const SOURCE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'kt', 'swift',
  'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'vue', 'svelte', 'dart',
  'json', 'yaml', 'yml', 'toml', 'md', 'sql', 'sh', 'bash', 'css', 'scss',
])

function quickFileTree(projectPath: string, maxFiles: number): string {
  const files: string[] = []

  function walk(dir: string) {
    if (files.length >= maxFiles) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) break
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(path.join(dir, entry.name))
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase()
        if (!SOURCE_EXTS.has(ext)) continue
        files.push(path.relative(projectPath, path.join(dir, entry.name)).replace(/\\/g, '/'))
      }
    }
  }

  walk(projectPath)
  return files.join('\n')
}

function readExistingRules(projectPath: string): string {
  const paths = [
    path.join(os.homedir(), '.claude', 'CLAUDE.md'),
    path.join(projectPath, 'CLAUDE.md'),
    path.join(projectPath, '.claude', 'CLAUDE.md'),
  ]
  const sections: string[] = []
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8').trim()
        if (content) sections.push(`--- ${path.basename(path.dirname(p))}/${path.basename(p)} ---\n${content}`)
      }
    } catch { /* skip */ }
  }
  return sections.join('\n\n')
}

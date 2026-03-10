import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type Database from 'better-sqlite3'
import { CodebaseSnapshotDAO } from '../database/dao/CodebaseSnapshotDAO'
import { scanArchitecture, scanSchema } from './ProjectAnalyzer'

const execFileAsync = promisify(execFile)

// ── Skip Directories ─────────────────────────────────────────────────────
const SKIP_DIRS = new Set([
  'node_modules', '.build', 'build', '.dart_tool', '__pycache__',
  '.next', 'dist', '.git', '.gradle', 'Pods', 'dist-electron',
  '.svelte-kit', '.nuxt', '.output', 'coverage', '.cache',
])

const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'swift', 'dart', 'py', 'rs', 'go',
  'java', 'kt', 'rb', 'php', 'c', 'cpp', 'h', 'cs', 'vue', 'svelte',
])

// ── Data Types ───────────────────────────────────────────────────────────

interface FileNode {
  relativePath: string
  name: string
  directory: string
  extension: string
  lineCount: number
}

interface GitCommit {
  sha: string
  message: string
  author: string
  date: string
}

// ── Profile Generator ────────────────────────────────────────────────────

export class ProjectProfileGenerator {
  private snapshotDAO: CodebaseSnapshotDAO

  constructor(db: Database.Database) {
    this.snapshotDAO = new CodebaseSnapshotDAO(db)
  }

  /** Load the most recent cached profile for a project */
  loadCached(projectId: string): string | null {
    return this.snapshotDAO.getLatest(projectId)?.profileText ?? null
  }

  /** Generate a fresh profile, cache it, and return the text */
  async generate(projectId: string, projectPath: string): Promise<string> {
    const projectName = path.basename(projectPath)
    const projectType = detectProjectType(projectPath)

    // Run scanners
    const fileTree = scanFileTree(projectPath)
    const arch = scanArchitecture(projectPath)
    const schema = scanSchema(projectPath)
    const gitHistory = await scanGitHistory(projectPath)

    // Build profile text
    const sections: string[] = []
    sections.push(`PROJECT PROFILE: ${projectName}`)
    sections.push(`Type: ${projectType}`)
    sections.push(`Path: ${projectPath}`)
    sections.push('')

    // File tree section
    const fileSection = renderFileTree(fileTree)
    if (fileSection) sections.push(fileSection)

    // Architecture section
    const archSection = renderArchitecture(arch.nodes)
    if (archSection) sections.push(archSection)

    // Schema section
    const schemaSection = renderSchema(schema)
    if (schemaSection) sections.push(schemaSection)

    // Git activity section
    const gitSection = renderGitActivity(gitHistory)
    if (gitSection) sections.push(gitSection)

    const profileText = sections.join('\n')

    // Build file tree JSON for backward compat
    const fileTreeJson = JSON.stringify(
      fileTree.map((f) => f.relativePath)
    )

    // Key symbols: top-level directories + entry files
    const keyDirs = new Set<string>()
    for (const f of fileTree) {
      const topDir = f.directory.split(/[/\\]/)[0]
      if (topDir) keyDirs.add(topDir)
    }
    const keySymbols = JSON.stringify(Array.from(keyDirs).slice(0, 20))

    // Upsert into DB
    this.snapshotDAO.upsert({
      projectId,
      fileTree: fileTreeJson,
      keySymbols,
      profileText,
    })

    return profileText
  }
}

// ── Project Type Detection ───────────────────────────────────────────────

function detectProjectType(projectPath: string): string {
  const exists = (name: string) => {
    try {
      return fs.existsSync(path.join(projectPath, name))
    } catch {
      return false
    }
  }

  if (exists('pubspec.yaml')) return 'Flutter / Dart'
  if (exists('Package.swift')) return 'Swift Package'
  if (exists('next.config.js') || exists('next.config.ts') || exists('next.config.mjs')) return 'Next.js'
  if (exists('nuxt.config.ts') || exists('nuxt.config.js')) return 'Nuxt'
  if (exists('angular.json')) return 'Angular'
  if (exists('svelte.config.js') || exists('svelte.config.ts')) return 'SvelteKit'
  if (exists('Cargo.toml')) return 'Rust'
  if (exists('go.mod')) return 'Go'
  if (exists('pyproject.toml') || exists('setup.py')) return 'Python'
  if (exists('requirements.txt')) return 'Python'
  if (exists('Gemfile')) return 'Ruby'
  if (exists('tsconfig.json')) return 'TypeScript'
  if (exists('package.json')) return 'Node.js'
  return 'Unknown'
}

// ── File Tree Scanner ────────────────────────────────────────────────────

function scanFileTree(projectPath: string, maxFiles = 2000): FileNode[] {
  const results: FileNode[] = []

  function walk(dir: string) {
    if (results.length >= maxFiles) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(path.join(dir, entry.name))
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase()
        if (!SOURCE_EXTENSIONS.has(ext)) continue

        const absPath = path.join(dir, entry.name)
        const relativePath = path.relative(projectPath, absPath).replace(/\\/g, '/')

        let lineCount = 0
        try {
          const content = fs.readFileSync(absPath, 'utf-8')
          lineCount = content.split('\n').length
        } catch {
          // unreadable file
        }

        results.push({
          relativePath,
          name: entry.name,
          directory: path.dirname(relativePath),
          extension: ext,
          lineCount,
        })
      }
    }
  }

  walk(projectPath)
  return results
}

// ── Git History Scanner ──────────────────────────────────────────────────

async function scanGitHistory(projectPath: string): Promise<GitCommit[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '--oneline', '--format=%H|%s|%an|%ai', '-n', '20'],
      { cwd: projectPath, timeout: 5000 }
    )
    const lines = String(stdout).trim().split('\n').filter(Boolean)
    return lines.map((line) => {
      const [sha, message, author, date] = line.split('|')
      return { sha: sha?.slice(0, 7) ?? '', message: message ?? '', author: author ?? '', date: date?.slice(0, 10) ?? '' }
    })
  } catch {
    return []
  }
}

// ── Renderers ────────────────────────────────────────────────────────────

function renderFileTree(nodes: FileNode[]): string {
  if (nodes.length === 0) return ''

  // Group by directory
  const dirMap = new Map<string, { files: number; lines: number; extensions: Set<string> }>()
  for (const f of nodes) {
    const dir = f.directory || '.'
    const entry = dirMap.get(dir) ?? { files: 0, lines: 0, extensions: new Set() }
    entry.files++
    entry.lines += f.lineCount
    entry.extensions.add(f.extension)
    dirMap.set(dir, entry)
  }

  const totalLines = nodes.reduce((sum, f) => sum + f.lineCount, 0)
  const lines: string[] = []
  lines.push(`FILE STRUCTURE (${nodes.length} files, ${totalLines.toLocaleString()} lines):`)

  // Sort by file count descending, show top 20
  const sorted = Array.from(dirMap.entries())
    .sort((a, b) => b[1].files - a[1].files)
    .slice(0, 20)

  for (const [dir, info] of sorted) {
    const exts = Array.from(info.extensions).join(', ')
    lines.push(`  ${dir}/ (${info.files} files, ${info.lines.toLocaleString()} lines) [${exts}]`)
  }

  lines.push('')
  return lines.join('\n')
}

function renderArchitecture(nodes: { id: string; imports: string[] }[]): string {
  if (nodes.length === 0) return ''

  // Count import frequency
  const importCounts = new Map<string, number>()
  for (const node of nodes) {
    for (const imp of node.imports) {
      // Extract package name from import path
      const pkg = imp.startsWith('.') ? null : imp.split('/')[0]
      if (pkg) {
        importCounts.set(pkg, (importCounts.get(pkg) ?? 0) + 1)
      }
    }
  }

  const topImports = Array.from(importCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)

  if (topImports.length === 0) return ''

  const lines: string[] = []
  lines.push('ARCHITECTURE:')
  lines.push('  Key dependencies:')
  for (const [pkg, count] of topImports) {
    lines.push(`    - ${pkg} (used in ${count} files)`)
  }
  lines.push('')
  return lines.join('\n')
}

function renderSchema(tables: { name: string; columns: { name: string; type: string; isPrimaryKey: boolean; isForeignKey: boolean; references: string | null }[] }[]): string {
  if (tables.length === 0) return ''

  const lines: string[] = []
  lines.push(`DATABASE SCHEMA (${tables.length} tables):`)
  for (const table of tables) {
    const cols = table.columns.map((c) => {
      let desc = c.name
      if (c.isPrimaryKey) desc += ' (PK)'
      if (c.isForeignKey && c.references) desc += ` -> ${c.references}`
      return desc
    })
    lines.push(`  ${table.name}: ${cols.join(', ')}`)
  }
  lines.push('')
  return lines.join('\n')
}

function renderGitActivity(commits: GitCommit[]): string {
  if (commits.length === 0) return ''

  const lines: string[] = []
  lines.push('RECENT GIT ACTIVITY:')
  for (const c of commits.slice(0, 10)) {
    lines.push(`  - ${c.date}: ${c.message} (${c.author})`)
  }
  lines.push('')
  return lines.join('\n')
}

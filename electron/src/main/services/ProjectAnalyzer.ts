import * as fs from 'fs'
import * as path from 'path'

// ── Data Structures ──────────────────────────────────────────────────────

export interface ArchNode {
  id: string       // relative file path
  name: string     // filename
  directory: string // parent directory
  fileType: string  // extension
  imports: string[] // relative paths of imported files
  x: number
  y: number
}

export interface ArchEdge {
  id: string
  from: string     // source file path
  to: string       // imported file path
}

export interface SchemaTable {
  id: string
  name: string
  columns: SchemaColumn[]
  x: number
  y: number
}

export interface SchemaColumn {
  id: string
  name: string
  type: string
  isPrimaryKey: boolean
  isForeignKey: boolean
  references: string | null
}

// ── Directories/Extensions to skip/include ───────────────────────────────

const SOURCE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'swift', 'dart', 'py', 'rs', 'go'])
const SKIP_DIRS = new Set(['node_modules', '.build', 'build', '.dart_tool', '__pycache__', '.next', 'dist', '.git', '.gradle', 'Pods', 'dist-electron'])

const IMPORT_REGEX = /from\s+['"]([^'"]+)['"]/g
const EXTENSION_CANDIDATES = ['', '.ts', '.tsx', '.js', '.jsx', '.dart', '/index.ts', '/index.js']

// ── Architecture Scan ────────────────────────────────────────────────────

export function scanArchitecture(projectPath: string): { nodes: ArchNode[]; edges: ArchEdge[] } {
  const allFiles = new Map<string, string>() // relativePath -> absolutePath

  // Enumerate source files
  function walk(dir: string, relDir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue
        if (SKIP_DIRS.has(entry.name)) continue

        const fullPath = path.join(dir, entry.name)
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          walk(fullPath, relPath)
        } else {
          const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
          if (SOURCE_EXTENSIONS.has(ext)) {
            allFiles.set(relPath, fullPath)
          }
        }
      }
    } catch {
      // Permission errors
    }
  }

  walk(projectPath, '')

  if (allFiles.size === 0) return { nodes: [], edges: [] }

  // Cap at 500 files to keep visualization usable
  const fileEntries = Array.from(allFiles.entries()).slice(0, 500)
  const fileSet = new Set(fileEntries.map(([rel]) => rel))

  // Parse imports and build nodes
  const nodes: ArchNode[] = []
  const edges: ArchEdge[] = []

  for (const [relPath, absPath] of fileEntries) {
    const ext = relPath.split('.').pop()?.toLowerCase() ?? ''
    const name = path.basename(relPath)
    const directory = path.dirname(relPath)
    const imports: string[] = []

    // Parse imports for TS/JS files
    if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
      try {
        const content = fs.readFileSync(absPath, 'utf-8')
        let match: RegExpExecArray | null
        const regex = new RegExp(IMPORT_REGEX.source, 'g')

        while ((match = regex.exec(content)) !== null) {
          const importPath = match[1]
          // Only resolve relative imports
          if (!importPath.startsWith('.')) continue

          const resolved = resolveRelativePath(directory, importPath)

          // Try extension candidates
          for (const candidate of EXTENSION_CANDIDATES) {
            const full = resolved + candidate
            if (fileSet.has(full)) {
              imports.push(full)
              edges.push({
                id: `${relPath}->${full}`,
                from: relPath,
                to: full,
              })
              break
            }
          }
        }
      } catch {
        // Read error
      }
    }

    nodes.push({ id: relPath, name, directory, fileType: ext, imports, x: 0, y: 0 })
  }

  // Circular layout sorted by directory
  nodes.sort((a, b) => a.directory.localeCompare(b.directory))
  const radius = Math.max(150, nodes.length * 8)
  const centerX = radius + 60
  const centerY = radius + 60

  for (let i = 0; i < nodes.length; i++) {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2
    nodes[i].x = Math.round(centerX + radius * Math.cos(angle))
    nodes[i].y = Math.round(centerY + radius * Math.sin(angle))
  }

  return { nodes, edges }
}

function resolveRelativePath(currentDir: string, importPath: string): string {
  const parts = currentDir ? currentDir.split('/') : []

  for (const segment of importPath.split('/')) {
    if (segment === '.') continue
    else if (segment === '..') parts.pop()
    else parts.push(segment)
  }

  return parts.join('/')
}

// ── Schema Scan ──────────────────────────────────────────────────────────

export function scanSchema(projectPath: string): SchemaTable[] {
  // Try Prisma
  const prismaPath = path.join(projectPath, 'prisma', 'schema.prisma')
  if (fs.existsSync(prismaPath)) {
    try {
      const content = fs.readFileSync(prismaPath, 'utf-8')
      return layoutTables(parsePrismaSchema(content))
    } catch { /* fall through */ }
  }

  // Try SQL files
  for (const sqlFile of ['schema.sql', 'supabase/schema.sql']) {
    const sqlPath = path.join(projectPath, sqlFile)
    if (fs.existsSync(sqlPath)) {
      try {
        const content = fs.readFileSync(sqlPath, 'utf-8')
        return layoutTables(parseSQLSchema(content))
      } catch { /* fall through */ }
  }
  }

  // Try migrations directory for SQL files
  for (const migrDir of ['migrations', 'supabase/migrations', 'prisma/migrations']) {
    const dirPath = path.join(projectPath, migrDir)
    if (fs.existsSync(dirPath)) {
      try {
        const files = fs.readdirSync(dirPath, { recursive: true }) as string[]
        const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort()
        if (sqlFiles.length > 0) {
          // Read all migration SQL and combine
          let combined = ''
          for (const f of sqlFiles.slice(-10)) { // last 10 migrations
            combined += fs.readFileSync(path.join(dirPath, f), 'utf-8') + '\n'
          }
          const tables = parseSQLSchema(combined)
          if (tables.length > 0) return layoutTables(tables)
        }
      } catch { /* fall through */ }
    }
  }

  return []
}

function parsePrismaSchema(content: string): SchemaTable[] {
  const tables: SchemaTable[] = []
  let currentModel: string | null = null
  let columns: SchemaColumn[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    // Model start
    const modelMatch = trimmed.match(/^model\s+(\w+)\s*\{/)
    if (modelMatch) {
      currentModel = modelMatch[1]
      columns = []
      continue
    }

    // Model end
    if (trimmed === '}' && currentModel) {
      tables.push({
        id: currentModel,
        name: currentModel,
        columns,
        x: 0,
        y: 0,
      })
      currentModel = null
      continue
    }

    if (!currentModel) continue
    if (trimmed.startsWith('@@') || trimmed.startsWith('//') || trimmed.length === 0) continue

    // Parse column
    const parts = trimmed.split(/\s+/)
    if (parts.length < 2) continue

    const colName = parts[0]
    const colType = parts[1]
    const isPrimaryKey = trimmed.includes('@id')
    const isForeignKey = trimmed.includes('@relation')
    const references = isForeignKey ? colType.replace(/[?\[\]]/g, '') : null

    columns.push({
      id: `${currentModel}.${colName}`,
      name: colName,
      type: colType,
      isPrimaryKey,
      isForeignKey,
      references,
    })
  }

  return tables
}

function parseSQLSchema(content: string): SchemaTable[] {
  const tables: SchemaTable[] = []
  const createRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi

  let match: RegExpExecArray | null
  while ((match = createRegex.exec(content)) !== null) {
    const tableName = match[1]
    const body = match[2]
    const columns: SchemaColumn[] = []

    for (const colLine of body.split(',')) {
      const trimmed = colLine.trim()
      if (!trimmed) continue

      // Skip constraint lines
      const upper = trimmed.toUpperCase()
      if (upper.startsWith('PRIMARY KEY') || upper.startsWith('FOREIGN KEY') ||
          upper.startsWith('UNIQUE') || upper.startsWith('CONSTRAINT') ||
          upper.startsWith('CHECK')) continue

      const colParts = trimmed.split(/\s+/)
      if (colParts.length < 2) continue

      const colName = colParts[0].replace(/["'`]/g, '')
      const colType = colParts[1]

      const isPrimaryKey = upper.includes('PRIMARY KEY')
      const refMatch = trimmed.match(/REFERENCES\s+["'`]?(\w+)/i)
      const isForeignKey = !!refMatch
      const references = refMatch ? refMatch[1] : null

      columns.push({
        id: `${tableName}.${colName}`,
        name: colName,
        type: colType,
        isPrimaryKey,
        isForeignKey,
        references,
      })
    }

    if (columns.length > 0) {
      tables.push({ id: tableName, name: tableName, columns, x: 0, y: 0 })
    }
  }

  return tables
}

function layoutTables(tables: SchemaTable[]): SchemaTable[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)))
  for (let i = 0; i < tables.length; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    tables[i].x = 30 + col * 280
    tables[i].y = 30 + row * 240
  }
  return tables
}

#!/usr/bin/env node

/**
 * CodeFire MCP Server — Standalone process for AI coding agents.
 * Exposes project data (tasks, notes, sessions, etc.) via MCP protocol over stdio.
 * Spawned by Claude Code, Gemini CLI, etc. via .mcp.json configuration.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ─── Database ────────────────────────────────────────────────────────────────

function getDatabasePath(): string {
  let dir: string
  switch (process.platform) {
    case 'darwin':
      dir = path.join(os.homedir(), 'Library', 'Application Support', 'CodeFire')
      break
    case 'win32':
      dir = path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'CodeFire'
      )
      break
    default:
      dir = path.join(os.homedir(), '.config', 'CodeFire')
  }
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'codefire.db')
}

function openDatabase(): Database.Database {
  const dbPath = getDatabasePath()
  if (!fs.existsSync(dbPath)) {
    throw new Error(`CodeFire database not found at ${dbPath}. Please run the CodeFire app first.`)
  }
  const db = new Database(dbPath, { readonly: false })
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  return db
}

// ─── Connection tracking ─────────────────────────────────────────────────────

function getConnectionDir(): string {
  let dir: string
  switch (process.platform) {
    case 'darwin':
      dir = path.join(os.homedir(), '.local', 'share', 'CodeFire', 'mcp-connections')
      break
    case 'win32':
      dir = path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'CodeFire',
        'mcp-connections'
      )
      break
    default:
      dir = path.join(os.homedir(), '.local', 'share', 'CodeFire', 'mcp-connections')
  }
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeConnectionFile(): string {
  const connDir = getConnectionDir()
  const filePath = path.join(connDir, `${process.pid}.json`)
  const data = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    transport: 'stdio',
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
  return filePath
}

function removeConnectionFile(): void {
  try {
    const connDir = getConnectionDir()
    const filePath = path.join(connDir, `${process.pid}.json`)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {
    // ignore cleanup errors
  }
}

// ─── Detect project from cwd ────────────────────────────────────────────────

function detectProject(db: Database.Database): { id: string; name: string; path: string } | null {
  const cwd = process.cwd()
  const row = db
    .prepare('SELECT id, name, path FROM projects WHERE ? LIKE path || \'%\' ORDER BY LENGTH(path) DESC LIMIT 1')
    .get(cwd) as { id: string; name: string; path: string } | undefined
  return row ?? null
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const db = openDatabase()

const server = new McpServer({
  name: 'codefire',
  version: '1.0.4',
})

// ── Projects ─────────────────────────────────────────────────────────────────

server.registerTool(
  'get_current_project',
  {
    title: 'Get Current Project',
    description: 'Auto-detect the current CodeFire project based on the working directory',
  },
  async () => {
    const project = detectProject(db)
    if (!project) {
      return { content: [{ type: 'text' as const, text: 'No CodeFire project found for the current working directory.' }] }
    }
    const full = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)
    return { content: [{ type: 'text' as const, text: JSON.stringify(full, null, 2) }] }
  }
)

server.registerTool(
  'list_projects',
  {
    title: 'List Projects',
    description: 'List all CodeFire-tracked projects',
  },
  async () => {
    const rows = db.prepare('SELECT * FROM projects ORDER BY sortOrder ASC, name ASC').all()
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] }
  }
)

// ── Tasks ────────────────────────────────────────────────────────────────────

server.registerTool(
  'list_tasks',
  {
    title: 'List Tasks',
    description: 'List tasks for a project or globally. Filter by status (todo, in_progress, done).',
    inputSchema: z.object({
      projectId: z.string().optional().describe('Project ID. If omitted, lists global tasks.'),
      status: z.enum(['todo', 'in_progress', 'done']).optional().describe('Filter by task status'),
    }),
  },
  async ({ projectId, status }) => {
    let rows
    if (projectId) {
      rows = status
        ? db.prepare('SELECT * FROM taskItems WHERE projectId = ? AND status = ? ORDER BY priority DESC, createdAt DESC').all(projectId, status)
        : db.prepare('SELECT * FROM taskItems WHERE projectId = ? ORDER BY priority DESC, createdAt DESC').all(projectId)
    } else {
      rows = status
        ? db.prepare('SELECT * FROM taskItems WHERE isGlobal = 1 AND status = ? ORDER BY priority DESC, createdAt DESC').all(status)
        : db.prepare('SELECT * FROM taskItems WHERE isGlobal = 1 ORDER BY priority DESC, createdAt DESC').all()
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] }
  }
)

server.registerTool(
  'get_task',
  {
    title: 'Get Task',
    description: 'Get a task by ID, including its notes',
    inputSchema: z.object({
      taskId: z.number().describe('Task ID'),
    }),
  },
  async ({ taskId }) => {
    const task = db.prepare('SELECT * FROM taskItems WHERE id = ?').get(taskId)
    if (!task) {
      return { content: [{ type: 'text' as const, text: `Task ${taskId} not found.` }] }
    }
    const notes = db.prepare('SELECT * FROM taskNotes WHERE taskId = ? ORDER BY createdAt ASC').all(taskId)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ ...task as object, notes }, null, 2) }] }
  }
)

server.registerTool(
  'create_task',
  {
    title: 'Create Task',
    description: 'Create a new task in CodeFire',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID'),
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description'),
      priority: z.number().min(0).max(4).optional().describe('Priority 0-4 (4 = highest)'),
      isGlobal: z.boolean().optional().describe('Whether this is a global task'),
    }),
  },
  async ({ projectId, title, description, priority, isGlobal }) => {
    const now = new Date().toISOString()
    const result = db
      .prepare(
        `INSERT INTO taskItems (projectId, title, description, status, priority, source, isGlobal, createdAt)
         VALUES (?, ?, ?, 'todo', ?, 'mcp', ?, ?)`
      )
      .run(projectId, title, description ?? null, Math.min(4, Math.max(0, priority ?? 0)), isGlobal ? 1 : 0, now)
    const task = db.prepare('SELECT * FROM taskItems WHERE id = ?').get(result.lastInsertRowid)
    return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] }
  }
)

server.registerTool(
  'update_task',
  {
    title: 'Update Task',
    description: 'Update a task (title, description, status, priority)',
    inputSchema: z.object({
      taskId: z.number().describe('Task ID'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      status: z.enum(['todo', 'in_progress', 'done']).optional().describe('New status'),
      priority: z.number().min(0).max(4).optional().describe('New priority 0-4'),
    }),
  },
  async ({ taskId, title, description, status, priority }) => {
    const existing = db.prepare('SELECT * FROM taskItems WHERE id = ?').get(taskId) as Record<string, unknown> | undefined
    if (!existing) {
      return { content: [{ type: 'text' as const, text: `Task ${taskId} not found.` }] }
    }
    const completedAt =
      status === 'done' && existing.status !== 'done'
        ? new Date().toISOString()
        : status && status !== 'done'
          ? null
          : existing.completedAt
    db.prepare(
      `UPDATE taskItems SET title = ?, description = ?, status = ?, priority = ?, completedAt = ? WHERE id = ?`
    ).run(
      title ?? existing.title,
      description ?? existing.description,
      status ?? existing.status,
      priority ?? existing.priority,
      completedAt,
      taskId
    )
    const updated = db.prepare('SELECT * FROM taskItems WHERE id = ?').get(taskId)
    return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] }
  }
)

// ── Task Notes ───────────────────────────────────────────────────────────────

server.registerTool(
  'list_task_notes',
  {
    title: 'List Task Notes',
    description: 'Get all notes for a specific task',
    inputSchema: z.object({
      taskId: z.number().describe('Task ID'),
    }),
  },
  async ({ taskId }) => {
    const notes = db.prepare('SELECT * FROM taskNotes WHERE taskId = ? ORDER BY createdAt ASC').all(taskId)
    return { content: [{ type: 'text' as const, text: JSON.stringify(notes, null, 2) }] }
  }
)

server.registerTool(
  'create_task_note',
  {
    title: 'Create Task Note',
    description: 'Add a note to a task',
    inputSchema: z.object({
      taskId: z.number().describe('Task ID'),
      content: z.string().describe('Note content'),
    }),
  },
  async ({ taskId, content }) => {
    const now = new Date().toISOString()
    const result = db
      .prepare('INSERT INTO taskNotes (taskId, content, source, createdAt) VALUES (?, ?, ?, ?)')
      .run(taskId, content, 'mcp', now)
    const note = db.prepare('SELECT * FROM taskNotes WHERE id = ?').get(result.lastInsertRowid)
    return { content: [{ type: 'text' as const, text: JSON.stringify(note, null, 2) }] }
  }
)

// ── Notes ────────────────────────────────────────────────────────────────────

server.registerTool(
  'list_notes',
  {
    title: 'List Notes',
    description: 'List notes for a project or globally',
    inputSchema: z.object({
      projectId: z.string().optional().describe('Project ID. If omitted, lists global notes.'),
    }),
  },
  async ({ projectId }) => {
    const rows = projectId
      ? db.prepare('SELECT * FROM notes WHERE projectId = ? ORDER BY updatedAt DESC').all(projectId)
      : db.prepare('SELECT * FROM notes WHERE isGlobal = 1 ORDER BY updatedAt DESC').all()
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] }
  }
)

server.registerTool(
  'get_note',
  {
    title: 'Get Note',
    description: 'Get a single note by ID',
    inputSchema: z.object({
      noteId: z.number().describe('Note ID'),
    }),
  },
  async ({ noteId }) => {
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId)
    if (!note) {
      return { content: [{ type: 'text' as const, text: `Note ${noteId} not found.` }] }
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(note, null, 2) }] }
  }
)

server.registerTool(
  'create_note',
  {
    title: 'Create Note',
    description: 'Create a new note',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID'),
      title: z.string().describe('Note title'),
      content: z.string().optional().describe('Note content (markdown)'),
      isGlobal: z.boolean().optional().describe('Whether this is a global note'),
    }),
  },
  async ({ projectId, title, content, isGlobal }) => {
    const now = new Date().toISOString()
    const result = db
      .prepare(
        'INSERT INTO notes (projectId, title, content, pinned, isGlobal, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?, ?)'
      )
      .run(projectId, title, content ?? '', isGlobal ? 1 : 0, now, now)
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid)
    return { content: [{ type: 'text' as const, text: JSON.stringify(note, null, 2) }] }
  }
)

server.registerTool(
  'update_note',
  {
    title: 'Update Note',
    description: 'Update a note',
    inputSchema: z.object({
      noteId: z.number().describe('Note ID'),
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content'),
    }),
  },
  async ({ noteId, title, content }) => {
    const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as Record<string, unknown> | undefined
    if (!existing) {
      return { content: [{ type: 'text' as const, text: `Note ${noteId} not found.` }] }
    }
    const now = new Date().toISOString()
    db.prepare('UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ?').run(
      title ?? existing.title,
      content ?? existing.content,
      now,
      noteId
    )
    const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId)
    return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] }
  }
)

server.registerTool(
  'search_notes',
  {
    title: 'Search Notes',
    description: 'Full-text search across notes',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      projectId: z.string().optional().describe('Limit search to a project'),
    }),
  },
  async ({ query, projectId }) => {
    const rows = projectId
      ? db.prepare(
          `SELECT notes.* FROM notes
           JOIN notesFts ON notes.id = notesFts.rowid
           WHERE notesFts MATCH ? AND notes.projectId = ?
           ORDER BY rank`
        ).all(query, projectId)
      : db.prepare(
          `SELECT notes.* FROM notes
           JOIN notesFts ON notes.id = notesFts.rowid
           WHERE notesFts MATCH ?
           ORDER BY rank`
        ).all(query)
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] }
  }
)

// ── Sessions ─────────────────────────────────────────────────────────────────

server.registerTool(
  'list_sessions',
  {
    title: 'List Sessions',
    description: 'List coding sessions for a project',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID'),
      limit: z.number().optional().describe('Max results (default 20)'),
    }),
  },
  async ({ projectId, limit }) => {
    const rows = db
      .prepare('SELECT * FROM sessions WHERE projectId = ? ORDER BY startedAt DESC LIMIT ?')
      .all(projectId, limit ?? 20)
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] }
  }
)

server.registerTool(
  'search_sessions',
  {
    title: 'Search Sessions',
    description: 'Full-text search across session summaries',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
    }),
  },
  async ({ query }) => {
    const rows = db.prepare(
      `SELECT sessions.* FROM sessions
       JOIN sessionsFts ON sessions.rowid = sessionsFts.rowid
       WHERE sessionsFts MATCH ?
       ORDER BY rank`
    ).all(query)
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] }
  }
)

// ── Clients ──────────────────────────────────────────────────────────────────

server.registerTool(
  'list_clients',
  {
    title: 'List Clients',
    description: 'List all billing clients',
  },
  async () => {
    const rows = db.prepare('SELECT * FROM clients ORDER BY sortOrder ASC, name ASC').all()
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] }
  }
)

server.registerTool(
  'create_client',
  {
    title: 'Create Client',
    description: 'Create a new billing client',
    inputSchema: z.object({
      name: z.string().describe('Client name'),
      color: z.string().optional().describe('Hex color (default #3B82F6)'),
    }),
  },
  async ({ name, color }) => {
    const { randomUUID } = await import('crypto')
    const id = randomUUID()
    const now = new Date().toISOString()
    db.prepare('INSERT INTO clients (id, name, color, sortOrder, createdAt) VALUES (?, ?, ?, 0, ?)').run(
      id,
      name,
      color ?? '#3B82F6',
      now
    )
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id)
    return { content: [{ type: 'text' as const, text: JSON.stringify(client, null, 2) }] }
  }
)

// ── Images ───────────────────────────────────────────────────────────────────

server.registerTool(
  'list_images',
  {
    title: 'List Images',
    description: 'List generated images for a project',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID'),
    }),
  },
  async ({ projectId }) => {
    const rows = db.prepare('SELECT * FROM generatedImages WHERE projectId = ? ORDER BY createdAt DESC').all(projectId)
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] }
  }
)

// ── Code Search ──────────────────────────────────────────────────────────────

server.registerTool(
  'search_code',
  {
    title: 'Search Code',
    description: 'Full-text search across indexed code chunks (requires indexing to be enabled)',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      projectId: z.string().optional().describe('Limit search to a project'),
      limit: z.number().optional().describe('Max results (default 10)'),
    }),
  },
  async ({ query, projectId, limit }) => {
    try {
      const rows = projectId
        ? db.prepare(
            `SELECT codeChunks.*, bm25(codeChunksFts) AS score FROM codeChunks
             JOIN codeChunksFts ON codeChunks.id = codeChunksFts.rowid
             WHERE codeChunksFts MATCH ? AND codeChunks.projectId = ?
             ORDER BY score LIMIT ?`
          ).all(query, projectId, limit ?? 10)
        : db.prepare(
            `SELECT codeChunks.*, bm25(codeChunksFts) AS score FROM codeChunks
             JOIN codeChunksFts ON codeChunks.id = codeChunksFts.rowid
             WHERE codeChunksFts MATCH ?
             ORDER BY score LIMIT ?`
          ).all(query, limit ?? 10)
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] }
    } catch {
      return { content: [{ type: 'text' as const, text: 'Code search index not available. Enable semantic code search in CodeFire settings.' }] }
    }
  }
)

// ── Browser Automation ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function executeBrowserCommand(
  tool: string,
  args: Record<string, unknown> = {},
  timeout = 5.0
): Promise<string> {
  const argsJSON = Object.keys(args).length > 0 ? JSON.stringify(args) : null
  const now = new Date().toISOString()

  const result = db
    .prepare(
      'INSERT INTO browserCommands (tool, args, status, createdAt) VALUES (?, ?, ?, ?)'
    )
    .run(tool, argsJSON, 'pending', now)

  const commandId = result.lastInsertRowid

  const startTime = Date.now()
  const timeoutMs = timeout * 1000

  while (Date.now() - startTime < timeoutMs) {
    await sleep(50)

    const cmd = db
      .prepare('SELECT * FROM browserCommands WHERE id = ?')
      .get(commandId) as { status: string; result: string | null } | undefined

    if (!cmd) {
      throw new Error(`Browser command ${commandId} disappeared`)
    }

    if (cmd.status === 'completed') {
      db.prepare('DELETE FROM browserCommands WHERE id = ?').run(commandId)
      return cmd.result ?? '{}'
    }

    if (cmd.status === 'error') {
      db.prepare('DELETE FROM browserCommands WHERE id = ?').run(commandId)
      throw new Error(cmd.result ?? 'Browser command failed')
    }
  }

  // Timeout — clean up
  db.prepare('DELETE FROM browserCommands WHERE id = ?').run(commandId)
  throw new Error(
    `Browser command timed out after ${Math.round(timeout)}s. Is CodeFire running with the browser tab visible?`
  )
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

// ── browser_navigate ─────────────────────────────────────────────────────

server.registerTool(
  'browser_navigate',
  {
    title: 'Browser Navigate',
    description:
      'Navigate the browser to a URL. Opens a new tab if none are open. Waits for page load to complete. Requires CodeFire to be running.',
    inputSchema: z.object({
      url: z.string().describe('URL to navigate to'),
    }),
  },
  async ({ url }) => {
    const result = await executeBrowserCommand('browser_navigate', { url }, 15.0)
    return textResult(result)
  }
)

// ── browser_snapshot ─────────────────────────────────────────────────────

server.registerTool(
  'browser_snapshot',
  {
    title: 'Browser Snapshot',
    description:
      'Get the accessibility tree of the current page as compact structured text. Returns ARIA roles, labels, and interactive element refs. This is the primary tool for understanding page content and structure. Requires CodeFire to be running.',
    inputSchema: z.object({
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
      max_size: z
        .number()
        .optional()
        .describe(
          'Maximum response size in bytes (default: 102400 = 100KB). Set to 0 for unlimited. Large pages may be truncated with a hint to use browser_extract.'
        ),
    }),
  },
  async ({ tab_id, max_size }) => {
    const args: Record<string, unknown> = {}
    if (tab_id) args.tab_id = tab_id
    if (max_size !== undefined) args.max_size = max_size
    const result = await executeBrowserCommand('browser_snapshot', args, 10.0)
    return textResult(result)
  }
)

// ── browser_extract ──────────────────────────────────────────────────────

server.registerTool(
  'browser_extract',
  {
    title: 'Browser Extract',
    description:
      'Extract text content from a page element using a CSS selector. Returns the text content of the first matching element. Requires CodeFire to be running.',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector to find the element'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ selector, tab_id }) => {
    const args: Record<string, unknown> = { selector }
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_extract', args)
    return textResult(result)
  }
)

// ── browser_list_tabs ────────────────────────────────────────────────────

server.registerTool(
  'browser_list_tabs',
  {
    title: 'Browser List Tabs',
    description:
      'List all open browser tabs with their URLs, titles, and loading state. Requires CodeFire to be running.',
  },
  async () => {
    const result = await executeBrowserCommand('browser_list_tabs')
    return textResult(result)
  }
)

// ── browser_console_logs ─────────────────────────────────────────────────

server.registerTool(
  'browser_console_logs',
  {
    title: 'Browser Console Logs',
    description:
      'Get JavaScript console log entries (log, warn, error, info) from a browser tab. Useful for debugging web applications. Requires CodeFire to be running.',
    inputSchema: z.object({
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
      level: z
        .enum(['log', 'warn', 'error', 'info'])
        .optional()
        .describe('Filter by level: log, warn, error, info'),
    }),
  },
  async ({ tab_id, level }) => {
    const args: Record<string, unknown> = {}
    if (tab_id) args.tab_id = tab_id
    if (level) args.level = level
    const result = await executeBrowserCommand('browser_console_logs', args)
    return textResult(result)
  }
)

// ── browser_screenshot ───────────────────────────────────────────────────

server.registerTool(
  'browser_screenshot',
  {
    title: 'Browser Screenshot',
    description:
      'Take a PNG screenshot of the current page. Returns the file path so you can read the image. Requires CodeFire to be running.',
    inputSchema: z.object({
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ tab_id }) => {
    const args: Record<string, unknown> = {}
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_screenshot', args, 10.0)
    return textResult(result)
  }
)

// ── browser_tab_open ─────────────────────────────────────────────────────

server.registerTool(
  'browser_tab_open',
  {
    title: 'Browser Tab Open',
    description:
      'Open a new browser tab. Optionally navigate to a URL. Requires CodeFire to be running.',
    inputSchema: z.object({
      url: z.string().optional().describe('URL to navigate to (optional)'),
    }),
  },
  async ({ url }) => {
    const args: Record<string, unknown> = {}
    if (url) args.url = url
    const result = await executeBrowserCommand('browser_tab_open', args, 15.0)
    return textResult(result)
  }
)

// ── browser_tab_close ────────────────────────────────────────────────────

server.registerTool(
  'browser_tab_close',
  {
    title: 'Browser Tab Close',
    description: 'Close a browser tab by its ID. Requires CodeFire to be running.',
    inputSchema: z.object({
      tab_id: z.string().describe('ID of the tab to close'),
    }),
  },
  async ({ tab_id }) => {
    const result = await executeBrowserCommand('browser_tab_close', { tab_id })
    return textResult(result)
  }
)

// ── browser_tab_switch ───────────────────────────────────────────────────

server.registerTool(
  'browser_tab_switch',
  {
    title: 'Browser Tab Switch',
    description:
      'Switch the active browser tab to the specified tab. Requires CodeFire to be running.',
    inputSchema: z.object({
      tab_id: z.string().describe('ID of the tab to switch to'),
    }),
  },
  async ({ tab_id }) => {
    const result = await executeBrowserCommand('browser_tab_switch', { tab_id })
    return textResult(result)
  }
)

// ── browser_click ────────────────────────────────────────────────────────

server.registerTool(
  'browser_click',
  {
    title: 'Browser Click',
    description:
      "Click an element by its ref from browser_snapshot. Automatically scrolls into view first. Requires CodeFire to be running with the browser tab visible.",
    inputSchema: z.object({
      ref: z.string().describe("Element ref from browser_snapshot (e.g. 'e5')"),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ ref, tab_id }) => {
    const args: Record<string, unknown> = { ref }
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_click', args)
    return textResult(result)
  }
)

// ── browser_type ─────────────────────────────────────────────────────────

server.registerTool(
  'browser_type',
  {
    title: 'Browser Type',
    description:
      'Type text into an input or textarea element by ref. Clears existing content by default. Works with React and other framework-controlled inputs. Requires CodeFire to be running with the browser tab visible.',
    inputSchema: z.object({
      ref: z.string().describe('Element ref from browser_snapshot'),
      text: z.string().describe('Text to type'),
      clear: z.boolean().optional().describe('Clear existing content first (default: true)'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ ref, text, clear, tab_id }) => {
    const args: Record<string, unknown> = { ref, text }
    if (clear !== undefined) args.clear = clear
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_type', args)
    return textResult(result)
  }
)

// ── browser_select ───────────────────────────────────────────────────────

server.registerTool(
  'browser_select',
  {
    title: 'Browser Select',
    description:
      'Select an option from a <select> dropdown by value or visible label text. On mismatch, returns all available options. Requires CodeFire to be running with the browser tab visible.',
    inputSchema: z.object({
      ref: z.string().describe('Element ref of the <select> element'),
      value: z.string().optional().describe('Option value to select'),
      label: z
        .string()
        .optional()
        .describe('Option visible text to select (alternative to value)'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ ref, value, label, tab_id }) => {
    if (!value && !label) {
      throw new Error('value or label is required')
    }
    const args: Record<string, unknown> = { ref }
    if (value) args.value = value
    if (label) args.label = label
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_select', args)
    return textResult(result)
  }
)

// ── browser_scroll ───────────────────────────────────────────────────────

server.registerTool(
  'browser_scroll',
  {
    title: 'Browser Scroll',
    description:
      'Scroll the page by direction/amount, or scroll a specific element into view. Returns scroll position info. Requires CodeFire to be running with the browser tab visible.',
    inputSchema: z.object({
      ref: z
        .string()
        .optional()
        .describe('Scroll this element into view (overrides direction/amount)'),
      direction: z
        .enum(['up', 'down', 'top', 'bottom'])
        .optional()
        .describe('Scroll direction'),
      amount: z
        .number()
        .optional()
        .describe('Pixels to scroll (default: 500, ignored for top/bottom)'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ ref, direction, amount, tab_id }) => {
    const args: Record<string, unknown> = {}
    if (ref) args.ref = ref
    if (direction) args.direction = direction
    if (amount !== undefined) args.amount = amount
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_scroll', args)
    return textResult(result)
  }
)

// ── browser_wait ─────────────────────────────────────────────────────────

server.registerTool(
  'browser_wait',
  {
    title: 'Browser Wait',
    description:
      'Wait for an element to appear on the page. Use after clicking something that triggers async loading. Accepts ref or CSS selector. Returns found status, not an error on timeout. Requires CodeFire to be running with the browser tab visible.',
    inputSchema: z.object({
      ref: z.string().optional().describe('Wait for element with this ref to exist'),
      selector: z
        .string()
        .optional()
        .describe('CSS selector to wait for (use when element has no ref yet)'),
      timeout: z
        .number()
        .optional()
        .describe('Max seconds to wait (default: 5, max: 15)'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ ref, selector, timeout: userTimeout, tab_id }) => {
    if (!ref && !selector) {
      throw new Error('ref or selector is required')
    }
    const args: Record<string, unknown> = {}
    if (ref) args.ref = ref
    if (selector) args.selector = selector
    const t = userTimeout ?? 5
    args.timeout = t
    if (tab_id) args.tab_id = tab_id
    const swiftTimeout = Math.min(t, 15) + 3.0
    const result = await executeBrowserCommand('browser_wait', args, swiftTimeout)
    return textResult(result)
  }
)

// ── browser_press ────────────────────────────────────────────────────────

server.registerTool(
  'browser_press',
  {
    title: 'Browser Press',
    description:
      'Press a key or key combination. Targets a specific element by ref, or the currently focused element if no ref is provided. Handles Enter (submits forms), Tab (moves focus), Escape, arrow keys, and any single character. Requires CodeFire to be running with the browser tab visible.',
    inputSchema: z.object({
      key: z
        .string()
        .describe(
          'Key to press: Enter, Tab, Escape, Backspace, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Space, Delete, Home, End, PageUp, PageDown, or any single character'
        ),
      modifiers: z
        .array(z.enum(['shift', 'ctrl', 'alt', 'meta']))
        .optional()
        .describe("Modifier keys to hold (e.g. ['meta'] for Cmd+key on Mac)"),
      ref: z
        .string()
        .optional()
        .describe('Element ref to target (defaults to currently focused element)'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ key, modifiers, ref, tab_id }) => {
    const args: Record<string, unknown> = { key }
    if (ref) args.ref = ref
    if (modifiers) args.modifiers = modifiers
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_press', args)
    return textResult(result)
  }
)

// ── browser_eval ─────────────────────────────────────────────────────────

server.registerTool(
  'browser_eval',
  {
    title: 'Browser Eval',
    description:
      "Execute JavaScript on the page and return the result. The expression runs inside an async function body, so use 'return' to return values and 'await' for promises. Use for reading page state, calling APIs, or handling edge cases other tools can't cover. Requires CodeFire to be running with the browser tab visible.",
    inputSchema: z.object({
      expression: z
        .string()
        .describe(
          "JavaScript to evaluate. Use 'return' to return a value (e.g. 'return document.title')"
        ),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ expression, tab_id }) => {
    const args: Record<string, unknown> = { expression }
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_eval', args, 10.0)
    return textResult(result)
  }
)

// ── browser_hover ────────────────────────────────────────────────────────

server.registerTool(
  'browser_hover',
  {
    title: 'Browser Hover',
    description:
      'Hover over an element by ref. Dispatches mouseenter and mouseover events. Useful for dropdown menus, tooltips, and hover-state UI that requires mouse presence. Scrolls element into view first. Requires CodeFire to be running with the browser tab visible.',
    inputSchema: z.object({
      ref: z.string().describe('Element ref from browser_snapshot'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ ref, tab_id }) => {
    const args: Record<string, unknown> = { ref }
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_hover', args)
    return textResult(result)
  }
)

// ── browser_upload ───────────────────────────────────────────────────────

server.registerTool(
  'browser_upload',
  {
    title: 'Browser Upload',
    description:
      "Set a file on an <input type='file'> element. Reads the file from disk, encodes it, and assigns it to the input. Triggers change and input events. Requires CodeFire to be running with the browser tab visible.",
    inputSchema: z.object({
      ref: z
        .string()
        .describe('Element ref of the file input from browser_snapshot'),
      path: z
        .string()
        .describe(
          'Absolute path to the file on disk (must be within project directory)'
        ),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
      project_id: z
        .string()
        .optional()
        .describe('Project ID (auto-detected if omitted)'),
    }),
  },
  async ({ ref, path: filePath, tab_id, project_id }) => {
    // Resolve project path for validation
    let projectPath: string | null = null
    if (project_id) {
      const row = db
        .prepare('SELECT path FROM projects WHERE id = ?')
        .get(project_id) as { path: string } | undefined
      if (row) projectPath = row.path
    } else {
      const project = detectProject(db)
      if (project) projectPath = project.path
    }

    if (projectPath) {
      const resolvedFile = fs.realpathSync(filePath)
      const resolvedProject = fs.realpathSync(projectPath)
      if (
        !resolvedFile.startsWith(resolvedProject + '/') &&
        !resolvedFile.startsWith(resolvedProject + '\\')
      ) {
        throw new Error(
          `Upload path must be within the project directory. Got: ${filePath}`
        )
      }
    }

    const args: Record<string, unknown> = { ref, path: filePath }
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_upload', args, 10.0)
    return textResult(result)
  }
)

// ── browser_drag ─────────────────────────────────────────────────────────

server.registerTool(
  'browser_drag',
  {
    title: 'Browser Drag',
    description:
      'Drag an element to a target element using HTML5 drag and drop events. Dispatches the full drag event sequence: dragstart, drag, dragenter, dragover, drop, dragend. Requires CodeFire to be running with the browser tab visible.',
    inputSchema: z.object({
      from_ref: z.string().describe('Ref of the element to drag'),
      to_ref: z.string().describe('Ref of the drop target element'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ from_ref, to_ref, tab_id }) => {
    const args: Record<string, unknown> = { from_ref, to_ref }
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_drag', args)
    return textResult(result)
  }
)

// ── browser_iframe ───────────────────────────────────────────────────────

server.registerTool(
  'browser_iframe',
  {
    title: 'Browser Iframe',
    description:
      'Switch execution context to an iframe for subsequent commands (snapshot, click, type, etc.), or back to the main frame. Call with a ref to enter an iframe, or without ref to return to main frame. Only same-origin iframes are accessible. Use browser_snapshot to see available iframes. Requires CodeFire to be running with the browser tab visible.',
    inputSchema: z.object({
      ref: z
        .string()
        .optional()
        .describe(
          'Ref of the iframe element to enter. Omit to return to main frame.'
        ),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ ref, tab_id }) => {
    const args: Record<string, unknown> = {}
    if (ref) args.ref = ref
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_iframe', args)
    return textResult(result)
  }
)

// ── browser_clear_session ────────────────────────────────────────────────

server.registerTool(
  'browser_clear_session',
  {
    title: 'Browser Clear Session',
    description:
      'Clear browsing data (cookies, cache, localStorage). Useful for resetting login state, clearing cached data, or testing fresh page loads. Clears all data by default. Requires CodeFire to be running.',
    inputSchema: z.object({
      types: z
        .array(z.enum(['cookies', 'cache', 'localStorage', 'all']))
        .optional()
        .describe('Data types to clear. Defaults to all.'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ types, tab_id }) => {
    const args: Record<string, unknown> = {}
    if (types) args.types = types
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_clear_session', args, 10.0)
    return textResult(result)
  }
)

// ── browser_get_cookies ──────────────────────────────────────────────────

server.registerTool(
  'browser_get_cookies',
  {
    title: 'Browser Get Cookies',
    description:
      'Get cookies for the current page, including httpOnly cookies not visible to JavaScript. Useful for debugging authentication, session management, and tracking. Requires CodeFire browser.',
    inputSchema: z.object({
      domain: z
        .string()
        .optional()
        .describe("Filter cookies by domain substring (e.g. 'example.com')"),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ domain, tab_id }) => {
    const args: Record<string, unknown> = {}
    if (domain) args.domain = domain
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_get_cookies', args)
    return textResult(result)
  }
)

// ── browser_get_storage ──────────────────────────────────────────────────

server.registerTool(
  'browser_get_storage',
  {
    title: 'Browser Get Storage',
    description:
      'Read localStorage or sessionStorage contents. Returns item count, key-value pairs, and total size in bytes. Requires CodeFire browser.',
    inputSchema: z.object({
      type: z
        .enum(['localStorage', 'sessionStorage'])
        .describe('Which storage to read'),
      prefix: z
        .string()
        .optional()
        .describe('Only return keys starting with this prefix'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ type: storageType, prefix, tab_id }) => {
    const args: Record<string, unknown> = { type: storageType ?? 'localStorage' }
    if (prefix) args.prefix = prefix
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_get_storage', args)
    return textResult(result)
  }
)

// ── browser_set_cookie ───────────────────────────────────────────────────

server.registerTool(
  'browser_set_cookie',
  {
    title: 'Browser Set Cookie',
    description:
      'Set a cookie on the current page. Useful for testing auth flows, spoofing sessions, or setting feature flags. Requires CodeFire browser.',
    inputSchema: z.object({
      name: z.string().describe('Cookie name'),
      value: z.string().describe('Cookie value'),
      domain: z
        .string()
        .optional()
        .describe('Cookie domain (defaults to current page domain)'),
      path: z.string().optional().describe("Cookie path (defaults to '/')"),
      max_age: z.number().optional().describe('Max age in seconds'),
      secure: z.boolean().optional().describe('Secure flag'),
      same_site: z
        .enum(['Strict', 'Lax', 'None'])
        .optional()
        .describe('SameSite attribute'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ name, value, domain, path: cookiePath, max_age, secure, same_site, tab_id }) => {
    const args: Record<string, unknown> = { name, value }
    if (domain) args.domain = domain
    if (cookiePath) args.path = cookiePath
    if (max_age !== undefined) args.max_age = max_age
    if (secure !== undefined) args.secure = secure
    if (same_site) args.same_site = same_site
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_set_cookie', args)
    return textResult(result)
  }
)

// ── Git Operations ───────────────────────────────────────────────────────────

const GIT_TIMEOUT_MS = 30_000

async function runGit(projectPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', projectPath, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout
}

function resolveProjectPath(projectPath?: string): string {
  if (projectPath) return projectPath
  const project = detectProject(db)
  if (project) return project.path
  return process.cwd()
}

server.registerTool(
  'git_status',
  {
    title: 'Git Status',
    description: 'Get git status (branch, changed files, clean state) for a project',
    inputSchema: z.object({
      projectPath: z.string().optional().describe('Project path. Auto-detected from cwd if omitted.'),
    }),
  },
  async ({ projectPath }) => {
    const dir = resolveProjectPath(projectPath)
    const output = await runGit(dir, ['status', '--porcelain=v1', '-b'])
    const lines = output.split('\n').filter((l) => l.length > 0)
    let branch = ''
    const files: { status: string; path: string }[] = []

    for (const line of lines) {
      if (line.startsWith('## ')) {
        const branchPart = line.slice(3)
        if (branchPart.startsWith('No commits yet on ')) {
          branch = branchPart.replace('No commits yet on ', '')
        } else {
          const dotIdx = branchPart.indexOf('...')
          branch = dotIdx >= 0 ? branchPart.slice(0, dotIdx) : branchPart
        }
      } else {
        const statusCode = line.slice(0, 2).trim()
        const filePath = line.slice(3)
        if (statusCode && filePath) {
          files.push({ status: statusCode, path: filePath })
        }
      }
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify({ branch, files, isClean: files.length === 0 }, null, 2) }] }
  }
)

server.registerTool(
  'git_diff',
  {
    title: 'Git Diff',
    description: 'Get git diff output (unstaged by default, or staged with option)',
    inputSchema: z.object({
      projectPath: z.string().optional().describe('Project path. Auto-detected from cwd if omitted.'),
      staged: z.boolean().optional().describe('Show staged changes instead of unstaged'),
      file: z.string().optional().describe('Limit diff to a specific file'),
    }),
  },
  async ({ projectPath, staged, file }) => {
    const dir = resolveProjectPath(projectPath)
    const args = ['diff']
    if (staged) args.push('--staged')
    if (file) args.push('--', file)
    const output = await runGit(dir, args)
    return { content: [{ type: 'text' as const, text: output || '(no diff)' }] }
  }
)

server.registerTool(
  'git_log',
  {
    title: 'Git Log',
    description: 'Get recent commit log entries',
    inputSchema: z.object({
      projectPath: z.string().optional().describe('Project path. Auto-detected from cwd if omitted.'),
      limit: z.number().optional().describe('Max number of commits (default 20)'),
      file: z.string().optional().describe('Limit log to a specific file'),
    }),
  },
  async ({ projectPath, limit, file }) => {
    const dir = resolveProjectPath(projectPath)
    const sep = '---END---'
    const format = `%H%n%an%n%ae%n%at%n%s%n%b${sep}`
    const args = ['log', `--pretty=format:${format}`, '-n', String(limit ?? 20)]
    if (file) args.push('--', file)

    const output = await runGit(dir, args)
    if (!output.trim()) {
      return { content: [{ type: 'text' as const, text: '[]' }] }
    }

    const entries: { hash: string; author: string; email: string; date: string; subject: string; body: string }[] = []
    for (const raw of output.split(sep).filter((e) => e.trim())) {
      const lines = raw.split('\n')
      const start = lines.findIndex((l) => l.length > 0)
      if (start < 0) continue
      const m = lines.slice(start)
      if (m.length < 5) continue
      entries.push({
        hash: m[0],
        author: m[1],
        email: m[2],
        date: new Date(parseInt(m[3], 10) * 1000).toISOString(),
        subject: m[4],
        body: m.slice(5).join('\n').trim(),
      })
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }] }
  }
)

server.registerTool(
  'git_stage',
  {
    title: 'Git Stage',
    description: 'Stage files for commit (git add)',
    inputSchema: z.object({
      projectPath: z.string().optional().describe('Project path. Auto-detected from cwd if omitted.'),
      files: z.array(z.string()).describe('File paths to stage'),
    }),
  },
  async ({ projectPath, files }) => {
    const dir = resolveProjectPath(projectPath)
    if (files.length === 0) return { content: [{ type: 'text' as const, text: 'No files specified.' }] }
    await runGit(dir, ['add', ...files])
    return { content: [{ type: 'text' as const, text: `Staged ${files.length} file(s): ${files.join(', ')}` }] }
  }
)

server.registerTool(
  'git_unstage',
  {
    title: 'Git Unstage',
    description: 'Unstage files (git reset HEAD)',
    inputSchema: z.object({
      projectPath: z.string().optional().describe('Project path. Auto-detected from cwd if omitted.'),
      files: z.array(z.string()).describe('File paths to unstage'),
    }),
  },
  async ({ projectPath, files }) => {
    const dir = resolveProjectPath(projectPath)
    if (files.length === 0) return { content: [{ type: 'text' as const, text: 'No files specified.' }] }
    await runGit(dir, ['reset', 'HEAD', '--', ...files])
    return { content: [{ type: 'text' as const, text: `Unstaged ${files.length} file(s): ${files.join(', ')}` }] }
  }
)

server.registerTool(
  'git_commit',
  {
    title: 'Git Commit',
    description: 'Create a git commit with the given message',
    inputSchema: z.object({
      projectPath: z.string().optional().describe('Project path. Auto-detected from cwd if omitted.'),
      message: z.string().describe('Commit message'),
    }),
  },
  async ({ projectPath, message }) => {
    const dir = resolveProjectPath(projectPath)
    if (!message.trim()) return { content: [{ type: 'text' as const, text: 'Commit message cannot be empty.' }] }
    const output = await runGit(dir, ['commit', '-m', message])
    const match = output.match(/\[.+\s+([a-f0-9]+)\]/)
    const hash = match ? match[1] : '(unknown)'
    return { content: [{ type: 'text' as const, text: `Committed: ${hash}\n${output}` }] }
  }
)

// ── Delete Note ──────────────────────────────────────────────────────────────

server.registerTool(
  'delete_note',
  {
    title: 'Delete Note',
    description: 'Delete a note by ID',
    inputSchema: z.object({
      noteId: z.number().describe('Note ID to delete'),
    }),
  },
  async ({ noteId }) => {
    const existing = db.prepare('SELECT id, title FROM notes WHERE id = ?').get(noteId) as { id: number; title: string } | undefined
    if (!existing) {
      return { content: [{ type: 'text' as const, text: `Note ${noteId} not found.` }] }
    }
    db.prepare('DELETE FROM notes WHERE id = ?').run(noteId)
    return { content: [{ type: 'text' as const, text: `Deleted note ${noteId}: "${existing.title}"` }] }
  }
)

// ── Network Inspection ───────────────────────────────────────────────────────

server.registerTool(
  'browser_network_requests',
  {
    title: 'Browser Network Requests',
    description: 'Get recent network requests captured by the browser. Returns URLs, methods, status codes, and timing.',
    inputSchema: z.object({
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
      filter: z.string().optional().describe('Filter requests by URL substring'),
      limit: z.number().optional().describe('Max requests to return (default 50)'),
    }),
  },
  async ({ tab_id, filter, limit }) => {
    const args: Record<string, unknown> = {}
    if (tab_id) args.tab_id = tab_id
    if (filter) args.filter = filter
    if (limit) args.limit = limit
    const result = await executeBrowserCommand('browser_network_requests', args)
    return textResult(result)
  }
)

server.registerTool(
  'browser_network_clear',
  {
    title: 'Browser Clear Network Log',
    description: 'Clear the captured network request log',
    inputSchema: z.object({
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ tab_id }) => {
    const args: Record<string, unknown> = {}
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_network_clear', args)
    return textResult(result)
  }
)

server.registerTool(
  'browser_network_inspect',
  {
    title: 'Browser Inspect Network Request',
    description: 'Get full details (headers, body, response) of a specific network request by index',
    inputSchema: z.object({
      index: z.number().describe('Request index from the network log'),
      tab_id: z.string().optional().describe('Tab ID (defaults to active tab)'),
    }),
  },
  async ({ index, tab_id }) => {
    const args: Record<string, unknown> = { index }
    if (tab_id) args.tab_id = tab_id
    const result = await executeBrowserCommand('browser_network_inspect', args)
    return textResult(result)
  }
)

// ── Environment Detection ────────────────────────────────────────────────────

server.registerTool(
  'detect_ai_agents',
  {
    title: 'Detect AI Agents',
    description: 'Detect installed AI coding agents (Claude Code, Gemini CLI, Codex CLI, OpenCode, etc.)',
    inputSchema: z.object({}),
  },
  async () => {
    const agents = [
      { name: 'Claude Code', commands: ['claude'] },
      { name: 'Gemini CLI', commands: ['gemini'] },
      { name: 'Codex CLI', commands: ['codex'] },
      { name: 'OpenCode', commands: ['opencode'] },
      { name: 'Aider', commands: ['aider'] },
      { name: 'Cursor', commands: ['cursor'] },
    ]

    const results: { name: string; installed: boolean; version: string | null }[] = []

    for (const agent of agents) {
      let found = false
      let version: string | null = null
      for (const cmd of agent.commands) {
        try {
          const { stdout } = await execFileAsync(cmd, ['--version'], { timeout: 5000 })
          found = true
          version = stdout.trim().split('\n')[0]
          break
        } catch {
          // not found
        }
      }
      results.push({ name: agent.name, installed: found, version })
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] }
  }
)

server.registerTool(
  'detect_dev_environment',
  {
    title: 'Detect Dev Environment',
    description: 'Detect development tools and runtimes (Node.js, Python, git, Docker, etc.)',
    inputSchema: z.object({}),
  },
  async () => {
    const tools = [
      { name: 'Node.js', cmd: 'node', args: ['--version'] },
      { name: 'npm', cmd: 'npm', args: ['--version'] },
      { name: 'Python', cmd: 'python3', args: ['--version'] },
      { name: 'git', cmd: 'git', args: ['--version'] },
      { name: 'Docker', cmd: 'docker', args: ['--version'] },
      { name: 'bun', cmd: 'bun', args: ['--version'] },
      { name: 'pnpm', cmd: 'pnpm', args: ['--version'] },
      { name: 'yarn', cmd: 'yarn', args: ['--version'] },
      { name: 'cargo', cmd: 'cargo', args: ['--version'] },
      { name: 'go', cmd: 'go', args: ['version'] },
    ]

    const results: { name: string; installed: boolean; version: string | null }[] = []

    for (const tool of tools) {
      try {
        const { stdout } = await execFileAsync(tool.cmd, tool.args, { timeout: 5000 })
        results.push({ name: tool.name, installed: true, version: stdout.trim().split('\n')[0] })
      } catch {
        results.push({ name: tool.name, installed: false, version: null })
      }
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] }
  }
)

server.registerTool(
  'detect_project_stack',
  {
    title: 'Detect Project Stack',
    description: 'Detect the technology stack of the current project by checking for config files',
    inputSchema: z.object({
      projectPath: z.string().optional().describe('Project path. Auto-detected from cwd if omitted.'),
    }),
  },
  async ({ projectPath }) => {
    const dir = resolveProjectPath(projectPath)
    const indicators: { technology: string; files: string[] }[] = [
      { technology: 'Node.js', files: ['package.json'] },
      { technology: 'TypeScript', files: ['tsconfig.json'] },
      { technology: 'React', files: ['node_modules/react/package.json'] },
      { technology: 'Next.js', files: ['next.config.js', 'next.config.mjs', 'next.config.ts'] },
      { technology: 'Vite', files: ['vite.config.ts', 'vite.config.js'] },
      { technology: 'Python', files: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'] },
      { technology: 'Rust', files: ['Cargo.toml'] },
      { technology: 'Go', files: ['go.mod'] },
      { technology: 'Docker', files: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'] },
      { technology: 'Swift', files: ['Package.swift'] },
      { technology: 'Flutter', files: ['pubspec.yaml'] },
      { technology: 'Tailwind CSS', files: ['tailwind.config.js', 'tailwind.config.ts'] },
      { technology: '.NET', files: ['*.csproj', '*.sln'] },
      { technology: 'Java', files: ['pom.xml', 'build.gradle'] },
    ]

    const detected: { technology: string; matchedFile: string }[] = []

    for (const ind of indicators) {
      for (const file of ind.files) {
        const fullPath = path.join(dir, file)
        if (fs.existsSync(fullPath)) {
          detected.push({ technology: ind.technology, matchedFile: file })
          break
        }
      }
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify({ projectPath: dir, stack: detected }, null, 2) }] }
  }
)

// ── Image Tools ──────────────────────────────────────────────────────────────

server.registerTool(
  'get_image',
  {
    title: 'Get Image',
    description: 'Get a generated image by ID, including metadata and file path',
    inputSchema: z.object({
      imageId: z.number().describe('Image ID'),
    }),
  },
  async ({ imageId }) => {
    const image = db.prepare('SELECT * FROM generatedImages WHERE id = ?').get(imageId)
    if (!image) {
      return { content: [{ type: 'text' as const, text: `Image ${imageId} not found.` }] }
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(image, null, 2) }] }
  }
)

server.registerTool(
  'generate_image',
  {
    title: 'Generate Image',
    description: 'Generate an image using AI (requires OpenRouter API key in CodeFire settings). Returns the saved image record.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID to associate the image with'),
      prompt: z.string().describe('Image generation prompt'),
      apiKey: z.string().describe('OpenRouter API key'),
      aspectRatio: z.string().optional().describe("Aspect ratio (default '1:1'). Options: '1:1', '16:9', '9:16', '4:3', '3:4'"),
      imageSize: z.string().optional().describe("Image size (default '1K'). Options: '1K', '2K'"),
    }),
  },
  async ({ projectId, prompt, apiKey, aspectRatio, imageSize }) => {
    if (!apiKey) {
      return { content: [{ type: 'text' as const, text: 'Error: OpenRouter API key is required.' }] }
    }

    const model = 'google/gemini-3.1-flash-image-preview'
    const endpoint = 'https://openrouter.ai/api/v1/chat/completions'

    const body = JSON.stringify({
      model,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      image_config: {
        aspect_ratio: aspectRatio ?? '1:1',
        image_size: imageSize ?? '1K',
      },
    })

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'CodeFire',
      },
      body,
    })

    if (!response.ok) {
      const text = await response.text()
      return { content: [{ type: 'text' as const, text: `HTTP ${response.status}: ${text.substring(0, 300)}` }] }
    }

    const json = await response.json() as Record<string, unknown>

    if ((json.error as Record<string, unknown>)?.message) {
      return { content: [{ type: 'text' as const, text: `API Error: ${(json.error as Record<string, unknown>).message}` }] }
    }

    const choices = json.choices as { message: Record<string, unknown> }[] | undefined
    const message = choices?.[0]?.message
    if (!message) {
      return { content: [{ type: 'text' as const, text: 'Unexpected response format — no message.' }] }
    }

    // Extract text
    let responseText: string | null = null
    if (typeof message.content === 'string') {
      responseText = message.content
    } else if (Array.isArray(message.content)) {
      for (const part of message.content as { type: string; text?: string }[]) {
        if (part.type === 'text' && part.text) {
          responseText = part.text
          break
        }
      }
    }

    // Extract image
    let imageBase64: string | null = null
    if (Array.isArray(message.images)) {
      for (const img of message.images as { image_url?: { url?: string } }[]) {
        const url = img.image_url?.url
        if (url) {
          const commaIdx = url.indexOf(',')
          if (commaIdx !== -1) { imageBase64 = url.substring(commaIdx + 1); break }
        }
      }
    }
    if (!imageBase64 && Array.isArray(message.content)) {
      for (const part of message.content as { type: string; image_url?: { url?: string } }[]) {
        if (part.type === 'image_url') {
          const url = part.image_url?.url
          if (url) {
            const commaIdx = url.indexOf(',')
            if (commaIdx !== -1) { imageBase64 = url.substring(commaIdx + 1); break }
          }
        }
      }
    }

    if (!imageBase64) {
      return { content: [{ type: 'text' as const, text: responseText ?? 'No image returned by the model.' }] }
    }

    // Save image to disk
    const dbDir = path.dirname(getDatabasePath())
    const imagesDir = path.join(dbDir, 'generated-images')
    fs.mkdirSync(imagesDir, { recursive: true })
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`
    const filePath = path.join(imagesDir, fileName)
    fs.writeFileSync(filePath, Buffer.from(imageBase64, 'base64'))

    // Insert into database
    const now = new Date().toISOString()
    const result = db.prepare(
      'INSERT INTO generatedImages (projectId, prompt, responseText, filePath, model, aspectRatio, imageSize, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(projectId, prompt, responseText, filePath, model, aspectRatio ?? '1:1', imageSize ?? '1K', now)

    const image = db.prepare('SELECT * FROM generatedImages WHERE id = ?').get(result.lastInsertRowid)
    return { content: [{ type: 'text' as const, text: JSON.stringify(image, null, 2) }] }
  }
)

server.registerTool(
  'edit_image',
  {
    title: 'Edit Image',
    description: 'Edit an existing image with an AI prompt (sends original + edit instruction). Requires OpenRouter API key.',
    inputSchema: z.object({
      imageId: z.number().describe('ID of the image to edit'),
      prompt: z.string().describe('Edit instruction (e.g. "make the background blue")'),
      apiKey: z.string().describe('OpenRouter API key'),
      aspectRatio: z.string().optional().describe("Aspect ratio (default: same as original)"),
      imageSize: z.string().optional().describe("Image size (default: same as original)"),
    }),
  },
  async ({ imageId, prompt, apiKey, aspectRatio, imageSize }) => {
    const original = db.prepare('SELECT * FROM generatedImages WHERE id = ?').get(imageId) as Record<string, unknown> | undefined
    if (!original) {
      return { content: [{ type: 'text' as const, text: `Image ${imageId} not found.` }] }
    }

    const originalPath = original.filePath as string
    if (!fs.existsSync(originalPath)) {
      return { content: [{ type: 'text' as const, text: `Original image file not found at ${originalPath}` }] }
    }

    const imageData = fs.readFileSync(originalPath).toString('base64')
    const model = 'google/gemini-3.1-flash-image-preview'
    const endpoint = 'https://openrouter.ai/api/v1/chat/completions'

    const body = JSON.stringify({
      model,
      modalities: ['image', 'text'],
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageData}` } },
          { type: 'text', text: prompt },
        ],
      }],
      image_config: {
        aspect_ratio: aspectRatio ?? (original.aspectRatio as string) ?? '1:1',
        image_size: imageSize ?? (original.imageSize as string) ?? '1K',
      },
    })

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'CodeFire',
      },
      body,
    })

    if (!response.ok) {
      const text = await response.text()
      return { content: [{ type: 'text' as const, text: `HTTP ${response.status}: ${text.substring(0, 300)}` }] }
    }

    const json = await response.json() as Record<string, unknown>
    const choices = json.choices as { message: Record<string, unknown> }[] | undefined
    const message = choices?.[0]?.message

    if (!message) {
      return { content: [{ type: 'text' as const, text: 'Unexpected response format.' }] }
    }

    // Extract response text
    let responseText: string | null = null
    if (typeof message.content === 'string') {
      responseText = message.content
    } else if (Array.isArray(message.content)) {
      for (const part of message.content as { type: string; text?: string }[]) {
        if (part.type === 'text' && part.text) { responseText = part.text; break }
      }
    }

    // Extract image
    let newImageBase64: string | null = null
    if (Array.isArray(message.images)) {
      for (const img of message.images as { image_url?: { url?: string } }[]) {
        const url = img.image_url?.url
        if (url) {
          const commaIdx = url.indexOf(',')
          if (commaIdx !== -1) { newImageBase64 = url.substring(commaIdx + 1); break }
        }
      }
    }
    if (!newImageBase64 && Array.isArray(message.content)) {
      for (const part of message.content as { type: string; image_url?: { url?: string } }[]) {
        if (part.type === 'image_url') {
          const url = part.image_url?.url
          if (url) {
            const commaIdx = url.indexOf(',')
            if (commaIdx !== -1) { newImageBase64 = url.substring(commaIdx + 1); break }
          }
        }
      }
    }

    if (!newImageBase64) {
      return { content: [{ type: 'text' as const, text: responseText ?? 'No edited image returned.' }] }
    }

    // Save edited image
    const dbDir = path.dirname(getDatabasePath())
    const imagesDir = path.join(dbDir, 'generated-images')
    fs.mkdirSync(imagesDir, { recursive: true })
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`
    const filePath = path.join(imagesDir, fileName)
    fs.writeFileSync(filePath, Buffer.from(newImageBase64, 'base64'))

    const now = new Date().toISOString()
    const ar = aspectRatio ?? (original.aspectRatio as string) ?? '1:1'
    const is = imageSize ?? (original.imageSize as string) ?? '1K'
    const result = db.prepare(
      'INSERT INTO generatedImages (projectId, prompt, responseText, filePath, model, aspectRatio, imageSize, parentImageId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(original.projectId, prompt, responseText, filePath, model, ar, is, imageId, now)

    const image = db.prepare('SELECT * FROM generatedImages WHERE id = ?').get(result.lastInsertRowid)
    return { content: [{ type: 'text' as const, text: JSON.stringify(image, null, 2) }] }
  }
)

// ── Semantic / Hybrid Search ─────────────────────────────────────────────────

server.registerTool(
  'context_search',
  {
    title: 'Context Search',
    description: 'Hybrid search across notes, tasks, sessions, and code. Combines FTS5 full-text search across multiple tables for comprehensive results.',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      projectId: z.string().optional().describe('Limit to a specific project'),
      scope: z.enum(['all', 'notes', 'tasks', 'sessions', 'code']).optional().describe("Search scope (default 'all')"),
      limit: z.number().optional().describe('Max results per category (default 5)'),
    }),
  },
  async ({ query, projectId, scope, limit }) => {
    const maxResults = limit ?? 5
    const searchScope = scope ?? 'all'
    const results: Record<string, unknown[]> = {}

    // Notes (FTS5)
    if (searchScope === 'all' || searchScope === 'notes') {
      try {
        const noteRows = projectId
          ? db.prepare(
              `SELECT notes.*, rank FROM notes JOIN notesFts ON notes.id = notesFts.rowid
               WHERE notesFts MATCH ? AND notes.projectId = ? ORDER BY rank LIMIT ?`
            ).all(query, projectId, maxResults)
          : db.prepare(
              `SELECT notes.*, rank FROM notes JOIN notesFts ON notes.id = notesFts.rowid
               WHERE notesFts MATCH ? ORDER BY rank LIMIT ?`
            ).all(query, maxResults)
        results.notes = noteRows
      } catch { results.notes = [] }
    }

    // Tasks (FTS on title/description)
    if (searchScope === 'all' || searchScope === 'tasks') {
      try {
        const taskRows = projectId
          ? db.prepare(
              `SELECT * FROM taskItems WHERE projectId = ? AND (title LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%') ORDER BY updatedAt DESC LIMIT ?`
            ).all(projectId, query, query, maxResults)
          : db.prepare(
              `SELECT * FROM taskItems WHERE title LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%' ORDER BY updatedAt DESC LIMIT ?`
            ).all(query, query, maxResults)
        results.tasks = taskRows
      } catch { results.tasks = [] }
    }

    // Sessions (LIKE search on rawContent/summary)
    if (searchScope === 'all' || searchScope === 'sessions') {
      try {
        const sessionRows = projectId
          ? db.prepare(
              `SELECT id, projectId, agent, model, startedAt, endedAt, inputTokens, outputTokens, totalCost
               FROM sessions WHERE projectId = ? AND (rawContent LIKE '%' || ? || '%' OR summary LIKE '%' || ? || '%')
               ORDER BY startedAt DESC LIMIT ?`
            ).all(projectId, query, query, maxResults)
          : db.prepare(
              `SELECT id, projectId, agent, model, startedAt, endedAt, inputTokens, outputTokens, totalCost
               FROM sessions WHERE rawContent LIKE '%' || ? || '%' OR summary LIKE '%' || ? || '%'
               ORDER BY startedAt DESC LIMIT ?`
            ).all(query, query, maxResults)
        results.sessions = sessionRows
      } catch { results.sessions = [] }
    }

    // Code (FTS5 on codeChunks)
    if (searchScope === 'all' || searchScope === 'code') {
      try {
        const codeRows = projectId
          ? db.prepare(
              `SELECT codeChunks.*, bm25(codeChunksFts) AS score FROM codeChunks
               JOIN codeChunksFts ON codeChunks.id = codeChunksFts.rowid
               WHERE codeChunksFts MATCH ? AND codeChunks.projectId = ?
               ORDER BY score LIMIT ?`
            ).all(query, projectId, maxResults)
          : db.prepare(
              `SELECT codeChunks.*, bm25(codeChunksFts) AS score FROM codeChunks
               JOIN codeChunksFts ON codeChunks.id = codeChunksFts.rowid
               WHERE codeChunksFts MATCH ? ORDER BY score LIMIT ?`
            ).all(query, maxResults)
        results.code = codeRows
      } catch { results.code = [] }
    }

    const totalHits = Object.values(results).reduce((sum, arr) => sum + arr.length, 0)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ totalHits, results }, null, 2) }] }
  }
)

// ── Environment Detection ────────────────────────────────────────────────────

server.registerTool(
  'get_system_info',
  {
    title: 'Get System Info',
    description: 'Returns system information: OS, platform, architecture, hostname, home directory, Node version.',
    inputSchema: z.object({}),
  },
  async () => {
    const info = {
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      homeDir: os.homedir(),
      nodeVersion: process.version,
      osType: os.type(),
      osRelease: os.release(),
      cpus: os.cpus().length,
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] }
  }
)

server.registerTool(
  'detect_coding_agents',
  {
    title: 'Detect Coding Agents',
    description: 'Detects which AI coding agents/CLIs are installed on the system (Claude Code, Gemini CLI, Codex CLI, Aider, etc.).',
    inputSchema: z.object({}),
  },
  async () => {
    const agents = [
      { name: 'Claude Code', commands: ['claude'] },
      { name: 'Gemini CLI', commands: ['gemini'] },
      { name: 'Codex CLI', commands: ['codex'] },
      { name: 'Aider', commands: ['aider'] },
      { name: 'OpenCode', commands: ['opencode'] },
      { name: 'GitHub Copilot CLI', commands: ['gh copilot'] },
    ]

    const results: { name: string; installed: boolean; version?: string }[] = []
    const which = process.platform === 'win32' ? 'where' : 'which'

    for (const agent of agents) {
      let installed = false
      let version: string | undefined
      for (const cmd of agent.commands) {
        try {
          await execFileAsync(which, [cmd.split(' ')[0]], { timeout: 3000 })
          installed = true
          try {
            const { stdout } = await execFileAsync(cmd.split(' ')[0], ['--version'], { timeout: 5000 })
            version = stdout.trim().split('\n')[0]
          } catch {}
          break
        } catch {}
      }
      results.push({ name: agent.name, installed, version })
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] }
  }
)

server.registerTool(
  'get_project_environment',
  {
    title: 'Get Project Environment',
    description: 'Detects the development environment for a project: package manager, language, framework, git status.',
    inputSchema: z.object({
      projectPath: z.string().describe('Absolute path to the project directory'),
    }),
  },
  async ({ projectPath }) => {
    const env: Record<string, unknown> = { path: projectPath }

    // Detect package manager & language
    const markers: [string, string, string][] = [
      ['package.json', 'Node.js', 'npm'],
      ['yarn.lock', 'Node.js', 'yarn'],
      ['pnpm-lock.yaml', 'Node.js', 'pnpm'],
      ['bun.lockb', 'Node.js', 'bun'],
      ['Cargo.toml', 'Rust', 'cargo'],
      ['go.mod', 'Go', 'go'],
      ['pyproject.toml', 'Python', 'pip/poetry'],
      ['requirements.txt', 'Python', 'pip'],
      ['Gemfile', 'Ruby', 'bundler'],
      ['Package.swift', 'Swift', 'swift'],
      ['build.gradle', 'Java/Kotlin', 'gradle'],
      ['pom.xml', 'Java', 'maven'],
      ['pubspec.yaml', 'Dart/Flutter', 'pub'],
    ]

    const detected: { file: string; language: string; packageManager: string }[] = []
    for (const [file, lang, pm] of markers) {
      if (fs.existsSync(path.join(projectPath, file))) {
        detected.push({ file, language: lang, packageManager: pm })
      }
    }
    env.detected = detected
    env.languages = [...new Set(detected.map((d) => d.language))]

    // Git info
    try {
      const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectPath, timeout: 3000 })
      env.gitBranch = branch.trim()
      const { stdout: remote } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: projectPath, timeout: 3000 })
      env.gitRemote = remote.trim()
    } catch {}

    return { content: [{ type: 'text' as const, text: JSON.stringify(env, null, 2) }] }
  }
)

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const connFile = writeConnectionFile()

  const cleanup = () => {
    removeConnectionFile()
    db.close()
    process.exit(0)
  }

  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Log to stderr (stdout is reserved for MCP protocol)
  process.stderr.write(`CodeFire MCP server started (pid ${process.pid}, connection file: ${connFile})\n`)
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`)
  removeConnectionFile()
  db.close()
  process.exit(1)
})

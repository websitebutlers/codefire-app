import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Loader2, Plus, ChevronDown, Trash2, Copy, ListTodo, StickyNote, Terminal, Flame, Zap, BookOpen, Wrench } from 'lucide-react'
import type { ChatConversation, ChatMessage, Session } from '@shared/models'
import { api } from '@renderer/lib/api'

// ─── Types ───────────────────────────────────────────────────────────────────

type ChatMode = 'context' | 'agent'

interface CodeFireChatProps {
  projectId?: string
  projectName?: string
}

interface ToolCall {
  id: string
  function: { name: string; arguments: string }
}

interface ToolExecution {
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'running' | 'done' | 'error'
}

// ─── Agent Tool Definitions ──────────────────────────────────────────────────

const AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_tasks',
      description: 'List tasks for the current project or globally. Returns task title, status, priority, and labels.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status: todo, in_progress, done, blocked. Omit for all.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_task',
      description: 'Create a new task in the current project.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Task description' },
          priority: { type: 'number', description: '0=none, 1=low, 2=medium, 3=high, 4=urgent' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Labels like bug, feature, refactor' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_task',
      description: 'Update an existing task by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Task ID' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', description: 'todo, in_progress, done, blocked' },
          priority: { type: 'number' },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_code',
      description: 'Search the project codebase using semantic/hybrid search. Returns matching code chunks with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_notes',
      description: 'List notes for the current project.',
      parameters: {
        type: 'object',
        properties: {
          pinned_only: { type: 'boolean', description: 'Only return pinned notes' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_note',
      description: 'Create a new note in the current project.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Note title' },
          content: { type: 'string', description: 'Note content (markdown)' },
          pinned: { type: 'boolean', description: 'Pin this note' },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_notes',
      description: 'Search notes by keyword.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_sessions',
      description: 'List recent coding sessions for this project. Shows session summaries, dates, models used.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_sessions',
      description: 'Search coding sessions by keyword.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_status',
      description: 'Get git status for the project (branch, changed files).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_log',
      description: 'Get recent git commits.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of commits (default 10)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_diff',
      description: 'Get git diff (staged or unstaged changes).',
      parameters: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: 'Show staged changes only' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_projects',
      description: 'List all CodeFire-tracked projects.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'browser_navigate',
      description: 'Navigate the CodeFire browser to a URL. Use this to look up documentation, APIs, or web content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the project.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_files',
      description: 'List files and directories at a given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' },
        },
        required: ['path'],
      },
    },
  },
]

// ─── Tool Executor ───────────────────────────────────────────────────────────

async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  projectId: string | undefined,
  projectPath: string | undefined
): Promise<string> {
  try {
    switch (name) {
      case 'list_tasks': {
        const tasks = projectId
          ? await api.tasks.list(projectId, args.status as string | undefined)
          : await api.tasks.listGlobal(args.status as string | undefined)
        return JSON.stringify(tasks.slice(0, 30).map(t => ({
          id: t.id, title: t.title, status: t.status,
          priority: t.priority, labels: t.labels,
          description: t.description?.slice(0, 200),
        })), null, 2)
      }
      case 'create_task': {
        const task = await api.tasks.create({
          projectId: projectId || '__global__',
          title: args.title as string,
          description: args.description as string | undefined,
          priority: args.priority as number | undefined,
          labels: args.labels as string[] | undefined,
          isGlobal: !projectId,
        })
        return JSON.stringify({ success: true, id: task.id, title: task.title })
      }
      case 'update_task': {
        const { id, ...updates } = args
        const task = await api.tasks.update(id as number, updates)
        return task ? JSON.stringify({ success: true, id: task.id, title: task.title, status: task.status })
          : JSON.stringify({ error: 'Task not found' })
      }
      case 'search_code': {
        if (!projectId) return JSON.stringify({ error: 'No project selected' })
        const results = await api.search.query(projectId, args.query as string, {
          limit: (args.limit as number) || 5,
        })
        return JSON.stringify(results.map(r => ({
          file: r.filePath, symbol: r.symbolName, type: r.chunkType,
          lines: r.startLine && r.endLine ? `${r.startLine}-${r.endLine}` : null,
          content: r.content.slice(0, 500), score: r.score.toFixed(3),
        })), null, 2)
      }
      case 'list_notes': {
        if (!projectId) return JSON.stringify({ error: 'No project selected' })
        const notes = await api.notes.list(projectId, args.pinned_only as boolean | undefined)
        return JSON.stringify(notes.slice(0, 20).map(n => ({
          id: n.id, title: n.title, pinned: n.pinned,
          content: n.content.slice(0, 300),
          updatedAt: n.updatedAt,
        })), null, 2)
      }
      case 'create_note': {
        const note = await api.notes.create({
          projectId: projectId || '__global__',
          title: args.title as string,
          content: args.content as string,
          pinned: args.pinned as boolean | undefined,
          isGlobal: !projectId,
        })
        return JSON.stringify({ success: true, id: note.id, title: note.title })
      }
      case 'search_notes': {
        if (!projectId) return JSON.stringify({ error: 'No project selected' })
        const notes = await api.notes.search(projectId, args.query as string)
        return JSON.stringify(notes.slice(0, 10).map(n => ({
          id: n.id, title: n.title,
          content: n.content.slice(0, 300),
        })), null, 2)
      }
      case 'list_sessions': {
        if (!projectId) return JSON.stringify({ error: 'No project selected' })
        const sessions = await api.sessions.list(projectId)
        return JSON.stringify(sessions.slice(0, 15).map(s => ({
          id: s.id, summary: s.summary?.slice(0, 200),
          startedAt: s.startedAt, model: s.model,
          messageCount: s.messageCount,
        })), null, 2)
      }
      case 'search_sessions': {
        const sessions = await api.sessions.search(args.query as string)
        return JSON.stringify(sessions.slice(0, 10).map(s => ({
          id: s.id, summary: s.summary?.slice(0, 200),
          startedAt: s.startedAt, model: s.model,
        })), null, 2)
      }
      case 'git_status': {
        if (!projectPath) return JSON.stringify({ error: 'No project path' })
        return JSON.stringify(await api.git.status(projectPath))
      }
      case 'git_log': {
        if (!projectPath) return JSON.stringify({ error: 'No project path' })
        const log = await api.git.log(projectPath, { limit: (args.limit as number) || 10 })
        return JSON.stringify(log, null, 2)
      }
      case 'git_diff': {
        if (!projectPath) return JSON.stringify({ error: 'No project path' })
        const diff = await api.git.diff(projectPath, { staged: args.staged as boolean | undefined })
        return diff.slice(0, 5000) || '(no changes)'
      }
      case 'list_projects': {
        const projects = await api.projects.list()
        return JSON.stringify(projects.map(p => ({
          id: p.id, name: p.name, path: p.path,
          lastOpened: p.lastOpened,
        })), null, 2)
      }
      case 'browser_navigate': {
        // Browser commands are executed by inserting into browserCommands table
        // which the BrowserView component polls. Use the chat:browserCommand IPC.
        try {
          await window.api.invoke('chat:browserCommand', 'browser_navigate', JSON.stringify({ url: args.url }))
          return JSON.stringify({ success: true, navigating_to: args.url })
        } catch {
          return JSON.stringify({ info: 'Browser navigation requested. Open the Browser tab in CodeFire to see the result.', url: args.url })
        }
      }
      case 'read_file': {
        const content = await api.files.read(args.path as string)
        return content.slice(0, 8000)
      }
      case 'list_files': {
        const files = await api.files.list(args.path as string)
        return JSON.stringify(files.map(f => ({
          name: f.name, isDirectory: f.isDirectory, size: f.size,
        })), null, 2)
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
  }
}

// ─── Context Builder (Mode 1 — matches Swift ContextAssembler) ───────────────

async function buildContextWithRAG(
  projectId: string | undefined,
  projectName: string,
  userQuery: string,
  isGlobal: boolean
): Promise<string> {
  if (isGlobal) return buildGlobalContext()

  const MAX_CHARS = 12000
  let context = `You are a helpful assistant with deep context about the "${projectName}" project.\n`
  context += `Answer questions about this project's tasks, sessions, notes, architecture, and codebase.\n\n`
  let budget = MAX_CHARS - context.length

  // RAG: search code chunks matching the query
  if (projectId) {
    try {
      const results = await api.search.query(projectId, userQuery, { limit: 5 })
      if (results.length > 0) {
        let section = 'RELEVANT CODE (matching your question):\n'
        for (const r of results) {
          const lines = r.startLine && r.endLine ? `${r.startLine}-${r.endLine}` : ''
          const location = lines ? `${r.filePath}:${lines}` : (r.filePath || 'unknown')
          const symbol = r.symbolName ? ` (${r.symbolName})` : ''
          section += `--- ${location}${symbol} ---\n${r.content.slice(0, 500)}\n\n`
        }
        if (section.length < budget) {
          context += section
          budget -= section.length
        }
      }
    } catch { /* index may not be ready */ }
  }

  // Active tasks
  if (projectId) {
    try {
      const tasks = await api.tasks.list(projectId)
      const active = tasks.filter(t => t.status !== 'done').slice(0, 20)
      if (active.length > 0) {
        let section = `ACTIVE TASKS (${active.length}):\n`
        for (const t of active) {
          const labels = t.labels ? JSON.parse(t.labels).join(', ') : ''
          const desc = t.description ? ` — ${t.description.slice(0, 120)}` : ''
          section += `- [${t.status}] P${t.priority} "${t.title}"${desc}${labels ? ` (${labels})` : ''}\n`
        }
        section += '\n'
        if (section.length < budget) {
          context += section
          budget -= section.length
        }
      }
    } catch { /* ignore */ }
  }

  // Pinned notes (full content)
  if (projectId) {
    try {
      const notes = await api.notes.list(projectId, true)
      if (notes.length > 0) {
        let section = 'PINNED NOTES:\n'
        for (const n of notes.slice(0, 5)) {
          section += `## ${n.title}\n${n.content.slice(0, 500)}\n\n`
        }
        if (section.length < budget) {
          context += section
          budget -= section.length
        }
      }
    } catch { /* ignore */ }
  }

  // Recent sessions
  if (projectId) {
    try {
      const sessions = await api.sessions.list(projectId)
      const recent = sessions.slice(0, 5)
      if (recent.length > 0) {
        let section = 'RECENT SESSIONS:\n'
        for (const s of recent) {
          const date = s.startedAt ? new Date(s.startedAt).toLocaleDateString() : '?'
          const summary = s.summary ? s.summary.slice(0, 150) : 'No summary'
          section += `- ${date}: "${summary}" (${s.model || 'unknown'})\n`
        }
        section += '\n'
        if (section.length < budget) {
          context += section
          budget -= section.length
        }
      }
    } catch { /* ignore */ }
  }

  // Recent notes (titles only)
  if (projectId) {
    try {
      const notes = await api.notes.list(projectId)
      const recent = notes.slice(0, 10)
      if (recent.length > 0) {
        let section = 'RECENT NOTES:\n'
        for (const n of recent) {
          section += `- "${n.title}"\n`
        }
        if (section.length < budget) {
          context += section
        }
      }
    } catch { /* ignore */ }
  }

  context += '\nRespond helpfully and concisely. Reference specific tasks, sessions, files, or notes when relevant. Use markdown formatting.'
  return context
}

async function buildGlobalContext(): Promise<string> {
  let context = 'You are a helpful assistant integrated into CodeFire, a project management companion for AI coding agents.\n'
  context += 'You have context about all projects, global tasks, and notes.\n\n'
  let budget = 8000 - context.length

  try {
    const projects = await api.projects.list()
    if (projects.length > 0) {
      let section = `PROJECTS (${projects.length}):\n`
      for (const p of projects.slice(0, 20)) {
        const lastOpened = p.lastOpened ? new Date(p.lastOpened).toLocaleDateString() : 'never'
        section += `- "${p.name}" (last opened: ${lastOpened})\n`
      }
      section += '\n'
      if (section.length < budget) {
        context += section
        budget -= section.length
      }
    }
  } catch { /* ignore */ }

  try {
    const tasks = await api.tasks.listGlobal()
    const active = tasks.filter(t => t.status !== 'done').slice(0, 15)
    if (active.length > 0) {
      let section = 'GLOBAL TASKS:\n'
      for (const t of active) {
        section += `- [${t.status}] P${t.priority} "${t.title}"\n`
      }
      section += '\n'
      if (section.length < budget) {
        context += section
      }
    }
  } catch { /* ignore */ }

  context += '\nRespond helpfully and concisely. Use markdown formatting.'
  return context
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CodeFireChat({ projectId, projectName = 'All Projects' }: CodeFireChatProps) {
  const isGlobal = !projectId
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [chatMode, setChatMode] = useState<ChatMode>('context')
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([])
  const [projectPath, setProjectPath] = useState<string | undefined>()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  // Load config for chatMode
  useEffect(() => {
    window.api.invoke('settings:get').then((config: any) => {
      if (config?.chatMode) setChatMode(config.chatMode)
    })
  }, [])

  // Load project path
  useEffect(() => {
    if (projectId) {
      api.projects.get(projectId).then(p => setProjectPath(p?.path))
    }
  }, [projectId])

  // Load conversations and sessions
  const loadConversations = useCallback(async () => {
    const list = await api.chat.listConversations(projectId || '__global__')
    setConversations(list)
    return list
  }, [projectId])

  const loadSessions = useCallback(async () => {
    if (!projectId) { setSessions([]); return }
    const list = await api.sessions.list(projectId)
    setSessions(list)
  }, [projectId])

  useEffect(() => {
    loadConversations().then((list) => {
      if (list.length > 0) setActiveConversationId(list[0].id)
    })
    loadSessions()
  }, [loadConversations, loadSessions])

  useEffect(() => {
    if (activeConversationId) {
      api.chat.listMessages(activeConversationId).then(setMessages)
    } else {
      setMessages([])
    }
  }, [activeConversationId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamedContent, toolExecutions])

  useEffect(() => {
    inputRef.current?.focus()
  }, [activeConversationId])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showDropdown])

  async function handleNewConversation() {
    const conv = await api.chat.createConversation({
      projectId: projectId || '__global__',
      title: 'New Chat',
    })
    setConversations((prev) => [conv, ...prev])
    setActiveConversationId(conv.id)
    setMessages([])
    setShowDropdown(false)
  }

  async function handleDeleteConversation(id: number, e: React.MouseEvent) {
    e.stopPropagation()
    await api.chat.deleteConversation(id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeConversationId === id) {
      setActiveConversationId(null)
      setMessages([])
    }
  }

  function toggleMode() {
    const next = chatMode === 'context' ? 'agent' : 'context'
    setChatMode(next)
    api.settings.set({ chatMode: next })
  }

  // ─── Send (dispatches to mode) ─────────────────────────────────────────────

  async function handleSend() {
    if (!input.trim() || sending) return

    const content = input.trim()
    setInput('')
    setSending(true)
    setErrorMessage(null)
    setToolExecutions([])

    // Ensure conversation
    let convId = activeConversationId
    if (!convId) {
      try {
        const title = content.slice(0, 60)
        const conv = await api.chat.createConversation({ projectId: projectId || '__global__', title })
        setConversations((prev) => [conv, ...prev])
        setActiveConversationId(conv.id)
        convId = conv.id
      } catch (err) {
        setErrorMessage(`Failed to create conversation: ${err instanceof Error ? err.message : String(err)}`)
        setSending(false)
        setInput(content)
        return
      }
    }

    // Save user message
    let userMsg: ChatMessage
    try {
      userMsg = await api.chat.sendMessage({ conversationId: convId, role: 'user', content })
      setMessages((prev) => [...prev, userMsg])
    } catch (err) {
      setErrorMessage(`Failed to save message: ${err instanceof Error ? err.message : String(err)}`)
      setSending(false)
      setInput(content)
      return
    }

    // Get API key
    let apiKey: string | undefined
    let model: string
    try {
      const config = (await window.api.invoke('settings:get')) as { openRouterKey?: string; chatModel?: string } | undefined
      apiKey = config?.openRouterKey
      model = config?.chatModel || 'anthropic/claude-sonnet-4-20250514'
    } catch {
      model = 'anthropic/claude-sonnet-4-20250514'
    }

    if (!apiKey) {
      const noKeyMessage = `**OpenRouter API key required**\n\nTo use the CodeFire agent, add your API key in **Settings** > **Engine** tab.`
      try {
        const errorMsg = await api.chat.sendMessage({ conversationId: convId, role: 'assistant', content: noKeyMessage })
        setMessages((prev) => [...prev, errorMsg])
      } catch {
        setMessages((prev) => [...prev, { id: -1, conversationId: convId, role: 'assistant', content: noKeyMessage, createdAt: new Date().toISOString() }])
      }
      setSending(false)
      return
    }

    try {
      if (chatMode === 'agent') {
        await handleAgentMode(convId, content, userMsg, apiKey, model)
      } else {
        await handleContextMode(convId, content, userMsg, apiKey, model)
      }
    } catch (err) {
      console.error('Chat error:', err)
      setStreaming(false)
      setStreamedContent('')
      const errText = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [...prev, {
        id: -Date.now(), conversationId: convId, role: 'assistant',
        content: `**Error:** ${errText}`, createdAt: new Date().toISOString(),
      }])
    } finally {
      setSending(false)
      setToolExecutions([])
    }
  }

  // ─── Context Mode (Swift parity — RAG + context stuffing) ──────────────────

  async function handleContextMode(
    convId: number,
    _userContent: string,
    userMsg: ChatMessage,
    apiKey: string,
    model: string
  ) {
    const context = await buildContextWithRAG(projectId, projectName, _userContent, isGlobal)
    const allMessages = [...messages, userMsg]
    let historyChars = 0
    const history: { role: string; content: string }[] = []
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const m = allMessages[i]
      if (historyChars + m.content.length > 25000) break
      history.unshift({ role: m.role, content: m.content })
      historyChars += m.content.length
    }

    setStreaming(true)
    setStreamedContent('')

    const fullContent = await streamChat(apiKey, model, [
      { role: 'system', content: context },
      ...history.slice(-20),
    ])

    setStreaming(false)
    setStreamedContent('')

    if (fullContent) {
      const assistantMsg = await api.chat.sendMessage({ conversationId: convId, role: 'assistant', content: fullContent })
      setMessages((prev) => [...prev, assistantMsg])
      updateConversationTitle(convId, _userContent)
    }
  }

  // ─── Agent Mode (tool calling loop) ────────────────────────────────────────

  async function handleAgentMode(
    convId: number,
    _userContent: string,
    userMsg: ChatMessage,
    apiKey: string,
    model: string
  ) {
    const systemPrompt = isGlobal
      ? 'You are the CodeFire agent — a smart assistant integrated into CodeFire, a companion app for AI coding agents. You have tools to manage tasks, notes, sessions, search code, browse the web, read files, and interact with git. Use tools when the user\'s request requires data or actions. Be concise.'
      : `You are the CodeFire agent for the "${projectName}" project. You have tools to manage tasks, notes, sessions, search code, browse the web, read files, and interact with git. Use tools when the user's request requires data or actions. Be concise.`

    // Build conversation messages for the API
    const allMessages = [...messages, userMsg]
    let historyChars = 0
    const apiMessages: Array<{ role: string; content: string }> = []
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const m = allMessages[i]
      if (historyChars + m.content.length > 25000) break
      apiMessages.unshift({ role: m.role, content: m.content })
      historyChars += m.content.length
    }

    // Agentic loop — max 10 iterations
    let loopMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: systemPrompt },
      ...apiMessages,
    ]

    for (let iteration = 0; iteration < 10; iteration++) {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Title': 'CodeFire',
        },
        body: JSON.stringify({
          model,
          messages: loopMessages,
          tools: AGENT_TOOLS,
          max_tokens: 4096,
        }),
      })

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => `HTTP ${resp.status}`)
        throw new Error(`API error: ${errorText.slice(0, 200)}`)
      }

      const json = await resp.json()
      const choice = json.choices?.[0]
      if (!choice) throw new Error('No response from model')

      const message = choice.message
      const toolCalls: ToolCall[] = message.tool_calls || []

      if (toolCalls.length === 0) {
        // No tool calls — final text response
        const content = message.content || ''
        if (content) {
          const assistantMsg = await api.chat.sendMessage({ conversationId: convId, role: 'assistant', content })
          setMessages((prev) => [...prev, assistantMsg])
          updateConversationTitle(convId, _userContent)
        }
        return
      }

      // Execute tool calls
      loopMessages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: tc.function,
        })),
      })

      for (const tc of toolCalls) {
        const fnName = tc.function.name
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* empty */ }

        // Show tool execution in UI
        setToolExecutions((prev) => [...prev, { name: fnName, args, status: 'running' }])

        const result = await executeToolCall(fnName, args, projectId, projectPath)

        setToolExecutions((prev) =>
          prev.map(te => te.name === fnName && te.status === 'running'
            ? { ...te, result: result.slice(0, 200), status: 'done' as const }
            : te
          )
        )

        loopMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        })
      }
    }

    // Reached max iterations
    const fallback = 'I reached the maximum number of tool calls. Here\'s what I found so far — please ask a more specific question if you need more.'
    const msg = await api.chat.sendMessage({ conversationId: convId, role: 'assistant', content: fallback })
    setMessages((prev) => [...prev, msg])
  }

  // ─── Streaming helper ──────────────────────────────────────────────────────

  async function streamChat(
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<string> {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'CodeFire',
      },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: 4096 }),
    })

    if (!resp.ok || !resp.body) {
      throw new Error(`API returned ${resp.status}`)
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        const data = line.slice(6)
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            fullContent += delta
            setStreamedContent(fullContent)
          }
        } catch { /* ignore */ }
      }
    }

    return fullContent
  }

  function updateConversationTitle(convId: number, content: string) {
    const conv = conversations.find(c => c.id === convId)
    if (conv && conv.title === 'New Chat') {
      const newTitle = content.slice(0, 60)
      setConversations((prev) => prev.map(c => c.id === convId ? { ...c, title: newTitle } : c))
    }
  }

  async function handleCopyMessage(content: string) {
    await navigator.clipboard.writeText(content)
  }

  async function handleCreateTask(content: string) {
    try {
      await api.tasks.create({
        projectId: projectId || '__global__',
        title: `Chat: ${content.slice(0, 60)}`,
        description: content,
        source: 'claude',
        isGlobal: isGlobal ? true : undefined,
      })
    } catch (err) { console.error('Failed to create task from chat:', err) }
  }

  async function handleCreateNote(content: string) {
    try {
      await api.notes.create({
        projectId: projectId || '__global__',
        title: `Chat note: ${content.slice(0, 40)}`,
        content,
        isGlobal: isGlobal ? true : undefined,
      })
    } catch (err) { console.error('Failed to create note from chat:', err) }
  }

  function handleSendToTerminal(content: string) {
    navigator.clipboard.writeText(content)
  }

  const activeConversation = conversations.find(c => c.id === activeConversationId)
  const dropdownLabel = activeConversation?.title || 'Select thread...'

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-800 bg-neutral-950 shrink-0">
        <Flame size={14} className="text-codefire-orange shrink-0" />
        <span className="text-[11px] font-semibold text-neutral-300 shrink-0">CodeFire</span>

        {/* Mode toggle */}
        <button
          onClick={toggleMode}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors shrink-0 ${
            chatMode === 'agent'
              ? 'bg-codefire-orange/20 text-codefire-orange border border-codefire-orange/30'
              : 'bg-neutral-800 text-neutral-400 border border-neutral-700 hover:text-neutral-300'
          }`}
          title={chatMode === 'context' ? 'Context Mode — low cost, RAG-enhanced' : 'Agent Mode — full tool calling'}
        >
          {chatMode === 'agent' ? <Zap size={10} /> : <BookOpen size={10} />}
          {chatMode === 'agent' ? 'Agent' : 'Context'}
        </button>

        {/* Conversation dropdown */}
        <div className="relative flex-1 min-w-0" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(v => !v)}
            className="flex items-center gap-1.5 w-full px-2 py-1 rounded bg-neutral-800/60 hover:bg-neutral-800 transition-colors text-left min-w-0"
          >
            <span className="text-[11px] text-neutral-300 truncate flex-1">{dropdownLabel}</span>
            <ChevronDown size={12} className="text-neutral-500 shrink-0" />
          </button>

          {showDropdown && (
            <div className="absolute top-full left-0 mt-1 w-72 max-h-80 overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50">
              <button
                onClick={handleNewConversation}
                className="flex items-center gap-2 w-full px-3 py-2 text-[11px] text-codefire-orange hover:bg-neutral-800 transition-colors border-b border-neutral-800"
              >
                <Plus size={12} />
                New Chat
              </button>

              {conversations.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1 text-[9px] font-semibold text-neutral-600 uppercase tracking-wider">
                    Conversations
                  </div>
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => { setActiveConversationId(conv.id); setShowDropdown(false) }}
                      className={`flex items-center gap-2 w-full px-3 py-1.5 text-[11px] transition-colors group ${
                        conv.id === activeConversationId
                          ? 'bg-neutral-800 text-neutral-200'
                          : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300'
                      }`}
                    >
                      <span className="truncate flex-1 text-left">{conv.title}</span>
                      <span className="text-[9px] text-neutral-600 shrink-0">
                        {new Date(conv.updatedAt).toLocaleDateString()}
                      </span>
                      <button
                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-neutral-600 hover:text-red-400 transition-all shrink-0"
                      >
                        <Trash2 size={10} />
                      </button>
                    </button>
                  ))}
                </div>
              )}

              {sessions.length > 0 && (
                <div className="py-1 border-t border-neutral-800">
                  <div className="px-3 py-1 text-[9px] font-semibold text-neutral-600 uppercase tracking-wider">
                    Claude Sessions
                  </div>
                  {sessions.slice(0, 20).map((session) => (
                    <button
                      key={session.id}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300 transition-colors"
                    >
                      <Terminal size={10} className="shrink-0 text-neutral-600" />
                      <span className="truncate flex-1 text-left">
                        {session.summary || session.slug || session.id.slice(0, 8)}
                      </span>
                      <span className="text-[9px] text-neutral-600 shrink-0">
                        {session.startedAt ? new Date(session.startedAt).toLocaleDateString() : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={handleNewConversation}
          className="p-1 rounded text-neutral-500 hover:text-codefire-orange hover:bg-neutral-800 transition-colors shrink-0"
          title="New conversation"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {!activeConversationId && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Flame size={28} className="text-neutral-700 mb-3" />
            <p className="text-xs text-neutral-500 mb-1">CodeFire Agent</p>
            <p className="text-[10px] text-neutral-600 mb-4 max-w-48">
              Ask anything about {projectName}. I have context about your tasks, sessions, notes, and code.
            </p>
            <div className="flex items-center gap-1.5 text-[9px] text-neutral-600">
              {chatMode === 'agent' ? (
                <><Zap size={9} className="text-codefire-orange" /> Agent mode — can use tools</>
              ) : (
                <><BookOpen size={9} /> Context mode — low cost</>
              )}
            </div>
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Flame size={20} className="text-neutral-700 mb-2" />
            <p className="text-[10px] text-neutral-600">Ask anything about {projectName}</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                onCopy={handleCopyMessage}
                onCreateTask={handleCreateTask}
                onCreateNote={handleCreateNote}
                onSendToTerminal={handleSendToTerminal}
              />
            ))}
            {streaming && streamedContent && (
              <ChatBubble
                role="assistant"
                content={streamedContent}
                onCopy={handleCopyMessage}
                onCreateTask={handleCreateTask}
                onCreateNote={handleCreateNote}
                onSendToTerminal={handleSendToTerminal}
              />
            )}
            {toolExecutions.length > 0 && (
              <div className="space-y-1">
                {toolExecutions.map((te, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-neutral-800/50 border border-neutral-700/50">
                    {te.status === 'running' ? (
                      <Loader2 size={10} className="animate-spin text-codefire-orange shrink-0" />
                    ) : (
                      <Wrench size={10} className="text-neutral-500 shrink-0" />
                    )}
                    <span className="text-[10px] text-neutral-400 font-mono truncate">
                      {te.name}({Object.keys(te.args).length > 0 ? Object.entries(te.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ').slice(0, 60) : ''})
                    </span>
                    {te.status === 'done' && (
                      <span className="text-[9px] text-green-600 shrink-0">done</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {sending && !streaming && toolExecutions.length === 0 && (
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Loader2 size={12} className="animate-spin text-neutral-500" />
                <span className="text-[10px] text-neutral-500">
                  {chatMode === 'agent' ? 'Agent thinking...' : 'Thinking...'}
                </span>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className="px-3 py-2 bg-red-900/30 border-t border-red-800/50 shrink-0">
          <p className="text-[11px] text-red-300">{errorMessage}</p>
        </div>
      )}

      {/* Input area */}
      <div className="px-3 py-2.5 border-t border-neutral-800 shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={1}
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-codefire-orange/50 resize-none max-h-24"
            placeholder={chatMode === 'agent' ? `Ask or command the agent...` : `Ask about ${projectName}...`}
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="px-3 py-2 bg-codefire-orange/20 text-codefire-orange rounded-lg hover:bg-codefire-orange/30 transition-colors disabled:opacity-40 self-end"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Chat Bubble ─────────────────────────────────────────────────────────────

function ChatBubble({
  role,
  content,
  onCopy,
  onCreateTask,
  onCreateNote,
  onSendToTerminal,
}: {
  role: string
  content: string
  onCopy: (content: string) => void
  onCreateTask: (content: string) => void
  onCreateNote: (content: string) => void
  onSendToTerminal: (content: string) => void
}) {
  const isUser = role === 'user'
  const [showActions, setShowActions] = useState(false)

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => !isUser && setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="relative max-w-[90%]">
        <div
          className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
            isUser
              ? 'bg-codefire-orange/20 text-neutral-200'
              : 'bg-neutral-800 text-neutral-300 border border-neutral-700/50'
          }`}
        >
          <MarkdownContent content={content} />
        </div>

        {showActions && !isUser && (
          <div className="flex items-center gap-0.5 mt-1">
            <ActionButton icon={<Copy size={10} />} title="Copy" onClick={() => onCopy(content)} />
            <ActionButton icon={<ListTodo size={10} />} title="Create Task" onClick={() => onCreateTask(content)} />
            <ActionButton icon={<StickyNote size={10} />} title="Add to Notes" onClick={() => onCreateNote(content)} />
            <ActionButton icon={<Terminal size={10} />} title="Copy to Clipboard" onClick={() => onSendToTerminal(content)} />
          </div>
        )}
      </div>
    </div>
  )
}

function ActionButton({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1 rounded text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
    >
      {icon}
    </button>
  )
}

// ─── Simple Markdown Rendering ───────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBlockContent = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={i} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 my-1 overflow-x-auto text-[10px] text-neutral-300">
            <code>{codeBlockContent.trimEnd()}</code>
          </pre>
        )
        codeBlockContent = ''
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockContent += (codeBlockContent ? '\n' : '') + line
      continue
    }

    if (line.startsWith('### ')) {
      elements.push(<p key={i} className="font-semibold text-neutral-200 mt-2 mb-0.5">{formatInline(line.slice(4))}</p>)
    } else if (line.startsWith('## ')) {
      elements.push(<p key={i} className="font-semibold text-neutral-200 mt-2 mb-0.5">{formatInline(line.slice(3))}</p>)
    } else if (line.startsWith('# ')) {
      elements.push(<p key={i} className="font-bold text-neutral-100 mt-2 mb-1">{formatInline(line.slice(2))}</p>)
    } else if (line.match(/^[-*]\s/)) {
      elements.push(
        <p key={i} className="pl-3">
          <span className="text-neutral-600 mr-1">&bull;</span>
          {formatInline(line.replace(/^[-*]\s/, ''))}
        </p>
      )
    } else if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)/)
      if (match) {
        elements.push(
          <p key={i} className="pl-3">
            <span className="text-neutral-500 mr-1">{match[1]}.</span>
            {formatInline(match[2])}
          </p>
        )
      }
    } else if (line.startsWith('> ')) {
      elements.push(
        <p key={i} className="pl-2 border-l-2 border-neutral-600 text-neutral-400 italic">
          {formatInline(line.slice(2))}
        </p>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1.5" />)
    } else {
      elements.push(<p key={i} className="whitespace-pre-wrap">{formatInline(line)}</p>)
    }
  }

  if (inCodeBlock && codeBlockContent) {
    elements.push(
      <pre key="unclosed" className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 my-1 overflow-x-auto text-[10px] text-neutral-300">
        <code>{codeBlockContent.trimEnd()}</code>
      </pre>
    )
  }

  return <>{elements}</>
}

function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/)
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/)
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/)

    const matches = [
      codeMatch ? { type: 'code', match: codeMatch, index: codeMatch[1].length } : null,
      boldMatch ? { type: 'bold', match: boldMatch, index: boldMatch[1].length } : null,
      italicMatch ? { type: 'italic', match: italicMatch, index: italicMatch[1].length } : null,
    ].filter(Boolean).sort((a, b) => a!.index - b!.index)

    if (matches.length === 0) {
      parts.push(remaining)
      break
    }

    const first = matches[0]!
    if (first.match![1]) parts.push(first.match![1])

    if (first.type === 'code') {
      parts.push(<code key={key++} className="bg-neutral-800 text-codefire-orange px-1 py-0.5 rounded text-[10px]">{first.match![2]}</code>)
    } else if (first.type === 'bold') {
      parts.push(<strong key={key++} className="font-semibold text-neutral-200">{first.match![2]}</strong>)
    } else if (first.type === 'italic') {
      parts.push(<em key={key++}>{first.match![2]}</em>)
    }
    remaining = remaining.slice(first.match![0].length)
  }

  return <>{parts}</>
}

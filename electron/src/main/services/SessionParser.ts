// ─── Session Parser ─────────────────────────────────────────────────────────
//
// Pure function that parses Claude Code JSONL session files into structured data.
// Each line in the JSONL is a JSON object with a `type` field.
// We only care about `user` and `assistant` types for session metadata.
//

export interface ParsedSession {
  sessionId: string
  slug: string | null
  model: string | null
  gitBranch: string | null
  startedAt: string | null
  endedAt: string | null
  messageCount: number
  toolUseCount: number
  filesChanged: string[]
  toolNames: string[]
  userMessages: string[]
  summary: string | null
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

interface JsonlLine {
  type?: string
  sessionId?: string
  slug?: string
  gitBranch?: string
  timestamp?: string
  message?: {
    role?: string
    model?: string
    content?: string | ContentBlock[]
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

interface ContentBlock {
  type: string
  input?: {
    file_path?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * Parse a Claude Code JSONL session file into structured session data.
 *
 * This is a pure function with no file I/O — it takes raw file content
 * and returns a ParsedSession.
 *
 * @param content - Raw UTF-8 content of the .jsonl file
 * @param sessionId - The session UUID (extracted from the filename)
 */
export function parseSessionFile(content: string, sessionId: string): ParsedSession {
  const result: ParsedSession = {
    sessionId,
    slug: null,
    model: null,
    gitBranch: null,
    startedAt: null,
    endedAt: null,
    messageCount: 0,
    toolUseCount: 0,
    filesChanged: [],
    toolNames: [],
    userMessages: [],
    summary: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  }

  const filePathsSet = new Set<string>()
  const toolNamesList: string[] = []
  const userMessagesList: string[] = []
  const lines = content.split('\n').filter((line) => line.trim().length > 0)

  for (const line of lines) {
    let parsed: JsonlLine
    try {
      parsed = JSON.parse(line) as JsonlLine
    } catch {
      // Skip malformed lines
      continue
    }

    // Extract metadata from any line (sessionId, slug, gitBranch can appear on any type)
    if (parsed.slug && !result.slug) {
      result.slug = parsed.slug
    }
    if (parsed.gitBranch && !result.gitBranch) {
      result.gitBranch = parsed.gitBranch
    }

    // Track timestamps from any line that has one
    if (parsed.timestamp) {
      const ts = parsed.timestamp
      if (!result.startedAt || ts < result.startedAt) {
        result.startedAt = ts
      }
      if (!result.endedAt || ts > result.endedAt) {
        result.endedAt = ts
      }
    }

    // Only process user and assistant message types
    const type = parsed.type
    if (type !== 'user' && type !== 'assistant') {
      continue
    }

    // Count user and assistant messages
    result.messageCount++

    // Extract user message text
    if (type === 'user' && parsed.message) {
      const content = parsed.message.content
      if (typeof content === 'string') {
        userMessagesList.push(content)
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && typeof (block as Record<string, unknown>).text === 'string') {
            userMessagesList.push((block as Record<string, unknown>).text as string)
          }
        }
      }
    }

    if (type === 'assistant' && parsed.message) {
      const msg = parsed.message

      // Extract model
      if (msg.model && !result.model) {
        result.model = msg.model
      }

      // Sum token usage
      if (msg.usage) {
        result.inputTokens += msg.usage.input_tokens ?? 0
        result.outputTokens += msg.usage.output_tokens ?? 0
        result.cacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0
        result.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0
      }

      // Process content blocks for tool_use
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            result.toolUseCount++
            const toolName = (block as Record<string, unknown>).name as string
            if (toolName) toolNamesList.push(toolName)

            // Extract file_path from tool inputs
            if (block.input?.file_path && typeof block.input.file_path === 'string') {
              filePathsSet.add(block.input.file_path)
            }
          }
        }
      }
    }
  }

  result.filesChanged = Array.from(filePathsSet).sort()
  result.toolNames = toolNamesList
  result.userMessages = userMessagesList

  // Generate summary from first meaningful user message + files changed (matches Swift)
  if (userMessagesList.length > 0) {
    // Find the first user message that contains actual user text (not just system tags)
    let rawTopic = ''
    for (const msg of userMessagesList) {
      const cleaned = extractUserText(msg)
      if (cleaned.length > 0) {
        rawTopic = cleaned
        break
      }
    }
    if (rawTopic.length > 0) {
      let topic = rawTopic.slice(0, 200).trim()
      if (rawTopic.length > 200) topic += '…'
      if (result.filesChanged.length > 0) {
        const maxFiles = 5
        const fileList = result.filesChanged.slice(0, maxFiles).join(', ')
        const extra = result.filesChanged.length > maxFiles ? ` (+${result.filesChanged.length - maxFiles} more)` : ''
        result.summary = `${topic} | Files: ${fileList}${extra}`
      } else {
        result.summary = topic
      }
    }
  }

  return result
}

/**
 * Strip system/XML tags from user messages to extract the actual user intent.
 * Claude Code session JSONL user messages often contain system tags like
 * <local-command-caveat>, <system-reminder>, <command-name>, etc.
 */
function extractUserText(raw: string): string {
  // Remove XML-style tags and their content for known system tags
  let text = raw
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .replace(/<available-deferred-tools>[\s\S]*?<\/available-deferred-tools>/g, '')
    .replace(/<[\w-]+>[\s\S]*?<\/antml:[\w-]+>/g, '')
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

// ─── Live Session State ───────────────────────────────────────────────────────

export interface ToolCount {
  name: string
  count: number
}

export interface ActivityItem {
  timestamp: string
  type: 'userMessage' | 'assistantText' | 'toolUse'
  detail: string
}

export interface LiveSessionState {
  sessionId: string
  slug: string | null
  model: string | null
  gitBranch: string | null
  startedAt: string | null
  lastActivity: string | null
  totalInputTokens: number
  totalOutputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  latestContextTokens: number
  messageCount: number
  userMessageCount: number
  toolUseCount: number
  filesChanged: string[]
  toolCounts: ToolCount[]
  recentActivity: ActivityItem[]
  estimatedCost: number
  contextUsagePercent: number
  elapsedFormatted: string
  isActive: boolean
}

/**
 * Parse a JSONL session file into rich live-session state for the dashboard.
 */
export function parseLiveSession(content: string, sessionId: string): LiveSessionState {
  const toolCountMap = new Map<string, number>()
  const filePathsSet = new Set<string>()
  const activity: ActivityItem[] = []

  let slug: string | null = null
  let model: string | null = null
  let gitBranch: string | null = null
  let startedAt: string | null = null
  let lastActivity: string | null = null
  let totalInput = 0
  let totalOutput = 0
  let cacheCreation = 0
  let cacheRead = 0
  let latestContext = 0
  let messageCount = 0
  let userMessageCount = 0
  let toolUseCount = 0

  const lines = content.split('\n').filter((l) => l.trim().length > 0)

  for (const line of lines) {
    let parsed: JsonlLine
    try {
      parsed = JSON.parse(line) as JsonlLine
    } catch {
      continue
    }

    if (parsed.slug && !slug) slug = parsed.slug
    if (parsed.gitBranch && !gitBranch) gitBranch = parsed.gitBranch

    const ts = parsed.timestamp ?? null
    if (ts) {
      if (!startedAt || ts < startedAt) startedAt = ts
      if (!lastActivity || ts > lastActivity) lastActivity = ts
    }

    const type = parsed.type
    if (type !== 'user' && type !== 'assistant') continue

    messageCount++

    if (type === 'user') {
      userMessageCount++
      const text = typeof parsed.message?.content === 'string'
        ? parsed.message.content.slice(0, 80)
        : 'User message'
      if (ts) activity.push({ timestamp: ts, type: 'userMessage', detail: text })
    }

    if (type === 'assistant' && parsed.message) {
      const msg = parsed.message
      if (msg.model && !model) model = msg.model

      if (msg.usage) {
        totalInput += msg.usage.input_tokens ?? 0
        totalOutput += msg.usage.output_tokens ?? 0
        cacheCreation += msg.usage.cache_creation_input_tokens ?? 0
        cacheRead += msg.usage.cache_read_input_tokens ?? 0
        // Latest context = input tokens of most recent assistant message
        latestContext = msg.usage.input_tokens ?? 0
      }

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            toolUseCount++
            const toolName = (block as Record<string, unknown>).name as string ?? 'unknown'
            toolCountMap.set(toolName, (toolCountMap.get(toolName) ?? 0) + 1)
            if (block.input?.file_path && typeof block.input.file_path === 'string') {
              filePathsSet.add(block.input.file_path)
            }
            if (ts) activity.push({ timestamp: ts, type: 'toolUse', detail: toolName })
          } else if (block.type === 'text') {
            const text = (block as Record<string, unknown>).text as string ?? ''
            if (ts && text.length > 0) {
              activity.push({ timestamp: ts, type: 'assistantText', detail: text.slice(0, 80) })
            }
          }
        }
      }
    }
  }

  const toolCounts = Array.from(toolCountMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  const estimatedCost = calculateCost(model, totalInput, totalOutput, cacheCreation, cacheRead)
  const contextLimit = 200_000
  const contextUsagePercent = contextLimit > 0 ? Math.min(1, latestContext / contextLimit) : 0

  let elapsedFormatted = ''
  if (startedAt) {
    const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000
    if (elapsed < 60) elapsedFormatted = 'just now'
    else {
      const minutes = Math.floor(elapsed / 60)
      if (minutes < 60) elapsedFormatted = `${minutes}m ago`
      else {
        const hours = Math.floor(minutes / 60)
        elapsedFormatted = `${hours}h ${minutes % 60}m ago`
      }
    }
  }

  return {
    sessionId,
    slug,
    model,
    gitBranch,
    startedAt,
    lastActivity,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    latestContextTokens: latestContext,
    messageCount,
    userMessageCount,
    toolUseCount,
    filesChanged: Array.from(filePathsSet),
    toolCounts,
    recentActivity: activity.slice(-30).reverse(),
    estimatedCost,
    contextUsagePercent,
    elapsedFormatted,
    isActive: sessionId !== '',
  }
}

function calculateCost(
  model: string | null,
  input: number,
  output: number,
  cacheCreation: number,
  cacheRead: number
): number {
  // Pricing per million tokens (USD)
  let inputRate = 3.0
  let outputRate = 15.0
  let cacheCreateRate = 3.75
  let cacheReadRate = 0.30

  if (model) {
    const m = model.toLowerCase()
    if (m.includes('opus')) {
      inputRate = 15.0; outputRate = 75.0; cacheCreateRate = 18.75; cacheReadRate = 1.50
    } else if (m.includes('haiku')) {
      inputRate = 0.80; outputRate = 4.0; cacheCreateRate = 1.0; cacheReadRate = 0.08
    }
    // sonnet defaults are already set
  }

  return (
    (input / 1_000_000) * inputRate +
    (output / 1_000_000) * outputRate +
    (cacheCreation / 1_000_000) * cacheCreateRate +
    (cacheRead / 1_000_000) * cacheReadRate
  )
}

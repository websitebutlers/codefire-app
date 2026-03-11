import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { readConfig } from '../services/ConfigStore'

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const FETCH_TIMEOUT_MS = 15_000

// ─── Data Gathering ─────────────────────────────────────────────────────────

interface ProjectSnapshot {
  id: string
  name: string
  path: string
  clientName: string | null
  lastOpened: string | null
  taskCounts: { todo: number; in_progress: number; done: number }
  recentSessions: Array<{
    title: string | null
    summary: string | null
    startedAt: string | null
    endedAt: string | null
    model: string | null
    gitBranch: string | null
    inputTokens: number
    outputTokens: number
  }>
  stuckTasks: Array<{ id: number; title: string; status: string; updatedAt: string | null; createdAt: string; priority: number }>
}

interface WorkContext {
  projects: ProjectSnapshot[]
  recentEmails: Array<{ from: string; subject: string; receivedAt: string; taskId: number | null; projectName: string | null }>
  globalTasks: Array<{ id: number; title: string; status: string; priority: number; createdAt: string; updatedAt: string | null; projectName: string }>
  recentCompletedTasks: Array<{ title: string; completedAt: string; projectName: string }>
  recentSessionStats: { count: number; totalInputTokens: number; totalOutputTokens: number }
}

function gatherWorkContext(db: Database.Database, scopeProjectId?: string): WorkContext {
  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Get projects (all or scoped to one)
  const projectQuery = scopeProjectId
    ? `SELECT p.id, p.name, p.path, p.lastOpened, c.name as clientName
       FROM projects p LEFT JOIN clients c ON p.clientId = c.id
       WHERE p.id = ?`
    : `SELECT p.id, p.name, p.path, p.lastOpened, c.name as clientName
       FROM projects p LEFT JOIN clients c ON p.clientId = c.id
       ORDER BY p.lastOpened DESC`
  const projects = (scopeProjectId
    ? db.prepare(projectQuery).all(scopeProjectId)
    : db.prepare(projectQuery).all()
  ) as Array<{ id: string; name: string; path: string; lastOpened: string | null; clientName: string | null }>

  const projectSnapshots: ProjectSnapshot[] = []

  for (const proj of projects) {
    const taskCounts = { todo: 0, in_progress: 0, done: 0 }
    let recentSessions: ProjectSnapshot['recentSessions'] = []
    let stuckTasks: ProjectSnapshot['stuckTasks'] = []

    try {
      const counts = db.prepare(`
        SELECT status, COUNT(*) as cnt FROM taskItems WHERE projectId = ? GROUP BY status
      `).all(proj.id) as Array<{ status: string; cnt: number }>
      for (const c of counts) {
        if (c.status in taskCounts) taskCounts[c.status as keyof typeof taskCounts] = c.cnt
      }
    } catch (err) {
      console.error(`[Briefing] Failed to count tasks for ${proj.name}:`, err)
    }

    try {
      recentSessions = db.prepare(`
        SELECT title, summary, startedAt, endedAt, model, gitBranch, inputTokens, outputTokens
        FROM sessions WHERE projectId = ? AND startedAt > ? ORDER BY startedAt DESC LIMIT 5
      `).all(proj.id, sevenDaysAgo) as ProjectSnapshot['recentSessions']
    } catch (err) {
      console.error(`[Briefing] Failed to query sessions for ${proj.name}:`, err)
    }

    try {
      stuckTasks = db.prepare(`
        SELECT id, title, status, updatedAt, createdAt, priority FROM taskItems
        WHERE projectId = ? AND status IN ('in_progress', 'todo')
        AND (
          (status = 'in_progress' AND (updatedAt < ? OR (updatedAt IS NULL AND createdAt < ?)))
          OR (status = 'todo' AND priority >= 3)
        )
        ORDER BY priority DESC, createdAt ASC
        LIMIT 10
      `).all(proj.id, sevenDaysAgo, sevenDaysAgo) as ProjectSnapshot['stuckTasks']
    } catch (err) {
      console.error(`[Briefing] Failed to query stuck tasks for ${proj.name}:`, err)
    }

    projectSnapshots.push({
      id: proj.id,
      name: proj.name,
      path: proj.path,
      clientName: proj.clientName,
      lastOpened: proj.lastOpened,
      taskCounts,
      recentSessions,
      stuckTasks,
    })
  }

  // Recent emails (last 7 days)
  let recentEmails: WorkContext['recentEmails'] = []
  try {
    recentEmails = db.prepare(`
      SELECT pe.fromAddress as "from", pe.subject, pe.receivedAt, pe.taskId,
        p.name as projectName
      FROM processedEmails pe
      LEFT JOIN taskItems t ON pe.taskId = t.id
      LEFT JOIN projects p ON t.projectId = p.id
      WHERE pe.receivedAt > ?
      ORDER BY pe.receivedAt DESC
      LIMIT 20
    `).all(sevenDaysAgo) as WorkContext['recentEmails']
  } catch {
    // Gmail tables might not exist
  }

  // All non-done tasks across all projects (for priority analysis)
  let globalTasks: WorkContext['globalTasks'] = []
  try {
    const taskQuery = scopeProjectId
      ? `SELECT t.id, t.title, t.status, t.priority, t.createdAt, t.updatedAt, p.name as projectName
         FROM taskItems t JOIN projects p ON t.projectId = p.id
         WHERE t.status IN ('todo', 'in_progress') AND t.projectId = ?
         ORDER BY t.priority DESC, t.createdAt ASC`
      : `SELECT t.id, t.title, t.status, t.priority, t.createdAt, t.updatedAt, p.name as projectName
         FROM taskItems t JOIN projects p ON t.projectId = p.id
         WHERE t.status IN ('todo', 'in_progress')
         ORDER BY t.priority DESC, t.createdAt ASC`
    globalTasks = (scopeProjectId
      ? db.prepare(taskQuery).all(scopeProjectId)
      : db.prepare(taskQuery).all()
    ) as WorkContext['globalTasks']
  } catch (err) {
    console.error('[Briefing] Failed to query global tasks:', err)
  }

  // Recently completed tasks (last 24 hours)
  let recentCompletedTasks: WorkContext['recentCompletedTasks'] = []
  try {
    const completedQuery = scopeProjectId
      ? `SELECT t.title, t.completedAt, p.name as projectName
         FROM taskItems t JOIN projects p ON t.projectId = p.id
         WHERE t.status = 'done' AND t.completedAt > ? AND t.projectId = ?
         ORDER BY t.completedAt DESC LIMIT 10`
      : `SELECT t.title, t.completedAt, p.name as projectName
         FROM taskItems t JOIN projects p ON t.projectId = p.id
         WHERE t.status = 'done' AND t.completedAt > ?
         ORDER BY t.completedAt DESC LIMIT 10`
    recentCompletedTasks = (scopeProjectId
      ? db.prepare(completedQuery).all(oneDayAgo, scopeProjectId)
      : db.prepare(completedQuery).all(oneDayAgo)
    ) as WorkContext['recentCompletedTasks']
  } catch (err) {
    console.error('[Briefing] Failed to query completed tasks:', err)
  }

  // Session stats (last 24 hours)
  let sessionStats: WorkContext['recentSessionStats'] = { count: 0, totalInputTokens: 0, totalOutputTokens: 0 }
  try {
    const sessionQuery = scopeProjectId
      ? `SELECT COUNT(*) as count, COALESCE(SUM(inputTokens), 0) as totalInputTokens,
           COALESCE(SUM(outputTokens), 0) as totalOutputTokens
         FROM sessions WHERE startedAt > ? AND projectId = ?`
      : `SELECT COUNT(*) as count, COALESCE(SUM(inputTokens), 0) as totalInputTokens,
           COALESCE(SUM(outputTokens), 0) as totalOutputTokens
         FROM sessions WHERE startedAt > ?`
    sessionStats = (scopeProjectId
      ? db.prepare(sessionQuery).get(oneDayAgo, scopeProjectId)
      : db.prepare(sessionQuery).get(oneDayAgo)
    ) as WorkContext['recentSessionStats']
  } catch (err) {
    console.error('[Briefing] Failed to query session stats:', err)
  }

  return {
    projects: projectSnapshots,
    recentEmails,
    globalTasks,
    recentCompletedTasks,
    recentSessionStats: sessionStats,
  }
}

// ─── AI Synthesis ─────────────────────────────────────────────────────────────

interface BriefingSynthesis {
  priorities: Array<{
    title: string
    reason: string // "momentum" | "aging" | "urgent" | "quickwin" | "blocked"
    detail: string
    projectName: string
    taskId?: number
  }>
  attention: Array<{
    title: string
    type: string // "stale_project" | "stuck_task" | "email" | "overdue"
    detail: string
    projectName: string
    taskId?: number
  }>
  quickWins: Array<{
    title: string
    detail: string
    projectName: string
    taskId?: number
  }>
  recap: {
    sessionsCount: number
    tokensUsed: number
    tasksCompleted: number
    highlights: string[]
  }
}

function buildPrompt(ctx: WorkContext): string {
  const now = new Date()

  // Build project summaries
  const projectSummaries = ctx.projects.map((p) => {
    const lastOpenedStr = p.lastOpened
      ? `last opened ${relativeTime(new Date(p.lastOpened), now)}`
      : 'never opened'
    const sessionInfo = p.recentSessions.length > 0
      ? `Recent sessions: ${p.recentSessions.map(s => s.title || s.summary || s.gitBranch || 'untitled').join(', ')}`
      : 'No recent sessions'
    const stuckInfo = p.stuckTasks.length > 0
      ? `Stuck/high-priority tasks: ${p.stuckTasks.map(t => `[P${t.priority}] "${t.title}" (${t.status} since ${relativeTime(new Date(t.updatedAt || t.createdAt), now)})`).join('; ')}`
      : ''
    return `- **${p.name}**${p.clientName ? ` (client: ${p.clientName})` : ''}: ${lastOpenedStr}. Tasks: ${p.taskCounts.todo} todo, ${p.taskCounts.in_progress} in-progress, ${p.taskCounts.done} done. ${sessionInfo}${stuckInfo ? '. ' + stuckInfo : ''}`
  }).join('\n')

  // Build task list
  const taskList = ctx.globalTasks.slice(0, 30).map((t) => {
    const age = relativeTime(new Date(t.createdAt), now)
    const lastTouched = t.updatedAt ? relativeTime(new Date(t.updatedAt), now) : 'never updated'
    return `- [P${t.priority}] [${t.status}] "${t.title}" in ${t.projectName} (created ${age}, last updated ${lastTouched}, id:${t.id})`
  }).join('\n')

  // Build email summary
  const emailSummary = ctx.recentEmails.length > 0
    ? ctx.recentEmails.slice(0, 10).map(e =>
      `- From: ${e.from}, Subject: "${e.subject}" (${relativeTime(new Date(e.receivedAt), now)})${e.projectName ? ` → linked to ${e.projectName}` : ''}`
    ).join('\n')
    : 'No recent emails'

  // Recap data
  const recapData = `Sessions in last 24h: ${ctx.recentSessionStats.count}. Tokens used: ${formatTokens(ctx.recentSessionStats.totalInputTokens + ctx.recentSessionStats.totalOutputTokens)}. Tasks completed: ${ctx.recentCompletedTasks.length}${ctx.recentCompletedTasks.length > 0 ? ': ' + ctx.recentCompletedTasks.map(t => `"${t.title}" (${t.projectName})`).join(', ') : ''}.`

  return `You are generating a personal daily work briefing for a developer/agency owner who uses AI coding tools.
Analyze their work data and produce an actionable briefing that helps them start their day.

Current date/time: ${now.toISOString()}

## Projects
${projectSummaries}

## All Active Tasks (across all projects)
${taskList || 'No active tasks'}

## Recent Emails
${emailSummary}

## Last 24h Recap
${recapData}

---

Generate a JSON briefing with these sections:

### priorities (exactly 3 items, most important first)
Pick the 3 most important things to focus on today. Consider:
- **momentum**: Tasks the user was actively working on (recent sessions on that project/branch)
- **aging**: Tasks that have been in-progress too long without updates
- **urgent**: High-priority tasks (P3-P4) that haven't been started
- **quickwin**: Important tasks that seem quick to complete based on their title
Each item needs: title (actionable, starts with a verb), reason (one of: momentum/aging/urgent/quickwin), detail (1 sentence explaining why NOW), projectName, taskId (if referencing a specific task)

### attention (0-5 items)
Things that need the user's attention but aren't today's top priorities:
- Projects with no activity in 7+ days
- Tasks stuck in-progress for 3+ days
- Important emails that might need responses
- Any concerning patterns (too many in-progress tasks, projects falling behind)
Each item needs: title (short), type (stale_project/stuck_task/email/overdue), detail (1 sentence), projectName, taskId (if applicable)

### quickWins (0-4 items, DO NOT duplicate priorities)
Small tasks across any project that could be knocked out quickly for momentum. Pick tasks that sound simple based on their title. Do NOT include tasks already in priorities.
Each item needs: title, detail (why it's quick), projectName, taskId

### recap
Summary of the last 24 hours:
- sessionsCount: number of coding sessions
- tokensUsed: total tokens consumed
- tasksCompleted: number of tasks completed
- highlights: array of 1-3 short highlight strings summarizing accomplishments (empty array if nothing notable)

Respond ONLY with valid JSON matching this schema. No markdown fences.
If there's very little data, still produce the structure with fewer items. Never fabricate tasks or data — only reference real items from the input.`
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '\u2026'
}

function relativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

async function synthesizeWithAI(
  ctx: WorkContext,
  apiKey: string,
  model: string
): Promise<BriefingSynthesis | null> {
  const prompt = buildPrompt(ctx)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://codefire.dev',
        'X-Title': 'CodeFire',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      console.error('OpenRouter briefing error:', response.status)
      return null
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const content = json.choices?.[0]?.message?.content?.trim() ?? ''
    const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as BriefingSynthesis
    return parsed
  } catch (err) {
    console.error('Briefing AI synthesis failed:', err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Build a smart briefing without AI. Works with any amount of data — even zero tasks.
 * This is the primary fallback and should always produce useful, non-empty output.
 */
function buildFallbackBriefing(ctx: WorkContext): BriefingSynthesis {
  const now = new Date()
  const usedTaskIds = new Set<number>()

  // ── Priorities ────────────────────────────────────────────────────────
  // Strategy: pick from in-progress (momentum), high-priority todos (urgent),
  // then most recently active projects with open tasks
  const priorities: BriefingSynthesis['priorities'] = []

  // 1. In-progress tasks = momentum (they were started, finish them)
  const inProgress = ctx.globalTasks.filter(t => t.status === 'in_progress')
  for (const t of inProgress.slice(0, 2)) {
    const age = daysBetween(new Date(t.updatedAt || t.createdAt), now)
    priorities.push({
      title: t.title,
      reason: age > 3 ? 'aging' : 'momentum',
      detail: age > 3
        ? `Started ${age} days ago and hasn't been updated — close it out or move it back to todo`
        : `Currently in progress in ${t.projectName} — keep going`,
      projectName: t.projectName,
      taskId: t.id,
    })
    usedTaskIds.add(t.id)
  }

  // 2. High-priority todos (P3+)
  const highPriTodos = ctx.globalTasks.filter(t => t.status === 'todo' && t.priority >= 3 && !usedTaskIds.has(t.id))
  for (const t of highPriTodos.slice(0, 3 - priorities.length)) {
    priorities.push({
      title: t.title,
      reason: 'urgent',
      detail: `Priority ${t.priority} task in ${t.projectName} — ${daysBetween(new Date(t.createdAt), now)} days old`,
      projectName: t.projectName,
      taskId: t.id,
    })
    usedTaskIds.add(t.id)
  }

  // 3. Fill remaining slots with oldest open todos (they've been waiting)
  if (priorities.length < 3) {
    const oldest = ctx.globalTasks
      .filter(t => !usedTaskIds.has(t.id) && t.status === 'todo')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    for (const t of oldest.slice(0, 3 - priorities.length)) {
      priorities.push({
        title: t.title,
        reason: 'aging',
        detail: `Open for ${daysBetween(new Date(t.createdAt), now)} days in ${t.projectName}`,
        projectName: t.projectName,
        taskId: t.id,
      })
      usedTaskIds.add(t.id)
    }
  }

  // 4. If still empty (no tasks at all), suggest project-level actions
  if (priorities.length === 0) {
    const activeProjects = ctx.projects.filter(p => p.taskCounts.todo + p.taskCounts.in_progress > 0)
    if (activeProjects.length > 0) {
      for (const p of activeProjects.slice(0, 3)) {
        priorities.push({
          title: `Work on ${p.name}`,
          reason: 'momentum',
          detail: `${p.taskCounts.todo} todo and ${p.taskCounts.in_progress} in-progress tasks waiting`,
          projectName: p.name,
        })
      }
    } else if (ctx.projects.length > 0) {
      // No tasks anywhere — suggest reviewing projects
      priorities.push({
        title: 'Review your projects and add tasks',
        reason: 'quickwin',
        detail: `You have ${ctx.projects.length} project${ctx.projects.length > 1 ? 's' : ''} but no open tasks — add some to get started`,
        projectName: ctx.projects[0].name,
      })
    }
  }

  // ── Attention ─────────────────────────────────────────────────────────
  const attention: BriefingSynthesis['attention'] = []

  // Stale projects (no activity in 7+ days with open tasks)
  for (const p of ctx.projects) {
    if (p.lastOpened) {
      const daysSince = daysBetween(new Date(p.lastOpened), now)
      const openTasks = p.taskCounts.todo + p.taskCounts.in_progress
      if (daysSince > 7 && openTasks > 0) {
        attention.push({
          title: `${p.name} — ${daysSince}d inactive`,
          type: 'stale_project',
          detail: `${openTasks} open task${openTasks > 1 ? 's' : ''} and no activity in ${daysSince} days`,
          projectName: p.name,
        })
      }
    }
  }

  // Tasks stuck in-progress > 5 days (that weren't already in priorities)
  for (const p of ctx.projects) {
    for (const t of p.stuckTasks) {
      if (t.status === 'in_progress' && !usedTaskIds.has(t.id)) {
        const age = daysBetween(new Date(t.updatedAt || t.createdAt), now)
        if (age > 5) {
          attention.push({
            title: `"${t.title}" stuck for ${age}d`,
            type: 'stuck_task',
            detail: `In-progress since ${relativeTime(new Date(t.updatedAt || t.createdAt), now)} in ${p.name}`,
            projectName: p.name,
            taskId: t.id,
          })
        }
      }
    }
  }

  // Unlinked emails (recent emails not connected to any task)
  for (const e of ctx.recentEmails.filter(e => !e.taskId).slice(0, 2)) {
    attention.push({
      title: `Email: "${truncate(e.subject, 50)}"`,
      type: 'email',
      detail: `From ${e.from} — not linked to any task`,
      projectName: e.projectName || 'Unknown',
    })
  }

  // Too many in-progress tasks (overloaded)
  const totalInProgress = ctx.globalTasks.filter(t => t.status === 'in_progress').length
  if (totalInProgress > 5) {
    attention.push({
      title: `${totalInProgress} tasks in-progress`,
      type: 'overdue',
      detail: 'Consider completing or de-prioritizing some — too much WIP slows everything down',
      projectName: 'All Projects',
    })
  }

  // ── Quick Wins ────────────────────────────────────────────────────────
  // Low-priority todos not already used
  const quickWins = ctx.globalTasks
    .filter(t => t.status === 'todo' && !usedTaskIds.has(t.id))
    .slice(0, 4)
    .map(t => ({
      title: t.title,
      detail: `In ${t.projectName} — P${t.priority} task`,
      projectName: t.projectName,
      taskId: t.id,
    }))

  // ── Recap ─────────────────────────────────────────────────────────────
  const highlights: string[] = []
  for (const t of ctx.recentCompletedTasks.slice(0, 3)) {
    highlights.push(`Completed "${truncate(t.title, 40)}" in ${t.projectName}`)
  }
  if (ctx.recentSessionStats.count > 0 && highlights.length === 0) {
    highlights.push(`${ctx.recentSessionStats.count} coding session${ctx.recentSessionStats.count > 1 ? 's' : ''} in the last 24h`)
  }

  return {
    priorities,
    attention: attention.slice(0, 5),
    quickWins,
    recap: {
      sessionsCount: ctx.recentSessionStats.count,
      tokensUsed: ctx.recentSessionStats.totalInputTokens + ctx.recentSessionStats.totalOutputTokens,
      tasksCompleted: ctx.recentCompletedTasks.length,
      highlights,
    },
  }
}

// ─── RSS/News (Tech Pulse — optional) ────────────────────────────────────────

interface RawNewsItem {
  title: string
  url: string
  source: string
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

function parseRSSItems(xml: string, source: string): RawNewsItem[] {
  const items: RawNewsItem[] = []
  const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []
  for (const block of rssItems.slice(0, 10)) {
    const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim()
    const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim()
    if (title && link) {
      items.push({ title: decodeEntities(title), url: link, source })
    }
  }
  if (items.length === 0) {
    const atomEntries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []
    for (const block of atomEntries.slice(0, 10)) {
      const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim()
      const link = block.match(/<link[^>]*href="([^"]+)"/i)?.[1]?.trim()
      if (title && link) {
        items.push({ title: decodeEntities(title), url: link, source })
      }
    }
  }
  return items
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CodeFire/1.0' },
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchRSSFeed(feedUrl: string): Promise<RawNewsItem[]> {
  try {
    const res = await fetchWithTimeout(feedUrl)
    if (!res.ok) return []
    const xml = await res.text()
    const domain = new URL(feedUrl).hostname.replace(/^www\./, '')
    const sourceName = domain.split('.')[0]
    const prettySource = sourceName.charAt(0).toUpperCase() + sourceName.slice(1)
    return parseRSSItems(xml, prettySource)
  } catch {
    return []
  }
}

async function fetchRedditPosts(subreddit: string): Promise<RawNewsItem[]> {
  try {
    const res = await fetchWithTimeout(`https://www.reddit.com/r/${subreddit}/hot.json?limit=10`)
    if (!res.ok) return []
    const json = await res.json() as {
      data?: { children?: Array<{ data: { title: string; url: string; permalink: string; is_self: boolean } }> }
    }
    const posts = json.data?.children ?? []
    return posts.map((p) => ({
      title: p.data.title,
      url: p.data.is_self ? `https://reddit.com${p.data.permalink}` : p.data.url,
      source: `r/${subreddit}`,
    }))
  } catch {
    return []
  }
}

async function fetchTechPulse(config: ReturnType<typeof readConfig>): Promise<RawNewsItem[]> {
  const rssFeeds = config.briefingRSSFeeds || []
  const subreddits = config.briefingSubreddits || []

  const fetches = [
    ...rssFeeds.map((url) => fetchRSSFeed(url)),
    ...subreddits.map((sub) => fetchRedditPosts(sub)),
  ]

  const results = await Promise.allSettled(fetches)
  const rawItems: RawNewsItem[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') rawItems.push(...r.value)
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  return rawItems.filter((item) => {
    if (seen.has(item.url)) return false
    seen.add(item.url)
    return true
  }).slice(0, 30)
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

export function registerBriefingHandlers(db: Database.Database) {
  ipcMain.handle('briefing:listDigests', () => {
    return db
      .prepare('SELECT * FROM briefingDigests ORDER BY generatedAt DESC LIMIT 20')
      .all()
  })

  ipcMain.handle('briefing:getDigest', (_e, id: number) => {
    return db
      .prepare('SELECT * FROM briefingDigests WHERE id = ?')
      .get(id)
  })

  ipcMain.handle('briefing:getItems', (_e, digestId: number) => {
    return db
      .prepare('SELECT * FROM briefingItems WHERE digestId = ? ORDER BY relevanceScore DESC')
      .all(digestId)
  })

  ipcMain.handle('briefing:generate', async (_e, projectId?: string) => {
    const config = readConfig()
    const now = new Date().toISOString()
    // If a specific project ID is passed (not __global__), scope the briefing
    const scopeProjectId = projectId && projectId !== '__global__' ? projectId : undefined

    // Create placeholder digest
    const result = db
      .prepare('INSERT INTO briefingDigests (generatedAt, itemCount, status) VALUES (?, 0, ?)')
      .run(now, 'generating')

    const digestId = result.lastInsertRowid as number

    try {
      // 1. Gather all work context from the database
      console.log('[Briefing] Gathering work context...', scopeProjectId ? `(project: ${scopeProjectId})` : '(global)')
      const ctx = gatherWorkContext(db, scopeProjectId)
      console.log('[Briefing] Context:', ctx.projects.length, 'projects,', ctx.globalTasks.length, 'tasks,', ctx.recentEmails.length, 'emails')

      // 2. Synthesize with AI or build fallback
      let briefing: BriefingSynthesis | null = null
      if (config.openRouterKey) {
        console.log('[Briefing] Synthesizing with AI...')
        briefing = await synthesizeWithAI(ctx, config.openRouterKey, config.chatModel || 'google/gemini-2.5-flash')
        console.log('[Briefing] AI result:', briefing ? `${briefing.priorities.length}P/${briefing.attention.length}A/${briefing.quickWins.length}Q` : 'null (using fallback)')
      }
      if (!briefing) {
        console.log('[Briefing] Building fallback briefing...')
        try {
          briefing = buildFallbackBriefing(ctx)
          console.log('[Briefing] Fallback result:', `${briefing.priorities.length}P/${briefing.attention.length}A/${briefing.quickWins.length}Q`)
        } catch (fallbackErr) {
          console.error('[Briefing] Even fallback failed:', fallbackErr)
          // Last resort: minimal briefing so something always renders
          briefing = {
            priorities: [{
              title: 'Check your projects',
              reason: 'momentum',
              detail: `You have ${ctx.projects.length} project${ctx.projects.length !== 1 ? 's' : ''} tracked in CodeFire`,
              projectName: ctx.projects[0]?.name || 'Unknown',
            }],
            attention: [],
            quickWins: [],
            recap: { sessionsCount: 0, tokensUsed: 0, tasksCompleted: 0, highlights: [] },
          }
        }
      }

      // 3. Optionally fetch tech news (don't let this block the briefing)
      let techPulseItems: RawNewsItem[] = []
      try {
        if ((config.briefingRSSFeeds?.length ?? 0) > 0 || (config.briefingSubreddits?.length ?? 0) > 0) {
          techPulseItems = await fetchTechPulse(config)
          console.log('[Briefing] Tech pulse:', techPulseItems.length, 'items')
        }
      } catch (err) {
        console.error('[Briefing] Tech pulse fetch failed (non-fatal):', err)
      }

      // 4. Store everything as briefingItems
      const insertStmt = db.prepare(
        `INSERT INTO briefingItems (digestId, title, summary, category, sourceUrl, sourceName, publishedAt, relevanceScore, isSaved, isRead)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
      )

      const insertAll = db.transaction(() => {
        // Priorities (category = 'priorities')
        for (const [i, item] of briefing!.priorities.entries()) {
          insertStmt.run(
            digestId,
            item.title,
            JSON.stringify({ reason: item.reason, detail: item.detail, taskId: item.taskId }),
            'priorities',
            '', // no URL
            item.projectName,
            now,
            1.0 - i * 0.1 // highest relevance
          )
        }

        // Attention (category = 'attention')
        for (const [i, item] of briefing!.attention.entries()) {
          insertStmt.run(
            digestId,
            item.title,
            JSON.stringify({ type: item.type, detail: item.detail, taskId: item.taskId }),
            'attention',
            '',
            item.projectName,
            now,
            0.8 - i * 0.05
          )
        }

        // Quick wins (category = 'quickwins')
        for (const [i, item] of briefing!.quickWins.entries()) {
          insertStmt.run(
            digestId,
            item.title,
            JSON.stringify({ detail: item.detail, taskId: item.taskId }),
            'quickwins',
            '',
            item.projectName,
            now,
            0.7 - i * 0.05
          )
        }

        // Recap (category = 'recap', single item with JSON payload)
        insertStmt.run(
          digestId,
          'Daily Recap',
          JSON.stringify(briefing!.recap),
          'recap',
          '',
          '',
          now,
          0.5
        )

        // Tech Pulse (category = 'techpulse')
        for (const [i, item] of techPulseItems.slice(0, 8).entries()) {
          insertStmt.run(
            digestId,
            item.title,
            '',
            'techpulse',
            item.url,
            item.source,
            now,
            0.4 - i * 0.02
          )
        }
      })
      insertAll()

      // Count total items
      const totalItems = briefing.priorities.length + briefing.attention.length +
        briefing.quickWins.length + 1 + Math.min(techPulseItems.length, 8)

      console.log('[Briefing] Inserted', totalItems, 'items for digest', digestId)
      db.prepare('UPDATE briefingDigests SET itemCount = ?, status = ? WHERE id = ?')
        .run(totalItems, 'ready', digestId)
    } catch (err) {
      console.error('[Briefing] Generation FAILED:', err)
      db.prepare('UPDATE briefingDigests SET status = ? WHERE id = ?').run('ready', digestId)
    }

    return db.prepare('SELECT * FROM briefingDigests WHERE id = ?').get(digestId)
  })

  ipcMain.handle('briefing:markRead', (_e, itemId: number) => {
    db.prepare('UPDATE briefingItems SET isRead = 1 WHERE id = ?').run(itemId)
  })

  ipcMain.handle('briefing:saveItem', (_e, itemId: number) => {
    db.prepare('UPDATE briefingItems SET isSaved = CASE WHEN isSaved = 1 THEN 0 ELSE 1 END WHERE id = ?').run(itemId)
  })
}

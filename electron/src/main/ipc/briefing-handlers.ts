import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { readConfig } from '../services/ConfigStore'

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const FETCH_TIMEOUT_MS = 15_000

interface RawNewsItem {
  title: string
  url: string
  source: string
}

// ─── Feed Fetching ────────────────────────────────────────────────────────────

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

/**
 * Parse RSS/Atom feed XML into news items (simple regex parser, no dependency).
 */
function parseRSSItems(xml: string, source: string): RawNewsItem[] {
  const items: RawNewsItem[] = []

  // Try RSS <item> elements
  const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []
  for (const block of rssItems.slice(0, 10)) {
    const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim()
    const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim()
    if (title && link) {
      items.push({ title: decodeEntities(title), url: link, source })
    }
  }

  // Try Atom <entry> elements if no RSS items found
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

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

async function fetchRSSFeed(feedUrl: string): Promise<RawNewsItem[]> {
  try {
    const res = await fetchWithTimeout(feedUrl)
    if (!res.ok) return []
    const xml = await res.text()
    // Derive source name from domain
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
      source: 'Reddit',
    }))
  } catch {
    return []
  }
}

// ─── AI Synthesis ─────────────────────────────────────────────────────────────

interface SynthesizedItem {
  title: string
  summary: string
  category: string
  sourceUrl: string
  sourceName: string
  relevanceScore: number
}

async function synthesizeWithAI(
  rawItems: RawNewsItem[],
  apiKey: string,
  model: string
): Promise<SynthesizedItem[]> {
  if (rawItems.length === 0) return []

  const itemsList = rawItems
    .map((item, i) => `${i + 1}. [${item.source}] ${item.title} — ${item.url}`)
    .join('\n')

  const prompt = `You are a tech news curator for a software developer. Given these raw news items, select the top 12 most relevant and interesting items for a developer who works with AI coding tools.

For each selected item, output a JSON array with objects having these fields:
- title: concise headline (clean up if needed)
- summary: 1-2 sentence summary explaining why this matters to a developer
- category: one of "ai", "dev", "tech", "security", "business", "other"
- sourceUrl: the original URL
- sourceName: the source name
- relevanceScore: 0.0-1.0 relevance score

Raw items:
${itemsList}

Respond ONLY with a valid JSON array, no markdown fences or extra text.`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
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
      return fallbackItems(rawItems)
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const content = json.choices?.[0]?.message?.content?.trim() ?? ''
    // Strip markdown fences if present
    const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as SynthesizedItem[]
    if (!Array.isArray(parsed)) return fallbackItems(rawItems)
    return parsed
  } catch (err) {
    console.error('Briefing AI synthesis failed:', err)
    return fallbackItems(rawItems)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * If AI synthesis fails, create basic items from raw news.
 */
function fallbackItems(rawItems: RawNewsItem[]): SynthesizedItem[] {
  return rawItems.slice(0, 12).map((item, i) => ({
    title: item.title,
    summary: '',
    category: 'tech',
    sourceUrl: item.url,
    sourceName: item.source,
    relevanceScore: Math.max(0.3, 1 - i * 0.05),
  }))
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

  ipcMain.handle('briefing:generate', async (_e, _projectId: string) => {
    const config = readConfig()

    // Create a new digest record
    const now = new Date().toISOString()
    const result = db
      .prepare('INSERT INTO briefingDigests (generatedAt, itemCount, status) VALUES (?, 0, ?)')
      .run(now, 'generating')

    const digestId = result.lastInsertRowid as number

    try {
      // Fetch from all configured sources in parallel
      const rssFeeds = config.briefingRSSFeeds || []
      const subreddits = config.briefingSubreddits || []

      const fetches = [
        ...rssFeeds.map((url) => fetchRSSFeed(url)),
        ...subreddits.map((sub) => fetchRedditPosts(sub)),
      ]

      const results = await Promise.allSettled(fetches)
      const rawItems: RawNewsItem[] = []
      for (const r of results) {
        if (r.status === 'fulfilled') {
          rawItems.push(...r.value)
        }
      }

      // Deduplicate by URL
      const seen = new Set<string>()
      const unique = rawItems.filter((item) => {
        if (seen.has(item.url)) return false
        seen.add(item.url)
        return true
      })

      // Synthesize with AI or fall back to raw items
      let items: SynthesizedItem[]
      if (config.openRouterKey && unique.length > 0) {
        items = await synthesizeWithAI(unique, config.openRouterKey, config.chatModel || 'google/gemini-2.5-flash')
      } else {
        items = fallbackItems(unique)
      }

      // Insert items into database
      const insertStmt = db.prepare(
        `INSERT INTO briefingItems (digestId, title, summary, category, sourceUrl, sourceName, publishedAt, relevanceScore, isSaved, isRead)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
      )

      const insertAll = db.transaction(() => {
        for (const item of items) {
          insertStmt.run(
            digestId,
            item.title,
            item.summary || '',
            item.category || 'other',
            item.sourceUrl || '',
            item.sourceName || 'Unknown',
            now,
            item.relevanceScore ?? 0.5
          )
        }
      })
      insertAll()

      // Update digest with final count and status
      db.prepare('UPDATE briefingDigests SET itemCount = ?, status = ? WHERE id = ?')
        .run(items.length, 'ready', digestId)
    } catch (err) {
      console.error('Briefing generation failed:', err)
      // Mark as ready even on error so UI doesn't get stuck
      db.prepare('UPDATE briefingDigests SET status = ? WHERE id = ?').run('ready', digestId)
    }

    return db.prepare('SELECT * FROM briefingDigests WHERE id = ?').get(digestId)
  })

  ipcMain.handle('briefing:markRead', (_e, itemId: number) => {
    db.prepare('UPDATE briefingItems SET isRead = 1 WHERE id = ?').run(itemId)
  })

  ipcMain.handle('briefing:saveItem', (_e, itemId: number) => {
    db.prepare('UPDATE briefingItems SET isSaved = 1 WHERE id = ?').run(itemId)
  })
}

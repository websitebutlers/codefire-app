import type { Session } from '@shared/models'

/**
 * Strip system/XML tags that may be present in stored summaries.
 * Older sessions may have summaries with embedded system tags from
 * Claude Code JSONL user messages.
 */
function cleanSummaryText(raw: string): string {
  return raw
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract the topic (first user message text) from a session summary.
 * Returns null if no meaningful topic is found.
 */
export function getSessionTopic(session: Session): string | null {
  if (!session.summary) return null
  const pipeIdx = session.summary.indexOf(' | Files:')
  const rawTopic = pipeIdx > 0 ? session.summary.slice(0, pipeIdx) : session.summary
  const topic = cleanSummaryText(rawTopic)
  return topic.length > 0 ? topic : null
}

/**
 * Derives a human-readable display name for a session.
 *
 * Fallback chain:
 * 1. AI-generated title (set by the AI Summary action)
 * 2. Topic from summary (first user message, before " | Files:")
 * 3. GitHub PR title (if a PR exists for the session's branch)
 * 4. Git branch name (formatted)
 * 5. Slug or truncated session ID
 */
export function getSessionDisplayName(
  session: Session,
  maxLength = 60,
  prTitle?: string
): string {
  // 1. Prefer the AI-generated title if available
  if (session.title) {
    return session.title.length > maxLength ? session.title.slice(0, maxLength - 1) + '…' : session.title
  }

  // 2. Try to extract topic from summary (the first user message)
  const topic = getSessionTopic(session)
  if (topic) {
    return topic.length > maxLength ? topic.slice(0, maxLength - 1) + '…' : topic
  }

  // 3. Use GitHub PR title if available for this branch
  if (prTitle) {
    return prTitle.length > maxLength ? prTitle.slice(0, maxLength - 1) + '…' : prTitle
  }

  // 4. Use git branch as a hint
  if (session.gitBranch) {
    return session.gitBranch
  }

  // 5. Fall back to slug or truncated ID
  return session.slug || session.id.slice(0, 8)
}

/**
 * Format a start time as a short time string (e.g. "9:42 AM").
 */
export function formatStartTime(startedAt: string | null): string {
  if (!startedAt) return ''
  try {
    return new Date(startedAt).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/**
 * Get the branch label to display — PR title preferred, else branch name.
 */
export function getBranchLabel(
  session: Session,
  prTitle?: string
): string | null {
  if (prTitle) return prTitle
  return session.gitBranch || null
}

/**
 * Abbreviate a model name for compact display.
 * e.g. "claude-sonnet-4-6-20250514" → "Sonnet 4.6"
 */
export function abbreviateModel(model: string | null): string {
  if (!model) return 'unknown'
  const m = model.toLowerCase()
  if (m.includes('opus')) {
    const ver = m.match(/opus-(\d+)-(\d+)/)?.[0]
    return ver ? `Opus ${ver.replace('opus-', '').replace('-', '.')}` : 'Opus'
  }
  if (m.includes('sonnet')) {
    const ver = m.match(/sonnet-(\d+)-(\d+)/)?.[0]
    return ver ? `Sonnet ${ver.replace('sonnet-', '').replace('-', '.')}` : 'Sonnet'
  }
  if (m.includes('haiku')) {
    const ver = m.match(/haiku-(\d+)-(\d+)/)?.[0]
    return ver ? `Haiku ${ver.replace('haiku-', '').replace('-', '.')}` : 'Haiku'
  }
  return model.slice(0, 12)
}

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
 * Derives a human-readable display name for a session.
 *
 * Fallback chain:
 * 1. Topic from summary (first user message, before " | Files:")
 * 2. Git branch name (formatted)
 * 3. Slug or truncated session ID
 */
export function getSessionDisplayName(session: Session, maxLength = 60): string {
  // 1. Try to extract topic from summary (the first user message)
  if (session.summary) {
    const pipeIdx = session.summary.indexOf(' | Files:')
    const rawTopic = pipeIdx > 0 ? session.summary.slice(0, pipeIdx) : session.summary
    const topic = cleanSummaryText(rawTopic)
    if (topic.length > 0) {
      return topic.length > maxLength ? topic.slice(0, maxLength - 1) + '…' : topic
    }
  }

  // 2. Use git branch as a hint
  if (session.gitBranch) {
    return session.gitBranch
  }

  // 3. Fall back to slug or truncated ID
  return session.slug || session.id.slice(0, 8)
}

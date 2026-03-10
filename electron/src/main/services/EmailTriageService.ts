// ─── Email Triage Service ───────────────────────────────────────────────────
//
// AI-powered email classification using Claude CLI.
// Matches Swift's EmailTriageService — sends batch of emails to Claude for
// categorization with triage types, priority, and suggested task titles.
//
// Falls back gracefully if Claude CLI is not found (returns null for all).
//

import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import fs from 'fs'

const execFileAsync = promisify(execFile)

export type TriageType = 'task' | 'question' | 'calendar' | 'fyi'

export interface EmailTriageResult {
  index: number
  actionable: boolean
  title: string
  description: string
  priority: number // 0-4
  type: TriageType
}

interface EmailForTriage {
  from: string
  subject: string
  body: string
}

/**
 * Find the Claude CLI binary on the system.
 * Checks common installation paths.
 */
function findClaudeBinary(): string | null {
  const home = os.homedir()
  const isWin = process.platform === 'win32'

  const candidates = isWin
    ? [
        'claude.cmd',
        'claude.exe',
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        path.join(home, '.volta', 'bin', 'claude.exe'),
      ]
    : [
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        path.join(home, '.npm', 'bin', 'claude'),
        path.join(home, '.local', 'bin', 'claude'),
        path.join(home, '.nvm', 'current', 'bin', 'claude'),
        path.join(home, '.volta', 'bin', 'claude'),
      ]

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      // skip
    }
  }

  // Try which/where as fallback
  try {
    const cmd = isWin ? 'where' : 'which'
    const { stdout } = require('child_process').execFileSync(cmd, ['claude'], {
      timeout: 3000,
      encoding: 'utf-8',
    }) as { stdout: string }
    const found = stdout.trim().split('\n')[0]
    if (found && fs.existsSync(found)) return found
  } catch {
    // not found
  }

  return null
}

/**
 * Classify a batch of emails using Claude CLI.
 *
 * Returns an array of results parallel to the input.
 * Non-actionable emails get null.
 */
export async function triageEmails(
  emails: EmailForTriage[]
): Promise<(EmailTriageResult | null)[]> {
  if (emails.length === 0) return []

  const claudeBin = findClaudeBinary()
  if (!claudeBin) {
    console.warn('[EmailTriage] Claude CLI not found — skipping AI classification')
    return emails.map(() => null)
  }

  // Build the prompt
  const emailList = emails
    .map((e, i) => {
      const body = e.body.slice(0, 1500)
      return `--- Email ${i + 1} ---\nFrom: ${e.from}\nSubject: ${e.subject}\n\n${body}`
    })
    .join('\n\n')

  const prompt = `You are an email triage assistant. Classify each email below.

For each email, return a JSON object with:
- "index": the email number (1-based)
- "actionable": boolean — true if this requires human action
- "title": a short action item title (under 80 chars) if actionable
- "description": 1-2 sentence context about what needs to be done
- "priority": 0-4 (0=none, 1=low, 2=medium, 3=high, 4=urgent)
- "type": one of "task" (actionable request), "question" (needs answer), "calendar" (scheduling), "fyi" (informational/newsletter)

Return a JSON array with one entry per email. Non-actionable emails should have actionable=false, type="fyi", priority=0.

${emailList}

Return ONLY valid JSON. No markdown, no explanation.`

  try {
    const { stdout } = await execFileAsync(claudeBin, ['-p', '--output-format', 'text'], {
      input: prompt,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    } as unknown as Parameters<typeof execFileAsync>[2])

    // Clean response — strip markdown code blocks if present
    let json = String(stdout).trim()
    if (json.startsWith('```')) {
      json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    }

    const results = JSON.parse(json) as EmailTriageResult[]

    // Map to parallel array
    return emails.map((_, i) => {
      const result = results.find((r) => r.index === i + 1)
      if (!result || !result.actionable) return null
      return result
    })
  } catch (err) {
    console.error('[EmailTriage] Claude classification failed:', err)
    return emails.map(() => null)
  }
}

/**
 * Get the matched whitelist rule for an email.
 * Returns the highest-priority matching rule, or null.
 */
export function findMatchingRule(
  senderEmail: string,
  subject: string,
  rules: { pattern: string; priority: number; clientId: string | null; isActive: number }[]
): { priority: number; clientId: string | null } | null {
  const email = senderEmail.toLowerCase()
  const domain = email.includes('@') ? '@' + email.split('@')[1] : ''

  for (const rule of rules) {
    if (!rule.isActive) continue
    const pattern = rule.pattern.trim().toLowerCase()

    if (pattern.startsWith('subject:')) {
      const keyword = pattern.slice('subject:'.length).trim()
      if (keyword && subject.toLowerCase().includes(keyword)) {
        return { priority: rule.priority, clientId: rule.clientId }
      }
    } else if (pattern.startsWith('@')) {
      if (domain === pattern) {
        return { priority: rule.priority, clientId: rule.clientId }
      }
    } else if (email === pattern) {
      return { priority: rule.priority, clientId: rule.clientId }
    }
  }

  return null
}

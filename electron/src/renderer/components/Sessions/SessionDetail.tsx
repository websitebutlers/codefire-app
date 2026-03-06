import { useState } from 'react'
import {
  Hash,
  Clock,
  Cpu,
  GitBranch,
  FileCode,
  MessageSquare,
  Wrench,
  Play,
  Sparkles,
  ListTodo,
  Loader2,
  Check,
} from 'lucide-react'
import type { Session } from '@shared/models'
import { api } from '@renderer/lib/api'
import {
  calculateSessionCost,
  formatCost,
  formatDuration,
  formatTokens,
} from '@renderer/hooks/useSessions'
import CostBadge from './CostBadge'

interface SessionDetailProps {
  session: Session | null
}

async function getApiKey(): Promise<string | null> {
  try {
    const config = (await window.api.invoke('settings:get')) as { openRouterKey?: string } | undefined
    return config?.openRouterKey || null
  } catch {
    return null
  }
}

async function callAI(prompt: string, systemPrompt: string): Promise<string> {
  const apiKey = await getApiKey()
  if (!apiKey) throw new Error('OpenRouter API key not configured. Set it in Settings > Engine.')

  const config = (await window.api.invoke('settings:get')) as { chatModel?: string } | undefined
  const model = config?.chatModel || 'google/gemini-3.1-pro-preview'

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2000,
    }),
  })

  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

export default function SessionDetail({ session }: SessionDetailProps) {
  const [resuming, setResuming] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractResult, setExtractResult] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Select a session to view details
      </div>
    )
  }

  const cost = calculateSessionCost(session)
  const filesChanged = session.filesChanged
    ? (() => {
        try {
          return JSON.parse(session.filesChanged) as string[]
        } catch {
          return session.filesChanged.split(',').map((s) => s.trim())
        }
      })()
    : []

  async function handleResume() {
    if (!session) return
    setResuming(true)
    try {
      const config = (await window.api.invoke('settings:get')) as
        | { preferredCLI?: string }
        | undefined
      const cli = config?.preferredCLI ?? 'claude'
      const command = cli === 'claude'
        ? `claude --resume ${session.id}`
        : `${cli} --resume ${session.id}`
      window.api.send('terminal:writeToActive', command + '\n')
    } catch (err) {
      console.error('Failed to resume session:', err)
    } finally {
      setTimeout(() => setResuming(false), 500)
    }
  }

  async function handleSummarize() {
    if (!session) return
    setSummarizing(true)
    setAiError(null)
    try {
      const sessionInfo = [
        `Session: ${session.slug || session.id}`,
        `Model: ${session.model || 'unknown'}`,
        `Branch: ${session.gitBranch || 'unknown'}`,
        `Messages: ${session.messageCount}, Tool uses: ${session.toolUseCount}`,
        `Duration: ${formatDuration(session.startedAt, session.endedAt)}`,
        `Cost: ${formatCost(cost)}`,
        filesChanged.length > 0 ? `Files changed: ${filesChanged.join(', ')}` : '',
        session.summary ? `Existing summary: ${session.summary}` : '',
      ].filter(Boolean).join('\n')

      const summary = await callAI(
        sessionInfo,
        'You are a coding assistant. Summarize this AI coding session in 2-3 concise sentences. Focus on what was accomplished, key changes, and outcomes. Be specific about files and features.'
      )

      await api.sessions.update(session.id, { summary })
      // Update local state by triggering a re-read
      session.summary = summary
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to generate summary')
    } finally {
      setSummarizing(false)
    }
  }

  async function handleExtractTasks() {
    if (!session) return
    setExtracting(true)
    setAiError(null)
    setExtractResult(null)
    try {
      const sessionInfo = [
        `Session: ${session.slug || session.id}`,
        `Model: ${session.model || 'unknown'}`,
        `Branch: ${session.gitBranch || 'unknown'}`,
        `Messages: ${session.messageCount}, Tool uses: ${session.toolUseCount}`,
        filesChanged.length > 0 ? `Files changed:\n${filesChanged.map(f => `  - ${f}`).join('\n')}` : '',
        session.summary ? `Summary: ${session.summary}` : '',
      ].filter(Boolean).join('\n')

      const result = await callAI(
        sessionInfo,
        `You are a coding assistant. Based on this AI coding session, extract follow-up tasks that should be done next. Return ONLY a JSON array of objects with "title" and "description" fields. Example: [{"title":"Add tests for auth module","description":"The auth module was modified but no tests were added."}]. Return an empty array if no tasks are needed.`
      )

      // Parse tasks from AI response
      const jsonMatch = result.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        setExtractResult('No tasks extracted')
        return
      }

      const tasks = JSON.parse(jsonMatch[0]) as { title: string; description?: string }[]
      let created = 0
      for (const task of tasks) {
        if (task.title) {
          await api.tasks.create({
            projectId: session.projectId,
            title: task.title,
            description: task.description || '',
            priority: 2,
            source: 'ai-extracted',
          })
          created++
        }
      }
      setExtractResult(`Created ${created} task${created !== 1 ? 's' : ''}`)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to extract tasks')
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className="p-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-title text-neutral-100 font-medium">
            {session.slug || session.id.slice(0, 12)}
          </h2>
          <CostBadge cost={cost} />
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Hash size={12} />
          <span className="font-mono">{session.id.slice(0, 16)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={handleResume}
          disabled={resuming}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-cf
                     bg-codefire-orange/10 border border-codefire-orange/20
                     text-codefire-orange text-xs font-medium
                     hover:bg-codefire-orange/15 transition-colors disabled:opacity-50"
        >
          <Play size={12} />
          {resuming ? 'Resuming...' : 'Resume'}
        </button>
        <button
          onClick={handleSummarize}
          disabled={summarizing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-cf
                     bg-purple-500/10 border border-purple-500/20
                     text-purple-400 text-xs font-medium
                     hover:bg-purple-500/15 transition-colors disabled:opacity-50"
        >
          {summarizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          AI Summary
        </button>
        <button
          onClick={handleExtractTasks}
          disabled={extracting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-cf
                     bg-blue-500/10 border border-blue-500/20
                     text-blue-400 text-xs font-medium
                     hover:bg-blue-500/15 transition-colors disabled:opacity-50"
        >
          {extracting ? <Loader2 size={12} className="animate-spin" /> : <ListTodo size={12} />}
          Extract Tasks
        </button>
      </div>

      {/* AI error/result messages */}
      {aiError && (
        <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
          {aiError}
        </div>
      )}
      {extractResult && (
        <div className="mb-4 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded text-xs text-green-400 flex items-center gap-1.5">
          <Check size={12} />
          {extractResult}
        </div>
      )}

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <MetaItem icon={<Cpu size={14} />} label="Model" value={session.model || 'unknown'} />
        <MetaItem
          icon={<Clock size={14} />}
          label="Duration"
          value={formatDuration(session.startedAt, session.endedAt)}
        />
        <MetaItem
          icon={<GitBranch size={14} />}
          label="Branch"
          value={session.gitBranch || '--'}
        />
        <MetaItem
          icon={<MessageSquare size={14} />}
          label="Messages"
          value={String(session.messageCount)}
        />
        <MetaItem
          icon={<Wrench size={14} />}
          label="Tool Uses"
          value={String(session.toolUseCount)}
        />
        <MetaItem
          icon={<Clock size={14} />}
          label="Started"
          value={
            session.startedAt
              ? new Date(session.startedAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })
              : '--'
          }
        />
      </div>

      {/* Token Breakdown */}
      <div className="bg-neutral-800/50 rounded-cf border border-neutral-700/50 p-3 mb-4">
        <h3 className="text-sm text-neutral-300 font-medium mb-2">Token Breakdown</h3>
        <div className="grid grid-cols-2 gap-2">
          <TokenBar label="Input" value={session.inputTokens} color="bg-blue-500" />
          <TokenBar label="Output" value={session.outputTokens} color="bg-emerald-500" />
          <TokenBar label="Cache Write" value={session.cacheCreationTokens} color="bg-purple-500" />
          <TokenBar label="Cache Read" value={session.cacheReadTokens} color="bg-amber-500" />
        </div>
        <div className="mt-2 pt-2 border-t border-neutral-700/50 text-xs text-neutral-400">
          Total cost: <span className="text-neutral-200 font-medium">{formatCost(cost)}</span>
        </div>
      </div>

      {/* Summary */}
      {session.summary && (
        <div className="mb-4">
          <h3 className="text-sm text-neutral-300 font-medium mb-1">Summary</h3>
          <p className="text-sm text-neutral-400 leading-relaxed">{session.summary}</p>
        </div>
      )}

      {/* Files Changed */}
      {filesChanged.length > 0 && (
        <div>
          <h3 className="text-sm text-neutral-300 font-medium mb-1">
            Files Changed ({filesChanged.length})
          </h3>
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {filesChanged.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 text-xs text-neutral-400 font-mono py-0.5"
              >
                <FileCode size={12} className="text-neutral-500 shrink-0" />
                <span className="truncate">{file}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-neutral-500 mt-0.5">{icon}</span>
      <div>
        <div className="text-xs text-neutral-500">{label}</div>
        <div className="text-sm text-neutral-300">{value}</div>
      </div>
    </div>
  )
}

function TokenBar({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xs text-neutral-500">{label}</span>
        <span className="text-xs text-neutral-300">{formatTokens(value)}</span>
      </div>
      <div className="h-1 bg-neutral-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: value > 0 ? `${Math.min(100, Math.max(5, (value / 500_000) * 100))}%` : '0%' }}
        />
      </div>
    </div>
  )
}

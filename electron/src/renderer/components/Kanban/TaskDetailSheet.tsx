import { useState, useEffect, useCallback } from 'react'
import {
  X, Calendar, Tag, MessageSquare, Send, FolderOpen,
  Sparkles, Play, ExternalLink, Bot, User, Mail, Cpu,
  Circle, ArrowUp, ArrowUpRight, Flame, AlertTriangle,
  Loader2, Paperclip, ImagePlus, Trash2,
} from 'lucide-react'
import type { TaskItem, Project, Session } from '@shared/models'
import { api } from '@renderer/lib/api'
import { useTaskNotes } from '@renderer/hooks/useTasks'

interface TaskDetailSheetProps {
  task: TaskItem | null
  onClose: () => void
  onUpdate: (
    id: number,
    data: {
      title?: string
      description?: string
      status?: string
      priority?: number
      labels?: string[]
    }
  ) => Promise<void>
  onDelete: (id: number) => Promise<void>
}

const PRIORITY_OPTIONS = [
  { value: 0, label: 'None', color: 'text-neutral-500', bg: 'bg-neutral-700', icon: Circle },
  { value: 1, label: 'Low', color: 'text-blue-400', bg: 'bg-blue-500/20', icon: ArrowUp },
  { value: 2, label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/20', icon: ArrowUpRight },
  { value: 3, label: 'High', color: 'text-orange-400', bg: 'bg-orange-500/20', icon: Flame },
  { value: 4, label: 'Urgent', color: 'text-red-400', bg: 'bg-red-500/20', icon: AlertTriangle },
]

const SOURCE_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  claude: { label: 'CLAUDE', color: 'text-orange-300', bg: 'bg-orange-500/20' },
  'ai-extracted': { label: 'AI-EXTRACTED', color: 'text-purple-300', bg: 'bg-purple-500/20' },
  manual: { label: 'MANUAL', color: 'text-neutral-300', bg: 'bg-neutral-600/50' },
  email: { label: 'EMAIL', color: 'text-blue-300', bg: 'bg-blue-500/20' },
  mcp: { label: 'MCP', color: 'text-green-300', bg: 'bg-green-500/20' },
}

const NOTE_SOURCE_ICONS: Record<string, typeof Bot> = {
  claude: Bot,
  'ai-extracted': Cpu,
  manual: User,
  email: Mail,
  mcp: Bot,
}

function parseLabels(labels: string | null): string[] {
  if (!labels) return []
  try {
    return JSON.parse(labels)
  } catch {
    return []
  }
}

function parseTags(tags: string | null): string[] {
  if (!tags) return []
  const trimmed = tags.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean)
    } catch { /* fall through */ }
  }
  return trimmed.split(',').map((t) => t.trim()).filter(Boolean)
}

export default function TaskDetailSheet({
  task,
  onClose,
  onUpdate,
  onDelete,
}: TaskDetailSheetProps) {
  const { notes, addNote } = useTaskNotes(task?.id ?? null)
  const [noteInput, setNoteInput] = useState('')
  const [sending, setSending] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [labelInput, setLabelInput] = useState('')
  const [editTitle, setEditTitle] = useState(task?.title ?? '')
  const [editDescription, setEditDescription] = useState(task?.description ?? '')
  const [enriching, setEnriching] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [linkedSession, setLinkedSession] = useState<Session | null>(null)
  const [attachments, setAttachments] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [emailContext, setEmailContext] = useState<{
    fromAddress: string
    fromName: string | null
    subject: string
    snippet: string | null
    receivedAt: string
    gmailThreadId: string
  } | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [showReplyComposer, setShowReplyComposer] = useState(false)

  // Sync local state when task changes
  useEffect(() => {
    if (task) {
      setEditTitle(task.title)
      setEditDescription(task.description ?? '')
      setAttachments(task.attachments ? JSON.parse(task.attachments) : [])
    }
  }, [task?.id, task?.title, task?.description, task?.attachments])

  // Fetch projects for the assignment dropdown
  const fetchProjects = useCallback(async () => {
    try {
      const list = await api.projects.list()
      setProjects(list)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Fetch email context if task came from Gmail
  useEffect(() => {
    if (task?.gmailMessageId) {
      api.gmail.getEmailByMessageId(task.gmailMessageId)
        .then((email) => setEmailContext(email ? {
          fromAddress: email.fromAddress,
          fromName: email.fromName,
          subject: email.subject,
          snippet: email.snippet,
          receivedAt: email.receivedAt,
          gmailThreadId: email.gmailThreadId,
        } : null))
        .catch(() => setEmailContext(null))
    } else {
      setEmailContext(null)
    }
  }, [task?.gmailMessageId])

  // Fetch linked session if sourceSession exists
  useEffect(() => {
    if (task?.sourceSession) {
      api.sessions.get(task.sourceSession).then((s) => setLinkedSession(s ?? null)).catch(() => setLinkedSession(null))
    } else {
      setLinkedSession(null)
    }
  }, [task?.sourceSession])

  if (!task) return null

  const labels = parseLabels(task.labels)
  const currentProject = projects.find((p) => p.id === task.projectId)
  const sourceBadge = SOURCE_BADGES[task.source ?? 'manual'] ?? SOURCE_BADGES.manual

  const handleAddNote = async () => {
    const content = noteInput.trim()
    if (!content || sending) return
    setSending(true)
    try {
      await addNote(content)
      setNoteInput('')
    } finally {
      setSending(false)
    }
  }

  const handleAssignProject = async (projectId: string) => {
    await window.api.invoke('tasks:update', task.id, { projectId })
    if (projectId !== '__global__') {
      await window.api.invoke('tasks:update', task.id, { isGlobal: false })
    }
  }

  const handleAddLabel = () => {
    const trimmed = labelInput.trim()
    if (!trimmed) return
    const newLabels = [...labels, trimmed]
    onUpdate(task.id, { labels: newLabels })
    setLabelInput('')
  }

  const handleRemoveLabel = (label: string) => {
    const newLabels = labels.filter((l) => l !== label)
    onUpdate(task.id, { labels: newLabels })
  }

  const handleAddAttachment = async () => {
    const updated = await api.tasks.addAttachment(task.id)
    if (updated) setAttachments(updated.attachments ? JSON.parse(updated.attachments) : [])
  }

  const handleRemoveAttachment = async (filePath: string) => {
    const updated = await api.tasks.removeAttachment(task.id, filePath)
    if (updated) setAttachments(updated.attachments ? JSON.parse(updated.attachments) : [])
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      const updated = await api.tasks.addAttachment(task.id, file.path)
      if (updated) setAttachments(updated.attachments ? JSON.parse(updated.attachments) : [])
    }
  }

  const handleEnrichDescription = async () => {
    if (enriching) return
    setEnriching(true)
    try {
      const config = (await window.api.invoke('settings:get')) as { openRouterKey?: string; chatModel?: string } | undefined
      const apiKey = config?.openRouterKey
      const model = config?.chatModel || 'anthropic/claude-sonnet-4-20250514'
      if (!apiKey) return

      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are a technical project manager. Given a task title and optional description, write a clear, actionable description (2-4 sentences). Include acceptance criteria if applicable. Return only the description text.',
            },
            {
              role: 'user',
              content: `Task: ${task.title}\n${task.description ? `Current description: ${task.description}` : 'No description yet.'}`,
            },
          ],
          max_tokens: 300,
        }),
      })
      const data = await resp.json()
      const enriched = data.choices?.[0]?.message?.content?.trim()
      if (enriched) {
        setEditDescription(enriched)
        onUpdate(task.id, { description: enriched })
      }
    } catch { /* ignore */ }
    finally { setEnriching(false) }
  }

  const handleLaunchSession = async () => {
    if (launching) return
    setLaunching(true)
    try {
      const config = (await window.api.invoke('settings:get')) as { preferredCLI?: string } | undefined
      const cli = config?.preferredCLI ?? 'claude'
      const escapedTitle = task.title.replace(/"/g, '\\"')
      const command = `${cli} -p "${escapedTitle}"`
      window.api.send('terminal:writeToActive', command + '\n')
    } catch { /* ignore */ }
    finally { setLaunching(false) }
  }

  return (
    <div className="w-96 border-l border-neutral-800 bg-neutral-900 flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h3 className="text-sm text-neutral-200 font-medium truncate">Task Details</h3>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${sourceBadge.bg} ${sourceBadge.color} shrink-0`}>
            {sourceBadge.label}
          </span>
        </div>
        <button
          className="text-neutral-500 hover:text-neutral-300 transition-colors ml-2"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Title */}
        <div>
          <label className="text-xs text-neutral-500 block mb-1">Title</label>
          <input
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5
                       text-sm text-neutral-200 focus:outline-none focus:border-codefire-orange/50"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => {
              const trimmed = editTitle.trim()
              if (trimmed && trimmed !== task.title) {
                onUpdate(task.id, { title: trimmed })
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
          />
        </div>

        {/* Project Assignment */}
        <div>
          <label className="text-xs text-neutral-500 block mb-1">
            <FolderOpen size={10} className="inline mr-1" />
            Project
          </label>
          <select
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5
                       text-sm text-neutral-200 focus:outline-none focus:border-codefire-orange/50"
            value={task.projectId}
            onChange={(e) => handleAssignProject(e.target.value)}
          >
            <option value="__global__">Global (Planner)</option>
            {projects.map((p) => {
              const tags = parseTags(p.tags)
              const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : ''
              return (
                <option key={p.id} value={p.id}>
                  {p.name}{tagStr}
                </option>
              )
            })}
          </select>
          {currentProject && currentProject.id !== '__global__' && (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[10px] text-neutral-500">{currentProject.name}</span>
              {parseTags(currentProject.tags).map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] px-1 py-px rounded bg-neutral-800 text-neutral-500"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Status */}
        <div>
          <label className="text-xs text-neutral-500 block mb-1">Status</label>
          <div className="flex gap-1">
            {(['todo', 'in_progress', 'done'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onUpdate(task.id, { status: s })}
                className={`flex-1 text-xs py-1.5 rounded border transition-colors ${
                  task.status === s
                    ? s === 'done'
                      ? 'bg-green-500/20 border-green-500/40 text-green-400'
                      : s === 'in_progress'
                      ? 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                      : 'bg-neutral-700 border-neutral-600 text-neutral-300'
                    : 'bg-neutral-800/50 border-neutral-700/50 text-neutral-500 hover:text-neutral-400'
                }`}
              >
                {s === 'todo' ? 'Todo' : s === 'in_progress' ? 'In Progress' : 'Done'}
              </button>
            ))}
          </div>
        </div>

        {/* Priority Picker */}
        <div>
          <label className="text-xs text-neutral-500 block mb-1">Priority</label>
          <div className="flex gap-1">
            {PRIORITY_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const isActive = task.priority === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => onUpdate(task.id, { priority: opt.value })}
                  className={`flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded border transition-colors ${
                    isActive
                      ? `${opt.bg} border-current ${opt.color}`
                      : 'bg-neutral-800/50 border-neutral-700/50 text-neutral-500 hover:text-neutral-400'
                  }`}
                  title={opt.label}
                >
                  <Icon size={12} />
                  <span className="hidden sm:inline">{opt.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Labels */}
        <div>
          <label className="text-xs text-neutral-500 block mb-1">
            <Tag size={10} className="inline mr-1" />
            Labels
          </label>
          <div className="flex flex-wrap gap-1 mb-2">
            {labels.map((label) => (
              <span
                key={label}
                className="text-xs px-2 py-0.5 rounded-full bg-neutral-700/80 text-neutral-300 border border-neutral-600/50 flex items-center gap-1"
              >
                {label}
                <button
                  onClick={() => handleRemoveLabel(label)}
                  className="text-neutral-500 hover:text-neutral-300 leading-none ml-0.5"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1
                         text-xs text-neutral-200 placeholder-neutral-500
                         focus:outline-none focus:border-codefire-orange/50"
              placeholder="Add label..."
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  handleAddLabel()
                }
              }}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-neutral-500">Description</label>
            <button
              onClick={handleEnrichDescription}
              disabled={enriching}
              className="flex items-center gap-1 text-[10px] text-codefire-orange/70 hover:text-codefire-orange transition-colors disabled:opacity-50"
              title="AI-enrich description"
            >
              {enriching ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              Enrich
            </button>
          </div>
          <textarea
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5
                       text-sm text-neutral-200 placeholder-neutral-500 leading-relaxed
                       focus:outline-none focus:border-codefire-orange/50 resize-y min-h-[60px]"
            placeholder="Add a description..."
            rows={3}
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            onBlur={() => {
              const trimmed = editDescription.trim()
              if (trimmed !== (task.description ?? '')) {
                onUpdate(task.id, { description: trimmed || undefined })
              }
            }}
          />
        </div>

        {/* Attachments */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-neutral-500">
              <Paperclip size={10} className="inline mr-1" />
              Attachments ({attachments.length})
            </label>
            <button
              onClick={handleAddAttachment}
              className="flex items-center gap-1 text-[10px] text-codefire-orange/70 hover:text-codefire-orange transition-colors"
            >
              <ImagePlus size={10} />
              Add Image
            </button>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-3 transition-colors ${
              dragOver
                ? 'border-codefire-orange/60 bg-codefire-orange/5'
                : attachments.length === 0
                ? 'border-neutral-700/50 hover:border-neutral-600/50'
                : 'border-transparent p-0'
            }`}
          >
            {attachments.length === 0 && !dragOver && (
              <p className="text-[11px] text-neutral-600 text-center">
                Drop files here or click Add Image
              </p>
            )}
            {dragOver && (
              <p className="text-[11px] text-codefire-orange/70 text-center">
                Drop to attach
              </p>
            )}

            {/* Thumbnail grid */}
            {attachments.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {attachments.map((filePath) => {
                  const fileName = filePath.split(/[/\\]/).pop() ?? filePath
                  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName)
                  return (
                    <div
                      key={filePath}
                      className="relative group w-16 h-16 rounded-md overflow-hidden bg-neutral-800 border border-neutral-700/50"
                      title={fileName}
                    >
                      {isImage ? (
                        <img
                          src={`file://${filePath}`}
                          alt={fileName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Paperclip size={16} className="text-neutral-500" />
                        </div>
                      )}
                      <button
                        onClick={() => handleRemoveAttachment(filePath)}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 text-neutral-400
                                   hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={10} />
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5
                                      opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[8px] text-neutral-300 truncate block">{fileName}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Session Link */}
        {linkedSession && (
          <div className="bg-neutral-800/50 rounded-lg p-2.5 border border-neutral-700/30">
            <label className="text-xs text-neutral-500 block mb-1.5">Linked Session</label>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <ExternalLink size={12} className="text-neutral-500 shrink-0" />
                <span className="text-xs text-neutral-300 truncate">
                  {linkedSession.slug || linkedSession.id.slice(0, 8)}
                </span>
                {linkedSession.model && (
                  <span className="text-[10px] text-neutral-500">{linkedSession.model}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Email Context */}
        {emailContext && (
          <div className="bg-blue-500/5 rounded-lg p-3 border border-blue-500/20">
            <div className="flex items-center gap-2 mb-2">
              <Mail size={14} className="text-blue-400" />
              <span className="text-xs font-medium text-blue-300">Email Context</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-start gap-2">
                <span className="text-neutral-500 shrink-0 w-12">From</span>
                <span className="text-neutral-300">
                  {emailContext.fromName || emailContext.fromAddress}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-neutral-500 shrink-0 w-12">Subject</span>
                <span className="text-neutral-300">{emailContext.subject}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-neutral-500 shrink-0 w-12">Date</span>
                <span className="text-neutral-400">
                  {new Date(emailContext.receivedAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </span>
              </div>
              {emailContext.snippet && (
                <div className="mt-2 text-neutral-400 bg-neutral-800/50 rounded p-2 text-[11px] leading-relaxed">
                  {emailContext.snippet}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2.5">
              <button
                onClick={() => {
                  window.api.invoke('shell:openExternal', `https://mail.google.com/mail/u/0/#inbox/${emailContext.gmailThreadId}`)
                }}
                className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                <ExternalLink size={10} />
                Open in Gmail
              </button>
              <button
                onClick={() => setShowReplyComposer(!showReplyComposer)}
                className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Send size={10} />
                {showReplyComposer ? 'Hide Reply' : 'Reply'}
              </button>
            </div>
            {showReplyComposer && (
              <div className="mt-2 space-y-2">
                <textarea
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  rows={3}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5
                             text-xs text-neutral-200 placeholder-neutral-500
                             focus:outline-none focus:border-blue-500/50 resize-none"
                  placeholder="Write your reply..."
                />
                <div className="flex justify-end">
                  <button
                    disabled={!replyDraft.trim()}
                    onClick={() => {
                      // Open Gmail compose with pre-filled reply
                      const subject = emailContext.subject.startsWith('Re:') ? emailContext.subject : `Re: ${emailContext.subject}`
                      const mailto = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(emailContext.fromAddress)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(replyDraft)}`
                      window.api.invoke('shell:openExternal', mailto)
                      setReplyDraft('')
                      setShowReplyComposer(false)
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] bg-blue-500/20 text-blue-400
                               hover:bg-blue-500/30 rounded transition-colors disabled:opacity-40"
                  >
                    <Send size={10} />
                    Send via Gmail
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Created date */}
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <Calendar size={12} />
          <span>
            Created{' '}
            {new Date(task.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
          {task.completedAt && (
            <>
              <span className="mx-1">·</span>
              <span className="text-green-500">
                Completed{' '}
                {new Date(task.completedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </>
          )}
        </div>

        {/* Notes Thread */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <MessageSquare size={14} className="text-neutral-500" />
            <label className="text-xs text-neutral-500">Notes ({notes.length})</label>
          </div>

          <div className="space-y-2 mb-3">
            {notes.map((note) => {
              const NoteIcon = NOTE_SOURCE_ICONS[note.source ?? 'manual'] ?? User
              return (
                <div
                  key={note.id}
                  className="bg-neutral-800/50 rounded-lg p-2.5 border border-neutral-700/30"
                >
                  <p className="text-xs text-neutral-300 whitespace-pre-wrap">{note.content}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <div className="flex items-center gap-1">
                      <NoteIcon size={10} className="text-neutral-600" />
                      <span className="text-[10px] text-neutral-600">{note.source ?? 'manual'}</span>
                    </div>
                    <span className="text-[10px] text-neutral-600">
                      {new Date(note.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Add note input */}
          <div className="flex gap-1.5">
            <input
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5
                         text-xs text-neutral-200 placeholder-neutral-500
                         focus:outline-none focus:border-codefire-orange/50"
              placeholder="Add a note..."
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  handleAddNote()
                }
              }}
              disabled={sending}
            />
            <button
              className="px-2.5 py-1.5 bg-codefire-orange/20 text-codefire-orange rounded
                         hover:bg-codefire-orange/30 transition-colors disabled:opacity-50"
              onClick={handleAddNote}
              disabled={!noteInput.trim() || sending}
            >
              <Send size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="px-4 py-3 border-t border-neutral-800 shrink-0 space-y-2">
        {/* Launch as Session */}
        <button
          onClick={handleLaunchSession}
          disabled={launching}
          className="w-full flex items-center justify-center gap-2 text-xs py-2 rounded
                     bg-codefire-orange/20 text-codefire-orange border border-codefire-orange/30
                     hover:bg-codefire-orange/30 transition-colors disabled:opacity-50"
        >
          {launching ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          Launch as Session
        </button>

        <button
          className="w-full text-xs text-red-400/70 hover:text-red-300 transition-colors py-1"
          onClick={() => {
            if (confirm('Delete this task?')) {
              onDelete(task.id)
              onClose()
            }
          }}
        >
          Delete Task
        </button>
      </div>
    </div>
  )
}

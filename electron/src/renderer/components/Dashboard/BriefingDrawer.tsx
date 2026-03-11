import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  X, RefreshCw, Loader2, Zap, AlertTriangle, Rocket,
  ChevronDown, ChevronRight, ExternalLink, Clock, Target,
  TrendingUp, Flame, Coffee, Hourglass, Mail,
  FolderX, ListChecks, ArrowRight, Rss,
  BookmarkCheck, Bookmark, Play,
} from 'lucide-react'
import type { BriefingDigest, BriefingItem, AppConfig } from '@shared/models'
import { api } from '@renderer/lib/api'

interface BriefingDrawerProps {
  projectId: string
  onClose: () => void
}

// ─── Parse helpers ──────────────────────────────────────────────────────────

interface PriorityMeta { reason: string; detail: string; taskId?: number }
interface AttentionMeta { type: string; detail: string; taskId?: number }
interface QuickWinMeta { detail: string; taskId?: number }
interface RecapMeta { sessionsCount: number; tokensUsed: number; tasksCompleted: number; highlights: string[] }

function parseMeta<T>(summary: string, fallback: T): T {
  try { return JSON.parse(summary) as T } catch { return fallback }
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

// ─── Reason badges ──────────────────────────────────────────────────────────

const REASON_CONFIG: Record<string, { icon: typeof Flame; label: string; color: string }> = {
  momentum: { icon: Flame, label: 'Momentum', color: 'text-orange-400 bg-orange-500/15' },
  aging: { icon: Hourglass, label: 'Aging', color: 'text-amber-400 bg-amber-500/15' },
  urgent: { icon: AlertTriangle, label: 'Urgent', color: 'text-red-400 bg-red-500/15' },
  quickwin: { icon: Zap, label: 'Quick Win', color: 'text-emerald-400 bg-emerald-500/15' },
  blocked: { icon: AlertTriangle, label: 'Blocked', color: 'text-red-400 bg-red-500/15' },
}

const ATTENTION_TYPE_CONFIG: Record<string, { icon: typeof FolderX; color: string }> = {
  stale_project: { icon: FolderX, color: 'text-amber-400' },
  stuck_task: { icon: Clock, color: 'text-orange-400' },
  email: { icon: Mail, color: 'text-blue-400' },
  overdue: { icon: AlertTriangle, color: 'text-red-400' },
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function BriefingDrawer({ projectId, onClose }: BriefingDrawerProps) {
  const [digests, setDigests] = useState<BriefingDigest[]>([])
  const [activeDigest, setActiveDigest] = useState<BriefingDigest | null>(null)
  const [items, setItems] = useState<BriefingItem[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['techpulse']))

  const loadDigests = useCallback(async () => {
    const list = await api.briefing.listDigests()
    setDigests(list)
    return list
  }, [])

  useEffect(() => {
    loadDigests().then(async (list) => {
      if (list.length > 0) {
        setActiveDigest(list[0])
        const briefingItems = await api.briefing.getItems(list[0].id)
        setItems(briefingItems)
      }
    })
  }, [loadDigests])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const digest = await api.briefing.generate(projectId)
      if (!digest) {
        setError('Generation returned no digest')
        return
      }
      setActiveDigest(digest)
      const briefingItems = await api.briefing.getItems(digest.id)
      setItems(briefingItems)
      if (briefingItems.length === 0) {
        setError('Briefing generated but produced 0 items. Check the developer console (Ctrl+Shift+I) for [Briefing] errors.')
      }
      await loadDigests()
    } catch (err) {
      console.error('Failed to generate briefing:', err)
      setError(`Generation failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGenerating(false)
    }
  }

  async function handleSelectDigest(digest: BriefingDigest) {
    setActiveDigest(digest)
    const briefingItems = await api.briefing.getItems(digest.id)
    setItems(briefingItems)
  }

  async function handleMarkRead(itemId: number) {
    await api.briefing.markRead(itemId)
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, isRead: 1 } : i)))
  }

  async function handleSaveItem(itemId: number) {
    await api.briefing.saveItem(itemId)
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, isSaved: i.isSaved ? 0 : 1 } : i)))
  }

  async function handleLaunchAgent(taskId: number) {
    try {
      // Get task details
      const task = await api.tasks.get(taskId)
      if (!task) return

      // Get project path
      const projects = await api.projects.list()
      const project = projects.find(p => p.id === task.projectId)
      const projectPath = project?.path || ''

      // Get CLI config
      const config = await api.settings.get() as AppConfig
      const cli = config?.preferredCLI ?? 'claude'
      const extraArgs = config?.cliExtraArgs ?? ''

      // Build prompt from task
      let prompt = task.title
      if (task.description) prompt += '\n\n' + task.description

      const escaped = prompt
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
        .replace(/\n/g, '\\n')
      const command = extraArgs ? `${cli} ${extraArgs} "${escaped}"` : `${cli} "${escaped}"`

      // Create terminal and launch
      const termId = `briefing-${taskId}-${Date.now()}`
      await window.api.invoke('terminal:create', termId, projectPath)
      setTimeout(() => {
        window.api.send('terminal:write', termId, command + '\n')
      }, 300)

      // Mark the task as in-progress
      await api.tasks.update(taskId, { status: 'in_progress' })
    } catch (err) {
      console.error('Failed to launch agent:', err)
    }
  }

  function toggleSection(section: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  // Group items by category
  const grouped = useMemo(() => {
    const groups: Record<string, BriefingItem[]> = {}
    for (const item of items) {
      const cat = item.category || 'other'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(item)
    }
    return groups
  }, [items])

  const priorities = grouped['priorities'] || []
  const attention = grouped['attention'] || []
  const quickWins = grouped['quickwins'] || []
  const recapItem = (grouped['recap'] || [])[0]
  const techPulse = grouped['techpulse'] || []

  const recapData = recapItem
    ? parseMeta<RecapMeta>(recapItem.summary, { sessionsCount: 0, tokensUsed: 0, tasksCompleted: 0, highlights: [] })
    : null

  // Detect if the active digest has any renderable sections (new format)
  const hasSections = priorities.length > 0 || attention.length > 0 || quickWins.length > 0 || recapItem || techPulse.length > 0
  // Treat as "needs generation" if digest exists but has no renderable content (old format)
  const needsRegenerate = activeDigest != null && items.length > 0 && !hasSections

  // Time greeting
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] z-50 flex flex-col bg-neutral-900/95 backdrop-blur-xl border-l border-neutral-700/80 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
            <Target size={13} className="text-white" />
          </div>
          <div>
            <span className="text-[13px] font-semibold text-neutral-200">Daily Briefing</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-40"
            title="Generate new briefing"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {generating ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center mb-4">
              <Loader2 size={24} className="text-orange-400 animate-spin" />
            </div>
            <p className="text-sm text-neutral-300 font-medium">Analyzing your work...</p>
            <p className="text-xs text-neutral-500 mt-1">Gathering tasks, sessions, emails, and projects</p>
          </div>
        ) : !activeDigest || items.length === 0 || needsRegenerate ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-orange-500/10 to-amber-500/10 flex items-center justify-center mb-4">
              <Target size={28} className="text-neutral-600" />
            </div>
            <p className="text-sm text-neutral-400 mb-1">{greeting}</p>
            <p className="text-xs text-neutral-500 mb-5 max-w-[260px]">
              {needsRegenerate
                ? 'Your briefing needs to be refreshed to show priorities, attention items, and quick wins.'
                : 'Generate a briefing to see your priorities, tasks needing attention, and quick wins across all projects.'}
            </p>
            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-400 max-w-[300px]">
                {error}
              </div>
            )}
            <button
              onClick={handleGenerate}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-lg hover:from-orange-400 hover:to-amber-400 transition-all shadow-lg shadow-orange-500/20"
            >
              <Zap size={13} />
              {needsRegenerate ? 'Refresh Briefing' : 'Generate Briefing'}
            </button>
          </div>
        ) : (
          <div className="py-3 space-y-1">
            {/* Timestamp */}
            <div className="px-4 pb-2 text-[11px] text-neutral-500">
              {greeting} &middot; Generated{' '}
              {new Date(activeDigest.generatedAt).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </div>

            {/* ── Recap Banner ── */}
            {recapData && (recapData.sessionsCount > 0 || recapData.tasksCompleted > 0) && (
              <div className="mx-3 mb-2 rounded-lg bg-neutral-800/60 border border-neutral-700/50 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp size={12} className="text-emerald-400" />
                  <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Last 24 Hours</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <RecapStat value={recapData.sessionsCount} label="Sessions" />
                  <RecapStat value={formatTokens(recapData.tokensUsed)} label="Tokens" />
                  <RecapStat value={recapData.tasksCompleted} label="Completed" />
                </div>
                {recapData.highlights.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {recapData.highlights.map((h, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[11px] text-neutral-400">
                        <span className="text-emerald-500 mt-0.5 shrink-0">&#10003;</span>
                        <span>{h}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Start Here (Priorities) ── */}
            {priorities.length > 0 && (
              <BriefingSection
                title="Start Here"
                icon={<Rocket size={13} className="text-orange-400" />}
                count={priorities.length}
                collapsed={collapsedSections.has('priorities')}
                onToggle={() => toggleSection('priorities')}
                accentColor="orange"
              >
                <div className="space-y-2">
                  {priorities.map((item, i) => {
                    const meta = parseMeta<PriorityMeta>(item.summary, { reason: 'momentum', detail: '' })
                    const rc = REASON_CONFIG[meta.reason] || REASON_CONFIG.momentum
                    const Icon = rc.icon
                    return (
                      <div
                        key={item.id}
                        className={`rounded-lg p-3 border transition-colors cursor-pointer ${
                          item.isRead
                            ? 'bg-neutral-800/30 border-neutral-800/40'
                            : 'bg-neutral-800/60 border-neutral-700/40 hover:border-neutral-600/60'
                        }`}
                        onClick={() => !item.isRead && handleMarkRead(item.id)}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-orange-500/15 text-orange-400 text-[10px] font-bold shrink-0 mt-0.5">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className={`text-xs font-medium leading-snug ${item.isRead ? 'text-neutral-500' : 'text-neutral-200'}`}>
                                {item.title}
                              </h4>
                            </div>
                            <p className={`text-[11px] leading-relaxed mb-2 ${item.isRead ? 'text-neutral-600' : 'text-neutral-400'}`}>
                              {meta.detail}
                            </p>
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded ${rc.color}`}>
                                <Icon size={9} />
                                {rc.label}
                              </span>
                              <span className="text-[10px] text-neutral-500">{item.sourceName}</span>
                              <ItemActions
                                item={item}
                                onSave={() => handleSaveItem(item.id)}
                                onLaunch={meta.taskId ? () => handleLaunchAgent(meta.taskId!) : undefined}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </BriefingSection>
            )}

            {/* ── Needs Attention ── */}
            {attention.length > 0 && (
              <BriefingSection
                title="Needs Attention"
                icon={<AlertTriangle size={13} className="text-amber-400" />}
                count={attention.length}
                collapsed={collapsedSections.has('attention')}
                onToggle={() => toggleSection('attention')}
                accentColor="amber"
              >
                <div className="space-y-1.5">
                  {attention.map((item) => {
                    const meta = parseMeta<AttentionMeta>(item.summary, { type: 'stuck_task', detail: '' })
                    const tc = ATTENTION_TYPE_CONFIG[meta.type] || ATTENTION_TYPE_CONFIG.stuck_task
                    const TypeIcon = tc.icon
                    return (
                      <div
                        key={item.id}
                        className={`rounded-lg p-2.5 border transition-colors ${
                          item.isRead
                            ? 'bg-neutral-800/20 border-neutral-800/30'
                            : 'bg-neutral-800/40 border-neutral-700/30'
                        }`}
                        onClick={() => !item.isRead && handleMarkRead(item.id)}
                      >
                        <div className="flex items-start gap-2">
                          <TypeIcon size={13} className={`${tc.color} shrink-0 mt-0.5`} />
                          <div className="flex-1 min-w-0">
                            <h4 className={`text-[11px] font-medium ${item.isRead ? 'text-neutral-500' : 'text-neutral-300'}`}>
                              {item.title}
                            </h4>
                            <p className="text-[10px] text-neutral-500 mt-0.5">{meta.detail}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[9px] text-neutral-600">{item.sourceName}</span>
                              <ItemActions
                                item={item}
                                onSave={() => handleSaveItem(item.id)}
                                onLaunch={meta.taskId ? () => handleLaunchAgent(meta.taskId!) : undefined}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </BriefingSection>
            )}

            {/* ── Quick Wins ── */}
            {quickWins.length > 0 && (
              <BriefingSection
                title="Quick Wins"
                icon={<Zap size={13} className="text-emerald-400" />}
                count={quickWins.length}
                collapsed={collapsedSections.has('quickwins')}
                onToggle={() => toggleSection('quickwins')}
                accentColor="emerald"
              >
                <div className="space-y-1.5">
                  {quickWins.map((item) => {
                    const meta = parseMeta<QuickWinMeta>(item.summary, { detail: '' })
                    return (
                      <div
                        key={item.id}
                        className={`rounded-lg p-2.5 border transition-colors flex items-center gap-2.5 ${
                          item.isRead
                            ? 'bg-neutral-800/20 border-neutral-800/30'
                            : 'bg-neutral-800/40 border-neutral-700/30'
                        }`}
                        onClick={() => !item.isRead && handleMarkRead(item.id)}
                      >
                        <div className="w-5 h-5 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
                          <Zap size={11} className="text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className={`text-[11px] font-medium ${item.isRead ? 'text-neutral-500' : 'text-neutral-300'}`}>
                            {item.title}
                          </h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[9px] text-neutral-600">{item.sourceName}</span>
                            {meta.detail && <span className="text-[9px] text-neutral-600">&middot; {meta.detail}</span>}
                          </div>
                        </div>
                        {meta.taskId ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleLaunchAgent(meta.taskId!)
                            }}
                            className="flex items-center gap-1 text-[9px] font-medium text-emerald-500 hover:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded transition-colors shrink-0"
                            title="Launch agent to work on this task"
                          >
                            <Play size={8} className="fill-current" />
                            Agent
                          </button>
                        ) : (
                          <ArrowRight size={12} className="text-neutral-600 shrink-0" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </BriefingSection>
            )}

            {/* ── Tech Pulse ── */}
            {techPulse.length > 0 && (
              <BriefingSection
                title="Tech Pulse"
                icon={<Rss size={13} className="text-purple-400" />}
                count={techPulse.length}
                collapsed={collapsedSections.has('techpulse')}
                onToggle={() => toggleSection('techpulse')}
                accentColor="purple"
              >
                <div className="space-y-1">
                  {techPulse.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded p-2 flex items-start gap-2 transition-colors ${
                        item.isRead ? 'opacity-50' : 'hover:bg-neutral-800/40'
                      }`}
                      onClick={() => !item.isRead && handleMarkRead(item.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[11px] text-neutral-300 leading-snug">{item.title}</h4>
                        <span className="text-[9px] text-neutral-600">{item.sourceName}</span>
                      </div>
                      {item.sourceUrl && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            window.api.invoke('shell:openExternal', item.sourceUrl)
                          }}
                          className="p-1 text-neutral-600 hover:text-purple-400 transition-colors shrink-0"
                        >
                          <ExternalLink size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </BriefingSection>
            )}
          </div>
        )}

        {/* Past Briefings */}
        {digests.length > 1 && (
          <div className="border-t border-neutral-800 mx-3 mt-2 pt-3 pb-4">
            <button
              onClick={() => setShowPast(!showPast)}
              className="flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              <ChevronDown size={12} className={`transition-transform duration-150 ${showPast ? 'rotate-0' : '-rotate-90'}`} />
              Past Briefings ({digests.length - 1})
            </button>
            {showPast && (
              <div className="mt-2 space-y-1">
                {digests.slice(1).map((digest) => (
                  <button
                    key={digest.id}
                    onClick={() => handleSelectDigest(digest)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                      activeDigest?.id === digest.id
                        ? 'bg-neutral-800 text-neutral-200'
                        : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50'
                    }`}
                  >
                    {new Date(digest.generatedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    <span className="text-neutral-600 ml-2">{digest.itemCount} items</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function BriefingSection({
  title,
  icon,
  count,
  collapsed,
  onToggle,
  accentColor: _accentColor,
  children,
}: {
  title: string
  icon: React.ReactNode
  count: number
  collapsed: boolean
  onToggle: () => void
  accentColor: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-3">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full py-2 group"
      >
        {collapsed ? (
          <ChevronRight size={12} className="text-neutral-500 group-hover:text-neutral-300 transition-colors" />
        ) : (
          <ChevronDown size={12} className="text-neutral-500 group-hover:text-neutral-300 transition-colors" />
        )}
        {icon}
        <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">{title}</span>
        <span className="text-[10px] text-neutral-600 ml-auto">{count}</span>
      </button>
      {!collapsed && <div className="pb-2">{children}</div>}
    </div>
  )
}

function RecapStat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-sm font-bold text-neutral-200">{value}</div>
      <div className="text-[9px] text-neutral-500 uppercase tracking-wider">{label}</div>
    </div>
  )
}

function ItemActions({ item, onSave, onLaunch }: { item: BriefingItem; onSave: () => void; onLaunch?: () => void }) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      {onLaunch && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onLaunch()
          }}
          className="flex items-center gap-1 text-[9px] font-medium text-emerald-500 hover:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded transition-colors"
          title="Launch agent to work on this task"
        >
          <Play size={8} className="fill-current" />
          Agent
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onSave()
        }}
        className={`flex items-center gap-0.5 text-[9px] transition-colors ${
          item.isSaved
            ? 'text-orange-400'
            : 'text-neutral-600 hover:text-orange-400'
        }`}
      >
        {item.isSaved ? <BookmarkCheck size={9} /> : <Bookmark size={9} />}
      </button>
    </div>
  )
}

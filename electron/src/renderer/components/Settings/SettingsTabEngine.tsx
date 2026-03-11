import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Trash2, Database, CheckCircle, XCircle, Loader2, Plug, AlertTriangle } from 'lucide-react'
import type { AppConfig, Project, IndexState } from '@shared/models'
import { api } from '../../lib/api'
import { Section, TextInput, Select, Toggle, NumberInput } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

function IndexStatusPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [indexStates, setIndexStates] = useState<Map<string, IndexState | null>>(new Map())
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const projectList = await api.projects.list()
    const display = projectList.filter((p) => p.id !== '__global__')
    setProjects(display)

    const states = new Map<string, IndexState | null>()
    await Promise.all(
      display.map(async (p) => {
        const state = await api.search.getIndexState(p.id).catch(() => null)
        states.set(p.id, state)
      })
    )
    setIndexStates(states)
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  async function handleReindex(projectId: string) {
    setActionInProgress(projectId)
    await api.search.reindex(projectId).catch(() => {})
    // Brief delay then refresh state
    setTimeout(async () => {
      const state = await api.search.getIndexState(projectId).catch(() => null)
      setIndexStates((prev) => new Map(prev).set(projectId, state))
      setActionInProgress(null)
    }, 1000)
  }

  async function handleClear(projectId: string) {
    setActionInProgress(projectId)
    await api.search.clearIndex(projectId).catch(() => {})
    const state = await api.search.getIndexState(projectId).catch(() => null)
    setIndexStates((prev) => new Map(prev).set(projectId, state))
    setActionInProgress(null)
  }

  if (loading) {
    return <p className="text-[10px] text-neutral-600">Loading index status...</p>
  }

  if (projects.length === 0) {
    return <p className="text-[10px] text-neutral-600">No projects to index.</p>
  }

  return (
    <div className="space-y-1.5">
      {projects.map((p) => {
        const state = indexStates.get(p.id)
        const status = state?.status ?? 'idle'
        const chunks = state?.totalChunks ?? 0
        const isActive = actionInProgress === p.id
        const name = p.name.split(/[/\\]/).pop() ?? p.name

        return (
          <div
            key={p.id}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700"
          >
            <Database size={12} className="text-neutral-500 shrink-0" />
            <span className="text-xs text-neutral-300 truncate flex-1" title={p.name}>
              {name}
            </span>
            <span className={`text-[10px] font-mono shrink-0 ${
              status === 'idle' ? 'text-neutral-600' :
              status === 'indexing' ? 'text-codefire-orange' :
              status === 'error' ? 'text-red-400' : 'text-green-400'
            }`}>
              {status === 'idle' ? 'Not indexed' :
               status === 'indexing' ? 'Indexing...' :
               status === 'error' ? 'Error' :
               `${chunks} chunks`}
            </span>
            <button
              type="button"
              onClick={() => handleReindex(p.id)}
              disabled={isActive}
              className="text-neutral-500 hover:text-codefire-orange transition-colors disabled:opacity-30"
              title="Rebuild index"
            >
              <RefreshCw size={12} className={isActive ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => handleClear(p.id)}
              disabled={isActive}
              className="text-neutral-500 hover:text-red-400 transition-colors disabled:opacity-30"
              title="Clear index"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

const CLI_PROVIDERS = [
  { id: 'claude', label: 'Claude Code', description: 'Installs MCP server in ~/.claude.json' },
  { id: 'gemini', label: 'Gemini CLI', description: 'Installs MCP server in ~/.gemini/settings.json' },
  { id: 'codex', label: 'Codex CLI', description: 'Installs MCP server in ~/.codex/config.toml' },
] as const

function MCPInstallPanel() {
  const [installing, setInstalling] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { success: boolean; error?: string }>>({})
  const [mcpStatus, setMcpStatus] = useState<string>('unknown')

  useEffect(() => {
    api.mcp.status().then((s) => setMcpStatus(s.status)).catch(() => {})
  }, [])

  async function handleInstall(cli: string) {
    setInstalling(cli)
    try {
      const result = await api.context.installMCP(cli) as { success: boolean; error?: string }
      setResults((prev) => ({ ...prev, [cli]: result }))
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [cli]: { success: false, error: err instanceof Error ? err.message : 'Install failed' },
      }))
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${
          mcpStatus === 'connected' ? 'bg-green-400' :
          mcpStatus === 'error' ? 'bg-red-400' : 'bg-neutral-600'
        }`} />
        <span className="text-[10px] text-neutral-500">
          MCP Server: {mcpStatus === 'connected' ? 'Running' : mcpStatus === 'error' ? 'Error' : 'Not running'}
        </span>
      </div>
      {CLI_PROVIDERS.map((cli) => {
        const result = results[cli.id]
        const isInstalling = installing === cli.id
        return (
          <div
            key={cli.id}
            className="flex items-center gap-2 px-2.5 py-2 rounded bg-neutral-800 border border-neutral-700"
          >
            <Plug size={12} className="text-neutral-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs text-neutral-300">{cli.label}</span>
              <span className="text-[10px] text-neutral-600 block">{cli.description}</span>
            </div>
            {result ? (
              result.success ? (
                <CheckCircle size={14} className="text-green-400 shrink-0" />
              ) : (
                <span className="flex items-center gap-1 shrink-0" title={result.error}>
                  <XCircle size={14} className="text-red-400" />
                </span>
              )
            ) : null}
            <button
              type="button"
              onClick={() => handleInstall(cli.id)}
              disabled={isInstalling}
              className="px-2.5 py-1 text-[10px] font-medium bg-codefire-orange/15 text-codefire-orange hover:bg-codefire-orange/25 rounded transition-colors disabled:opacity-40 shrink-0"
            >
              {isInstalling ? (
                <Loader2 size={10} className="animate-spin" />
              ) : result?.success ? (
                'Reinstall'
              ) : (
                'Install'
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function SettingsTabEngine({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <Section title="API Keys">
        <TextInput
          label="OpenRouter API Key"
          hint="Used for embeddings, chat, image generation, and audio transcription. Get one at openrouter.ai"
          placeholder="sk-or-..."
          value={config.openRouterKey}
          onChange={(v) => onChange({ openRouterKey: v })}
          secret
        />

      </Section>

      <Section title="Models">
        <Select
          label="Embedding model"
          value={config.embeddingModel}
          onChange={(v) => onChange({ embeddingModel: v })}
          options={[
            { value: 'openai/text-embedding-3-small', label: 'text-embedding-3-small' },
            { value: 'openai/text-embedding-3-large', label: 'text-embedding-3-large' },
          ]}
        />
        <Select
          label="Chat model"
          hint="Model used for summaries and briefings"
          value={config.chatModel}
          onChange={(v) => onChange({ chatModel: v })}
          options={[
            { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
            { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
            { value: 'qwen/qwen3.5-plus-02-15', label: 'Qwen 3.5 Plus' },
            { value: 'qwen/qwen3-coder-next', label: 'Qwen3 Coder Next' },
            { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2' },
            { value: 'minimax/minimax-m2.5', label: 'MiniMax M2.5' },
            { value: 'z-ai/glm-5', label: 'GLM-5' },
            { value: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' },
            { value: 'openai/gpt-5.4', label: 'GPT-5.4' },
          ]}
        />
        <Select
          label="Chat mode"
          hint="Context: low cost, RAG-enhanced Q&A. Agent: full tool calling, can take actions."
          value={config.chatMode || 'context'}
          onChange={(v) => onChange({ chatMode: v as 'context' | 'agent' })}
          options={[
            { value: 'context', label: 'Context (low cost)' },
            { value: 'agent', label: 'Agent (tool calling)' },
          ]}
        />
      </Section>

      <Section title="Automation">
        <Toggle
          label="Auto-transcribe recordings"
          hint="Automatically transcribe recordings with Gemini when they finish"
          value={config.autoTranscribe}
          onChange={(v) => onChange({ autoTranscribe: v })}
        />
        {config.autoTranscribe && !config.openRouterKey && (
          <div className="flex items-center gap-2 px-2.5 py-2 rounded bg-yellow-500/10 border border-yellow-500/20">
            <AlertTriangle size={12} className="text-yellow-400 shrink-0" />
            <span className="text-[10px] text-yellow-400">
              Auto-transcribe is enabled but no OpenRouter API key is set. Add one above for transcription to work.
            </span>
          </div>
        )}
        <Toggle
          label="Semantic code search"
          hint="Enable vector-based code search across projects"
          value={config.contextSearchEnabled}
          onChange={(v) => onChange({ contextSearchEnabled: v })}
        />
        <Toggle
          label="Auto-snapshot sessions"
          value={config.autoSnapshotSessions}
          onChange={(v) => onChange({ autoSnapshotSessions: v })}
        />
        <Toggle
          label="Auto-update codebase tree"
          value={config.autoUpdateCodebaseTree}
          onChange={(v) => onChange({ autoUpdateCodebaseTree: v })}
        />
        <Toggle
          label="Auto-start MCP server"
          hint="Launch the MCP server when the app starts"
          value={config.mcpServerAutoStart}
          onChange={(v) => onChange({ mcpServerAutoStart: v })}
        />
        <Toggle
          label="Instruction injection"
          hint="Inject .claude/instructions.md into CLI sessions"
          value={config.instructionInjection}
          onChange={(v) => onChange({ instructionInjection: v })}
        />
        <NumberInput
          label="Snapshot debounce (seconds)"
          value={config.snapshotDebounce}
          onChange={(v) => onChange({ snapshotDebounce: v })}
          min={5}
          max={120}
          step={5}
        />
      </Section>

      <Section title="MCP Server Installation">
        <p className="text-[10px] text-neutral-600 mb-2">
          Install the CodeFire MCP server into your AI coding CLI so it can access your projects, tasks, notes, and sessions.
        </p>
        <MCPInstallPanel />
      </Section>

      <Section title="Index Status">
        <p className="text-[10px] text-neutral-600 mb-2">
          Semantic code index for each project. Rebuild to re-index all files, or clear to remove index data.
        </p>
        <IndexStatusPanel />
      </Section>
    </div>
  )
}

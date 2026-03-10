import { useState } from 'react'
import {
  Zap,
  ChevronDown,
  Eye,
  ShieldCheck,
  Bug,
  RefreshCw,
  FileText,
  ShieldAlert,
  Terminal,
  ArrowUpRight,
  ArrowRightCircle,
  Play,
} from 'lucide-react'

interface TaskPreset {
  id: string
  icon: typeof Eye
  title: string
  description: string
  color: string
  bgColor: string
  borderColor: string
  hoverBg: string
  prompt: string
}

const PRESETS: TaskPreset[] = [
  {
    id: 'review',
    icon: Eye,
    title: 'Code Review',
    description: 'Review recent changes',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    hoverBg: 'hover:bg-blue-500/15',
    prompt:
      'Review the recent code changes in this project. Look for bugs, security issues, and suggest improvements. Focus on the most recently modified files.',
  },
  {
    id: 'tests',
    icon: ShieldCheck,
    title: 'Write Tests',
    description: 'Generate test coverage',
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/20',
    hoverBg: 'hover:bg-green-500/15',
    prompt:
      'Analyze the codebase and write tests for any untested or under-tested code. Focus on critical business logic and edge cases.',
  },
  {
    id: 'debug',
    icon: Bug,
    title: 'Debug',
    description: 'Investigate issues',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    hoverBg: 'hover:bg-red-500/15',
    prompt:
      'Investigate the codebase for potential bugs, error-prone patterns, and issues. Check error handling, edge cases, and race conditions.',
  },
  {
    id: 'refactor',
    icon: RefreshCw,
    title: 'Refactor',
    description: 'Improve code quality',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
    hoverBg: 'hover:bg-purple-500/15',
    prompt:
      'Look for opportunities to refactor and improve code quality. Focus on reducing duplication, improving readability, and simplifying complex logic.',
  },
  {
    id: 'docs',
    icon: FileText,
    title: 'Documentation',
    description: 'Add or update docs',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
    hoverBg: 'hover:bg-orange-500/15',
    prompt:
      'Review the codebase and add or improve documentation. Focus on public APIs, complex logic, and architecture decisions that need explaining.',
  },
  {
    id: 'security',
    icon: ShieldAlert,
    title: 'Security Audit',
    description: 'Check for vulnerabilities',
    color: 'text-red-300',
    bgColor: 'bg-red-500/8',
    borderColor: 'border-red-500/15',
    hoverBg: 'hover:bg-red-500/12',
    prompt:
      'Perform a security audit of this codebase. Check for common vulnerabilities like injection attacks, authentication issues, data exposure, and insecure configurations.',
  },
]

function getCLICommand(cli: string, prompt: string): string {
  const escaped = prompt.replace(/"/g, '\\"')
  switch (cli) {
    case 'gemini':
      return `gemini "${escaped}"`
    case 'codex':
      return `codex "${escaped}"`
    default:
      return `claude "${escaped}"`
  }
}

interface TaskLauncherCardProps {
  projectId: string
}

export default function TaskLauncherCard({ projectId }: TaskLauncherCardProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [customPrompt, setCustomPrompt] = useState('')
  const [launching, setLaunching] = useState<string | null>(null)

  const launchAction = async (prompt: string, actionId: string, title: string) => {
    setLaunching(actionId)
    try {
      const config = (await window.api.invoke('settings:get')) as
        | { preferredCLI?: string }
        | undefined
      const cli = config?.preferredCLI ?? 'claude'
      const command = getCLICommand(cli, prompt)

      window.api.send('terminal:writeToActive', command + '\n')
    } catch (err) {
      console.error('Failed to launch action:', err)
    } finally {
      setTimeout(() => setLaunching(null), 500)
    }
  }

  const handleCustomLaunch = () => {
    const prompt = customPrompt.trim()
    if (!prompt) return
    const shortTitle = prompt.length > 20 ? prompt.slice(0, 20) + '...' : prompt
    launchAction(prompt, 'custom', shortTitle)
    setCustomPrompt('')
  }

  return (
    <div className="bg-neutral-800/50 rounded-[10px] border border-neutral-700/30 p-3.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-codefire-orange" />
          <h3 className="text-[13px] font-semibold text-neutral-200">Task Launcher</h3>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-neutral-500 hover:text-neutral-300 transition-colors p-0.5"
        >
          <ChevronDown size={12} className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : 'rotate-0'}`} />
        </button>
      </div>

      {isExpanded && (
        <div className="mt-2.5 space-y-2">
          {/* Preset grid - 2 columns matching Swift */}
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((preset) => {
              const Icon = preset.icon
              const isLaunching = launching === preset.id
              return (
                <button
                  key={preset.id}
                  onClick={() => launchAction(preset.prompt, preset.id, preset.title)}
                  disabled={isLaunching}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-[7px] border transition-all text-left group
                    ${preset.borderColor} ${preset.bgColor} ${preset.hoverBg} disabled:opacity-60`}
                >
                  <div className="flex-shrink-0 w-5 flex justify-center">
                    {isLaunching ? (
                      <Play size={12} className={`${preset.color} animate-pulse`} />
                    ) : (
                      <Icon size={12} className={preset.color} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-neutral-200">{preset.title}</div>
                    <div className="text-[9px] text-neutral-500 leading-tight truncate">
                      {preset.description}
                    </div>
                  </div>
                  <ArrowUpRight
                    size={8}
                    className="text-neutral-600 group-hover:text-neutral-400 transition-colors flex-shrink-0"
                  />
                </button>
              )
            })}
          </div>

          {/* Custom prompt */}
          <div className="flex items-center gap-1.5 px-2.5 py-[7px] bg-neutral-700/40 rounded-[7px] border border-neutral-600/30">
            <Terminal size={11} className="text-neutral-500 flex-shrink-0" />
            <input
              className="flex-1 bg-transparent text-xs text-neutral-200 placeholder-neutral-500
                         focus:outline-none"
              placeholder="Custom prompt..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCustomLaunch()
              }}
            />
            <button
              className="flex-shrink-0 transition-colors disabled:opacity-40"
              onClick={handleCustomLaunch}
              disabled={!customPrompt.trim()}
            >
              <ArrowRightCircle
                size={14}
                className={
                  customPrompt.trim()
                    ? 'text-codefire-orange hover:text-codefire-orange/80'
                    : 'text-neutral-600'
                }
              />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

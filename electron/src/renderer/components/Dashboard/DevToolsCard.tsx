import { useState, useEffect, useCallback } from 'react'
import {
  Play,
  Hammer,
  TestTube,
  AlertCircle,
  Download,
  Globe,
  Terminal,
  Loader2,
} from 'lucide-react'
import { api } from '@renderer/lib/api'

interface DevToolsCardProps {
  projectPath: string
}

interface ProjectType {
  type: 'node' | 'flutter' | 'python' | 'swift' | 'unknown'
  label: string
  packageManager?: string
}

interface DevCommand {
  title: string
  subtitle: string
  command: string
  icon: typeof Play
  color: string
}

interface ActivePort {
  port: number
  process: string
}

export default function DevToolsCard({ projectPath }: DevToolsCardProps) {
  const [projectType, setProjectType] = useState<ProjectType | null>(null)
  const [ports, setPorts] = useState<ActivePort[]>([])
  const [loading, setLoading] = useState(true)

  const detectProject = useCallback(async () => {
    try {
      const type = await api.services.detect(projectPath)

      // Detect project type from files
      const files = await api.files.list(projectPath)
      const fileNames = files.map((f: { name: string }) => f.name)

      let pt: ProjectType
      if (fileNames.includes('pubspec.yaml')) {
        pt = { type: 'flutter', label: 'Flutter' }
      } else if (fileNames.includes('package.json')) {
        // Detect package manager
        let pm = 'npm'
        if (fileNames.includes('bun.lockb') || fileNames.includes('bun.lock')) pm = 'bun'
        else if (fileNames.includes('pnpm-lock.yaml')) pm = 'pnpm'
        else if (fileNames.includes('yarn.lock')) pm = 'yarn'
        pt = { type: 'node', label: 'Node.js', packageManager: pm }
      } else if (fileNames.includes('Package.swift')) {
        pt = { type: 'swift', label: 'Swift' }
      } else if (
        fileNames.includes('requirements.txt') ||
        fileNames.includes('pyproject.toml') ||
        fileNames.includes('setup.py')
      ) {
        pt = { type: 'python', label: 'Python' }
      } else {
        pt = { type: 'unknown', label: 'Unknown' }
      }

      setProjectType(pt)
    } catch {
      setProjectType({ type: 'unknown', label: 'Unknown' })
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    detectProject()
  }, [detectProject])

  // Poll for active ports
  useEffect(() => {
    if (!projectType || projectType.type === 'unknown') return

    const defaultPorts: Record<string, number[]> = {
      node: [3000, 3001, 4200, 5173, 5174, 8080, 8000],
      flutter: [8080, 3000],
      python: [8000, 5000, 8080],
      swift: [8080],
    }

    const targetPorts = defaultPorts[projectType.type] ?? []

    async function scanPorts() {
      const active: ActivePort[] = []
      for (const port of targetPorts) {
        try {
          // Use a quick TCP connection check
          const response = await fetch(`http://localhost:${port}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(500),
          }).catch(() => null)
          if (response) {
            active.push({ port, process: projectType!.label })
          }
        } catch {
          // Port not listening
        }
      }
      setPorts(active)
    }

    scanPorts()
    const interval = setInterval(scanPorts, 5000)
    return () => clearInterval(interval)
  }, [projectType])

  if (loading) {
    return (
      <div className="bg-neutral-800/30 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center gap-2 text-neutral-500">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-xs">Detecting project type...</span>
        </div>
      </div>
    )
  }

  if (!projectType || projectType.type === 'unknown') {
    return null // Don't show card for unknown project types
  }

  const commands = getCommands(projectType)

  function runCommand(command: string) {
    window.api.send('terminal:writeToActive', command + '\n')
  }

  return (
    <div className="bg-neutral-800/30 rounded-lg border border-neutral-800 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Terminal size={14} className="text-codefire-orange" />
        <h3 className="text-xs font-medium text-neutral-300">Dev Tools</h3>
        <span className="text-[10px] text-neutral-600 bg-neutral-800 px-1.5 py-0.5 rounded">
          {projectType.label}
          {projectType.packageManager ? ` (${projectType.packageManager})` : ''}
        </span>
        {ports.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {ports.length} port{ports.length !== 1 ? 's' : ''} active
          </span>
        )}
      </div>

      {/* Command grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
        {commands.map((cmd) => (
          <button
            key={cmd.command}
            onClick={() => runCommand(cmd.command)}
            className="flex items-center gap-2 px-2.5 py-2 rounded
                       bg-neutral-800/60 border border-neutral-700/50
                       hover:bg-neutral-700/50 hover:border-neutral-600
                       transition-colors text-left group"
          >
            <cmd.icon size={13} className={cmd.color} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-neutral-200 font-medium truncate">
                {cmd.title}
              </p>
              <p className="text-[9px] text-neutral-500 truncate">
                {cmd.subtitle}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Active ports */}
      {ports.length > 0 && (
        <div className="border-t border-neutral-800 pt-2">
          <p className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1.5">
            Active Servers
          </p>
          <div className="space-y-1">
            {ports.map((p) => (
              <div
                key={p.port}
                className="flex items-center gap-2 text-xs"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span className="text-neutral-300 font-mono">:{p.port}</span>
                <span className="text-neutral-600">{p.process}</span>
                <button
                  onClick={() => window.api.invoke('shell:openExternal', `http://localhost:${p.port}`)}
                  className="ml-auto text-[10px] text-codefire-orange hover:text-codefire-orange/80"
                >
                  <Globe size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function getCommands(pt: ProjectType): DevCommand[] {
  const pm = pt.packageManager ?? 'npm'

  switch (pt.type) {
    case 'node':
      return [
        { title: 'Dev Server', subtitle: `${pm} run dev`, command: `${pm} run dev`, icon: Play, color: 'text-green-400' },
        { title: 'Build', subtitle: `${pm} run build`, command: `${pm} run build`, icon: Hammer, color: 'text-blue-400' },
        { title: 'Test', subtitle: `${pm} test`, command: `${pm} test`, icon: TestTube, color: 'text-purple-400' },
        { title: 'Lint', subtitle: `${pm} run lint`, command: `${pm} run lint`, icon: AlertCircle, color: 'text-yellow-400' },
        { title: 'Install', subtitle: `${pm} install`, command: `${pm} install`, icon: Download, color: 'text-neutral-400' },
      ]
    case 'flutter':
      return [
        { title: 'Run', subtitle: 'flutter run', command: 'flutter run', icon: Play, color: 'text-cyan-400' },
        { title: 'Run Web', subtitle: 'flutter run -d chrome', command: 'flutter run -d chrome', icon: Globe, color: 'text-cyan-400' },
        { title: 'Test', subtitle: 'flutter test', command: 'flutter test', icon: TestTube, color: 'text-purple-400' },
        { title: 'Build', subtitle: 'flutter build', command: 'flutter build', icon: Hammer, color: 'text-blue-400' },
        { title: 'Pub Get', subtitle: 'flutter pub get', command: 'flutter pub get', icon: Download, color: 'text-neutral-400' },
      ]
    case 'python':
      return [
        { title: 'Run Server', subtitle: 'python manage.py runserver', command: 'python manage.py runserver', icon: Play, color: 'text-yellow-400' },
        { title: 'Test', subtitle: 'pytest', command: 'pytest', icon: TestTube, color: 'text-purple-400' },
        { title: 'Install', subtitle: 'pip install -r requirements.txt', command: 'pip install -r requirements.txt', icon: Download, color: 'text-neutral-400' },
      ]
    case 'swift':
      return [
        { title: 'Build', subtitle: 'swift build', command: 'swift build', icon: Hammer, color: 'text-orange-400' },
        { title: 'Test', subtitle: 'swift test', command: 'swift test', icon: TestTube, color: 'text-purple-400' },
        { title: 'Run', subtitle: 'swift run', command: 'swift run', icon: Play, color: 'text-green-400' },
      ]
    default:
      return []
  }
}

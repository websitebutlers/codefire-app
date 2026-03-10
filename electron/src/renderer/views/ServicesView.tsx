import { useState, useEffect, useCallback } from 'react'
import { Cloud, KeyRound, FileText, Loader2, Wand2, X } from 'lucide-react'
import { api } from '@renderer/lib/api'
import CollapsibleSection from '@renderer/components/Services/CollapsibleSection'
import ServiceCard from '@renderer/components/Services/ServiceCard'
import EnvFilePanel from '@renderer/components/Services/EnvFilePanel'

interface ServicesViewProps {
  projectId: string
  projectPath: string
}

interface Service {
  name: string
  configFile: string
  configPath: string
  dashboardUrl: string | null
  icon: string
}

interface EnvFile {
  name: string
  path: string
  varCount: number
}

interface Template {
  name: string
  path: string
  vars: Array<{ key: string; comment?: string; defaultValue?: string }>
}

export default function ServicesView({ projectPath }: ServicesViewProps) {
  const [services, setServices] = useState<Service[]>([])
  const [envFiles, setEnvFiles] = useState<EnvFile[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [genTemplate, setGenTemplate] = useState<Template | null>(null)
  const [genValues, setGenValues] = useState<Record<string, string>>({})
  const [genSaving, setGenSaving] = useState(false)

  const openGenModal = useCallback((tpl: Template) => {
    const initial: Record<string, string> = {}
    for (const v of tpl.vars) {
      initial[v.key] = v.defaultValue ?? ''
    }
    setGenValues(initial)
    setGenTemplate(tpl)
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!genTemplate) return
    const dirSep = genTemplate.path.includes('\\') ? '\\' : '/'
    const dir = genTemplate.path.substring(0, genTemplate.path.lastIndexOf(dirSep))
    const envPath = `${dir}${dirSep}.env`

    if (!window.confirm(`Generate .env from ${genTemplate.name}?\n\nThis will overwrite the existing .env file if it exists.`)) return

    setGenSaving(true)
    try {
      const lines: string[] = []
      for (const v of genTemplate.vars) {
        if (v.comment) lines.push(`# ${v.comment}`)
        lines.push(`${v.key}=${genValues[v.key] ?? ''}`)
      }
      await api.files.write(envPath, lines.join('\n') + '\n')
      setGenTemplate(null)
      // Reload env files
      const updated = await api.services.listEnvFiles(projectPath)
      setEnvFiles(updated)
    } catch (err) {
      console.error('Failed to generate .env:', err)
    } finally {
      setGenSaving(false)
    }
  }, [genTemplate, genValues, projectPath])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const results = await Promise.allSettled([
          api.services.detect(projectPath),
          api.services.listEnvFiles(projectPath),
          api.services.scanTemplates(projectPath),
        ])
        if (cancelled) return
        if (results[0].status === 'fulfilled') setServices(results[0].value)
        else console.warn('Service detection failed:', results[0].reason)
        if (results[1].status === 'fulfilled') setEnvFiles(results[1].value)
        else console.warn('Env file scan failed:', results[1].reason)
        if (results[2].status === 'fulfilled') setTemplates(results[2].value)
        else console.warn('Template scan failed:', results[2].reason)
      } catch (err) {
        console.error('Failed to load services data:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [projectPath])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  const isEmpty = services.length === 0 && envFiles.length === 0 && templates.length === 0

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8 max-w-md mx-auto">
        <Cloud size={32} className="text-neutral-700" />
        <p className="text-sm font-medium text-neutral-400">No services detected</p>
        <p className="text-xs text-neutral-600 text-center leading-relaxed">
          This page auto-detects cloud services, databases, and environment config in your project
          by scanning for config files and package.json dependencies.
        </p>
        <div className="text-[11px] text-neutral-600 text-center leading-relaxed space-y-1">
          <p className="text-neutral-500 font-medium">Detected services include:</p>
          <p>Firebase, Supabase, Vercel, Netlify, AWS, Docker, Prisma, Drizzle, Stripe, Sentry, MongoDB, Redis, and .env files</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Services */}
      {services.length > 0 && (
        <CollapsibleSection
          title="Services"
          count={services.length}
          icon={<Cloud size={14} className="text-blue-400" />}
        >
          <div className="space-y-2">
            {services.map((svc) => (
              <ServiceCard
                key={svc.configPath}
                name={svc.name}
                configFile={svc.configFile}
                dashboardUrl={svc.dashboardUrl}
                icon={svc.icon}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Environment Variables */}
      {envFiles.length > 0 && (
        <CollapsibleSection
          title="Environment Variables"
          count={envFiles.reduce((sum, f) => sum + f.varCount, 0)}
          icon={<KeyRound size={14} className="text-green-400" />}
        >
          <EnvFilePanel files={envFiles} />
        </CollapsibleSection>
      )}

      {/* Environment Templates */}
      {templates.length > 0 && (
        <CollapsibleSection
          title="Environment Templates"
          count={templates.length}
          icon={<FileText size={14} className="text-purple-400" />}
        >
          <div className="space-y-2">
            {templates.map((tpl) => (
              <div
                key={tpl.path}
                className="flex items-center gap-3 bg-neutral-800/40 rounded-lg border border-neutral-800 p-3"
              >
                <div className="p-2 bg-neutral-800 rounded-lg shrink-0">
                  <FileText size={16} className="text-neutral-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-200 font-medium truncate">{tpl.name}</p>
                  <p className="text-[10px] text-neutral-500">
                    {tpl.vars.length} variable{tpl.vars.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={() => openGenModal(tpl)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-cf text-xs font-medium
                             bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors shrink-0"
                >
                  <Wand2 size={12} />
                  Generate .env
                </button>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Generate .env Modal */}
      {genTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <div>
                <h3 className="text-sm font-semibold text-neutral-200">Generate .env from {genTemplate.name}</h3>
                <p className="text-[10px] text-neutral-500 mt-0.5">Fill in values for each variable</p>
              </div>
              <button
                onClick={() => setGenTemplate(null)}
                className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Variables */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {genTemplate.vars.map((v) => (
                <div key={v.key}>
                  {v.comment && (
                    <p className="text-[10px] text-neutral-500 mb-1">{v.comment}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-mono text-neutral-300 w-40 shrink-0 truncate" title={v.key}>
                      {v.key}
                    </label>
                    <input
                      type="text"
                      value={genValues[v.key] ?? ''}
                      onChange={(e) => setGenValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
                      placeholder={v.defaultValue || 'Enter value...'}
                      className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-xs
                                 text-neutral-200 font-mono placeholder:text-neutral-600
                                 focus:outline-none focus:border-purple-500/50"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-neutral-800">
              <button
                onClick={() => setGenTemplate(null)}
                className="px-3 py-1.5 rounded-cf text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={genSaving}
                className="flex items-center gap-1 px-4 py-1.5 rounded-cf text-xs font-medium text-white
                           bg-purple-500 hover:bg-purple-600 disabled:opacity-50 transition-colors"
              >
                {genSaving ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                {genSaving ? 'Generating...' : 'Generate .env'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Cloud, KeyRound, FileText, Loader2 } from 'lucide-react'
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
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}

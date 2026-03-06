import { useState, useCallback } from 'react'
import { Download, CheckCircle, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react'
import type { AppConfig } from '@shared/models'
import { Section, Toggle, Select } from './SettingsField'

interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string | null
  downloadUrl: string | null
  releaseNotes: string | null
}

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabGeneral({ config, onChange }: Props) {
  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checkForUpdates = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const result = await window.api.invoke('update:check')
      setUpdateInfo(result as UpdateInfo)
    } catch (e: any) {
      setError(e?.message || 'Failed to check for updates')
    } finally {
      setChecking(false)
    }
  }, [])

  const handleDownload = useCallback(async () => {
    if (!updateInfo?.downloadUrl) return
    try {
      await window.api.invoke('update:download', updateInfo.downloadUrl)
    } catch {
      setError('Failed to open download link')
    }
  }, [updateInfo])

  return (
    <div className="space-y-6">
      <Section title="Updates">
        <div className="space-y-3">
          <Toggle
            label="Check for updates automatically"
            hint="Check for new versions on launch"
            value={config.checkForUpdates}
            onChange={(v) => onChange({ checkForUpdates: v })}
          />

          <div className="flex items-center gap-3">
            <button
              onClick={checkForUpdates}
              disabled={checking}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-700 hover:bg-neutral-600 text-neutral-200 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
              {checking ? 'Checking...' : 'Check Now'}
            </button>

            {updateInfo && !updateInfo.available && (
              <span className="flex items-center gap-1.5 text-xs text-green-400">
                <CheckCircle className="w-3.5 h-3.5" />
                You're on the latest version
              </span>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5" />
              {error}
            </div>
          )}

          {updateInfo?.available && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-green-400">
                  v{updateInfo.latestVersion} available
                </span>
                <span className="text-xs text-neutral-500">
                  Current: v{updateInfo.currentVersion}
                </span>
              </div>

              {updateInfo.releaseNotes && (
                <div className="text-xs text-neutral-400 max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed border-t border-neutral-700/50 pt-2 mt-2">
                  {updateInfo.releaseNotes}
                </div>
              )}

              <button
                onClick={handleDownload}
                disabled={!updateInfo.downloadUrl}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors"
              >
                {updateInfo.downloadUrl ? (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    Download & Install
                  </>
                ) : (
                  <>
                    <ExternalLink className="w-3.5 h-3.5" />
                    No installer found for this platform
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </Section>

      <Section title="Application">
        <Toggle
          label="Demo mode"
          hint="Replace names and titles with placeholder data for screenshots"
          value={config.demoMode}
          onChange={(v) => onChange({ demoMode: v })}
        />
      </Section>

      <Section title="Notifications">
        <Toggle
          label="New email notifications"
          value={config.notifyOnNewEmail}
          onChange={(v) => onChange({ notifyOnNewEmail: v })}
        />
        <Toggle
          label="CLI completion notifications"
          hint="Notify when Claude/Gemini finishes a task"
          value={config.notifyOnClaudeDone}
          onChange={(v) => onChange({ notifyOnClaudeDone: v })}
        />
      </Section>

      <Section title="CLI">
        <Select
          label="Preferred CLI"
          value={config.preferredCLI}
          onChange={(v) => onChange({ preferredCLI: v as AppConfig['preferredCLI'] })}
          options={[
            { value: 'claude', label: 'Claude Code' },
            { value: 'gemini', label: 'Gemini CLI' },
            { value: 'codex', label: 'Codex CLI' },
          ]}
        />
      </Section>

      <Section title="About">
        <div className="text-xs text-neutral-500">
          Version {updateInfo?.currentVersion || '1.0.4'} (Electron)
        </div>
      </Section>
    </div>
  )
}

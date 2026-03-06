import { useState, useEffect } from 'react'
import { X, Check, Settings, Terminal, Cpu, Mail, Globe, Newspaper, Users } from 'lucide-react'
import type { AppConfig } from '@shared/models'
import { api } from '../../lib/api'
import SettingsTabGeneral from './SettingsTabGeneral'
import SettingsTabTerminal from './SettingsTabTerminal'
import SettingsTabEngine from './SettingsTabEngine'
import SettingsTabGmail from './SettingsTabGmail'
import SettingsTabBrowser from './SettingsTabBrowser'
import SettingsTabBriefing from './SettingsTabBriefing'
import SettingsTabTeam from './SettingsTabTeam'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const TABS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'engine', label: 'Engine', icon: Cpu },
  { id: 'gmail', label: 'Gmail', icon: Mail },
  { id: 'browser', label: 'Browser', icon: Globe },
  { id: 'briefing', label: 'Briefing', icon: Newspaper },
] as const

type TabId = (typeof TABS)[number]['id']

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      api.settings.get().then(setConfig).catch(() => {})
      setSaved(false)
    }
  }, [open])

  if (!open || !config) return null

  function handleChange(patch: Partial<AppConfig>) {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  async function handleSave() {
    if (!config) return
    await api.settings.set(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function renderTab() {
    const props = { config: config!, onChange: handleChange }
    switch (activeTab) {
      case 'general':
        return <SettingsTabGeneral {...props} />
      case 'team':
        return <SettingsTabTeam {...props} />
      case 'terminal':
        return <SettingsTabTerminal {...props} />
      case 'engine':
        return <SettingsTabEngine {...props} />
      case 'gmail':
        return <SettingsTabGmail {...props} />
      case 'browser':
        return <SettingsTabBrowser {...props} />
      case 'briefing':
        return <SettingsTabBriefing {...props} />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[720px] h-[80vh] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-200">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <nav className="w-[160px] shrink-0 border-r border-neutral-800 py-2">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 text-xs transition-colors ${
                    active
                      ? 'text-codefire-orange bg-codefire-orange/10'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                  }`}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              )
            })}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">{renderTab()}</div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-800">
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-400 mr-2">
              <Check size={12} /> Saved
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs text-neutral-400 hover:text-neutral-200
                       hover:bg-neutral-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 rounded text-xs bg-codefire-orange/20 text-codefire-orange
                       hover:bg-codefire-orange/30 transition-colors font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

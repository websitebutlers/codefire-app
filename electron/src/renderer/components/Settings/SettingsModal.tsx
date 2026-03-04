import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Check } from 'lucide-react'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const STORAGE_KEYS = {
  openRouterKey: 'codefire_openrouter_key',
  googleClientId: 'codefire_google_client_id',
  googleClientSecret: 'codefire_google_client_secret',
} as const

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [openRouterKey, setOpenRouterKey] = useState('')
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      setOpenRouterKey(localStorage.getItem(STORAGE_KEYS.openRouterKey) ?? '')
      setGoogleClientId(localStorage.getItem(STORAGE_KEYS.googleClientId) ?? '')
      setGoogleClientSecret(localStorage.getItem(STORAGE_KEYS.googleClientSecret) ?? '')
      setSaved(false)
    }
  }, [open])

  if (!open) return null

  function handleSave() {
    if (openRouterKey.trim()) {
      localStorage.setItem(STORAGE_KEYS.openRouterKey, openRouterKey.trim())
    } else {
      localStorage.removeItem(STORAGE_KEYS.openRouterKey)
    }
    if (googleClientId.trim()) {
      localStorage.setItem(STORAGE_KEYS.googleClientId, googleClientId.trim())
    } else {
      localStorage.removeItem(STORAGE_KEYS.googleClientId)
    }
    if (googleClientSecret.trim()) {
      localStorage.setItem(STORAGE_KEYS.googleClientSecret, googleClientSecret.trim())
    } else {
      localStorage.removeItem(STORAGE_KEYS.googleClientSecret)
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function toggleVisibility(key: string) {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] max-h-[80vh] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl flex flex-col">
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* OpenRouter API Key */}
          <section>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
              Image Generation
            </h3>
            <label className="text-xs text-neutral-500 block mb-1.5">OpenRouter API Key</label>
            <p className="text-[10px] text-neutral-600 mb-2">
              Used for AI image generation. Get one at{' '}
              <span className="text-codefire-orange">openrouter.ai</span>
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  type={showKeys.openrouter ? 'text' : 'password'}
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                  placeholder="sk-or-..."
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                             text-xs text-neutral-200 placeholder:text-neutral-600
                             focus:outline-none focus:border-codefire-orange/50"
                />
                <button
                  type="button"
                  onClick={() => toggleVisibility('openrouter')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-neutral-400"
                >
                  {showKeys.openrouter ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </div>
          </section>

          {/* Gmail / Google OAuth */}
          <section>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
              Gmail Integration
            </h3>
            <p className="text-[10px] text-neutral-600 mb-3">
              Create OAuth credentials in the{' '}
              <span className="text-codefire-orange">Google Cloud Console</span>
              {' '}to enable Gmail email polling and triage.
            </p>

            <label className="text-xs text-neutral-500 block mb-1.5">Google Client ID</label>
            <div className="relative mb-3">
              <input
                type={showKeys.googleId ? 'text' : 'password'}
                value={googleClientId}
                onChange={(e) => setGoogleClientId(e.target.value)}
                placeholder="123456789.apps.googleusercontent.com"
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                           text-xs text-neutral-200 placeholder:text-neutral-600
                           focus:outline-none focus:border-codefire-orange/50"
              />
              <button
                type="button"
                onClick={() => toggleVisibility('googleId')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-neutral-400"
              >
                {showKeys.googleId ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>

            <label className="text-xs text-neutral-500 block mb-1.5">Google Client Secret</label>
            <div className="relative">
              <input
                type={showKeys.googleSecret ? 'text' : 'password'}
                value={googleClientSecret}
                onChange={(e) => setGoogleClientSecret(e.target.value)}
                placeholder="GOCSPX-..."
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                           text-xs text-neutral-200 placeholder:text-neutral-600
                           focus:outline-none focus:border-codefire-orange/50"
              />
              <button
                type="button"
                onClick={() => toggleVisibility('googleSecret')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-neutral-400"
              >
                {showKeys.googleSecret ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>

            <p className="text-[10px] text-neutral-600 mt-2">
              After saving, restart the app for Gmail changes to take effect.
            </p>
          </section>

          {/* General */}
          <section>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
              General
            </h3>
            <div className="text-xs text-neutral-500">
              Version 1.0.4 (Electron)
            </div>
          </section>
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

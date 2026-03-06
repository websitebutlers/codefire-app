import { ArrowLeft, ArrowRight, RotateCw, Home, Camera, Bug } from 'lucide-react'
import { useState, useEffect, type KeyboardEvent } from 'react'

interface BrowserToolbarProps {
  url: string
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onScreenshot: () => void
  onCaptureIssue?: () => void
  canGoBack: boolean
  canGoForward: boolean
}

export default function BrowserToolbar({
  url,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onScreenshot,
  onCaptureIssue,
  canGoBack,
  canGoForward,
}: BrowserToolbarProps) {
  const [inputUrl, setInputUrl] = useState(url)

  useEffect(() => {
    setInputUrl(url)
  }, [url])

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      let targetUrl = inputUrl.trim()
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = `https://${targetUrl}`
      }
      setInputUrl(targetUrl)
      onNavigate(targetUrl)
    }
  }

  const btnClass =
    'p-1.5 text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed'

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-neutral-800 bg-neutral-900">
      <button type="button" onClick={onBack} disabled={!canGoBack} className={btnClass}>
        <ArrowLeft size={14} />
      </button>
      <button type="button" onClick={onForward} disabled={!canGoForward} className={btnClass}>
        <ArrowRight size={14} />
      </button>
      <button type="button" onClick={onReload} className={btnClass}>
        <RotateCw size={14} />
      </button>
      <button type="button" onClick={() => onNavigate('about:blank')} className={btnClass}>
        <Home size={14} />
      </button>

      <input
        type="text"
        value={inputUrl}
        onChange={(e) => setInputUrl(e.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1 text-xs text-neutral-200 font-mono placeholder:text-neutral-600 focus:outline-none focus:border-codefire-orange/50"
        placeholder="Enter URL..."
      />

      <button type="button" onClick={onScreenshot} className={btnClass} title="Screenshot">
        <Camera size={14} />
      </button>
      {onCaptureIssue && (
        <button type="button" onClick={onCaptureIssue} className={btnClass} title="Capture Issue">
          <Bug size={14} />
        </button>
      )}
    </div>
  )
}

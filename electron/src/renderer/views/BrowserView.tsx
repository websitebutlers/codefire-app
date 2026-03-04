import { useState, useRef, useCallback, useEffect } from 'react'
import { useBrowserTabs } from '@renderer/hooks/useBrowserTabs'
import BrowserTabStrip from '@renderer/components/Browser/BrowserTabStrip'
import BrowserToolbar from '@renderer/components/Browser/BrowserToolbar'

interface BrowserViewProps {
  projectId: string
}

interface ConsoleEntry {
  level: string
  message: string
  timestamp: number
}

export default function BrowserView({ projectId: _projectId }: BrowserViewProps) {
  const {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    updateTab,
    navigateTab,
  } = useBrowserTabs()

  const webviewContainerRef = useRef<HTMLDivElement>(null)
  const webviewRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [showConsole, setShowConsole] = useState(false)

  // Create/remove webviews when tabs change
  useEffect(() => {
    const container = webviewContainerRef.current
    if (!container) return

    // Add webviews for new tabs
    for (const tab of tabs) {
      if (!webviewRefs.current.has(tab.id)) {
        const wv = document.createElement('webview') as any
        wv.setAttribute('src', tab.url)
        wv.setAttribute('allowpopups', 'true')
        wv.style.width = '100%'
        wv.style.height = '100%'
        wv.style.display = tab.id === activeTabId ? 'flex' : 'none'

        wv.addEventListener('page-title-updated', (e: any) => {
          updateTab(tab.id, { title: e.title })
        })
        wv.addEventListener('did-navigate', (e: any) => {
          updateTab(tab.id, { url: e.url })
        })
        wv.addEventListener('did-navigate-in-page', (e: any) => {
          if (e.isMainFrame) updateTab(tab.id, { url: e.url })
        })
        wv.addEventListener('did-start-loading', () => {
          updateTab(tab.id, { isLoading: true })
        })
        wv.addEventListener('did-stop-loading', () => {
          updateTab(tab.id, { isLoading: false })
          if (tab.id === activeTabId) {
            setCanGoBack(wv.canGoBack())
            setCanGoForward(wv.canGoForward())
          }
        })
        wv.addEventListener('console-message', (e: any) => {
          setConsoleEntries((prev) => [
            ...prev.slice(-499),
            {
              level: ['verbose', 'info', 'warning', 'error'][e.level] ?? 'info',
              message: e.message,
              timestamp: Date.now(),
            },
          ])
        })

        container.appendChild(wv)
        webviewRefs.current.set(tab.id, wv)
      }
    }

    // Remove webviews for closed tabs
    const tabIds = new Set(tabs.map((t) => t.id))
    for (const [id, wv] of webviewRefs.current.entries()) {
      if (!tabIds.has(id)) {
        wv.remove()
        webviewRefs.current.delete(id)
      }
    }
  }, [tabs, activeTabId, updateTab])

  // Show/hide webviews based on active tab
  useEffect(() => {
    for (const [id, wv] of webviewRefs.current.entries()) {
      ;(wv as HTMLElement).style.display = id === activeTabId ? 'flex' : 'none'
    }
    const activeWv = webviewRefs.current.get(activeTabId) as any
    if (activeWv && activeWv.canGoBack) {
      setCanGoBack(activeWv.canGoBack())
      setCanGoForward(activeWv.canGoForward())
    }
  }, [activeTabId])

  const getActiveWebview = useCallback(() => {
    return webviewRefs.current.get(activeTabId) as any
  }, [activeTabId])

  function handleNavigate(url: string) {
    navigateTab(activeTabId, url)
    const wv = getActiveWebview()
    if (wv) wv.loadURL(url)
  }

  function handleScreenshot() {
    const wv = getActiveWebview()
    if (wv && wv.capturePage) {
      wv.capturePage().then((img: any) => {
        const dataUrl = img.toDataURL()
        const w = window.open('')
        if (w) {
          w.document.write(`<img src="${dataUrl}" style="max-width:100%">`)
        }
      })
    }
  }

  return (
    <div className="flex flex-col h-full">
      <BrowserTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={closeTab}
        onAdd={() => addTab()}
      />

      <BrowserToolbar
        url={activeTab.url}
        onNavigate={handleNavigate}
        onBack={() => getActiveWebview()?.goBack()}
        onForward={() => getActiveWebview()?.goForward()}
        onReload={() => getActiveWebview()?.reload()}
        onScreenshot={handleScreenshot}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
      />

      {/* Webview container */}
      <div ref={webviewContainerRef} className="flex-1 relative bg-white" />

      {/* Console panel */}
      {showConsole && (
        <div className="h-48 border-t border-neutral-800 bg-neutral-900 flex flex-col">
          <div className="flex items-center justify-between px-3 py-1 border-b border-neutral-800">
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
              Console
            </span>
            <button
              type="button"
              onClick={() => setConsoleEntries([])}
              className="text-[10px] text-neutral-600 hover:text-neutral-400"
            >
              Clear
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px]">
            {consoleEntries.map((entry, i) => (
              <div
                key={i}
                className={`py-0.5 ${
                  entry.level === 'error'
                    ? 'text-red-400'
                    : entry.level === 'warning'
                      ? 'text-yellow-400'
                      : 'text-neutral-400'
                }`}
              >
                <span className="text-neutral-600 mr-2">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                {entry.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Console toggle footer */}
      <div className="flex items-center px-3 py-1 border-t border-neutral-800 bg-neutral-900">
        <button
          type="button"
          onClick={() => setShowConsole(!showConsole)}
          className="text-[10px] text-neutral-600 hover:text-codefire-orange transition-colors"
        >
          {showConsole ? 'Hide Console' : 'Show Console'}
        </button>
      </div>
    </div>
  )
}

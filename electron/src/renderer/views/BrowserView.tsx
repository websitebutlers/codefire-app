import { useState, useRef, useCallback, useEffect } from 'react'
import { Globe } from 'lucide-react'
import { useBrowserTabs } from '@renderer/hooks/useBrowserTabs'
import BrowserTabStrip from '@renderer/components/Browser/BrowserTabStrip'
import BrowserToolbar from '@renderer/components/Browser/BrowserToolbar'
import CaptureIssueSheet from '@renderer/components/Browser/CaptureIssueSheet'
import ScreenshotAnnotation from '@renderer/components/Browser/ScreenshotAnnotation'
import DevToolsPanel from '@renderer/components/Browser/DevToolsPanel'

/** Block dangerous URL schemes and cloud metadata endpoints */
function isUrlSafe(url: string): boolean {
  const lower = url.trim().toLowerCase()
  const blocked = ['javascript:', 'file:', 'data:', 'blob:', 'vbscript:']
  if (blocked.some((scheme) => lower.startsWith(scheme))) return false
  // Block cloud metadata IPs
  try {
    const parsed = new URL(lower.startsWith('http') ? lower : `https://${lower}`)
    const host = parsed.hostname
    if (host === '169.254.169.254' || host === '100.100.100.200' || host === 'metadata.google.internal') return false
  } catch { /* not a valid URL — let the browser handle it */ }
  return true
}

interface BrowserViewProps {
  projectId: string
}

interface ConsoleEntry {
  level: string
  message: string
  timestamp: number
}

export default function BrowserView({ projectId }: BrowserViewProps) {
  const {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    updateTab,
    navigateTab,
  } = useBrowserTabs('about:blank')

  const webviewContainerRef = useRef<HTMLDivElement>(null)
  const webviewRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [showConsole, setShowConsole] = useState(false)
  const [showCaptureIssue, setShowCaptureIssue] = useState(false)
  const [captureScreenshot, setCaptureScreenshot] = useState<string | null>(null)
  const [showAnnotation, setShowAnnotation] = useState(false)
  const [annotationScreenshot, setAnnotationScreenshot] = useState<string | null>(null)
  const urlBarRef = useRef<HTMLInputElement>(null)

  // Resize webviews to match container using explicit pixel dimensions
  useEffect(() => {
    const container = webviewContainerRef.current
    if (!container) return

    function syncSize() {
      const w = container!.clientWidth
      const h = container!.clientHeight
      for (const [, wv] of webviewRefs.current.entries()) {
        const el = wv as HTMLElement
        el.setAttribute('style', `display:inline-flex;width:${w}px;height:${h}px;border:none;`)
      }
    }

    const ro = new ResizeObserver(syncSize)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // Create/remove webviews when tabs change
  useEffect(() => {
    const container = webviewContainerRef.current
    if (!container) return

    for (const tab of tabs) {
      // Don't create a webview for about:blank tabs (show placeholder instead)
      if (tab.url === 'about:blank') continue
      if (webviewRefs.current.has(tab.id)) continue

      const wv = document.createElement('webview') as any
      wv.setAttribute('src', tab.url)
      wv.setAttribute('allowpopups', 'true')
      wv.setAttribute('partition', 'persist:browser')
      const w = container.clientWidth
      const h = container.clientHeight
      const vis = tab.id === activeTabId ? 'inline-flex' : 'none'
      wv.setAttribute('style', `display:${vis};width:${w}px;height:${h}px;border:none;`)

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
      wv.addEventListener('did-fail-load', (e: any) => {
        if (e.errorCode !== -3) {
          updateTab(tab.id, {
            isLoading: false,
            title: `Error: ${e.errorDescription || 'Failed to load'}`,
          })
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
    const container = webviewContainerRef.current
    for (const [id, wv] of webviewRefs.current.entries()) {
      const el = wv as HTMLElement
      const w = container?.clientWidth ?? 0
      const h = container?.clientHeight ?? 0
      if (id === activeTabId) {
        el.setAttribute('style', `display:inline-flex;width:${w}px;height:${h}px;border:none;`)
      } else {
        el.setAttribute('style', `display:none;`)
      }
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

  // Handle MCP browser commands from the main process
  useEffect(() => {
    const cleanup = window.api.on('browser:commandRequest', async (data: any) => {
      const { id, tool, args } = data
      const resultChannel = `browser:commandResult:${id}`

      try {
        const wv = webviewRefs.current.get(activeTabId) as any
        let result: any

        switch (tool) {
          case 'browser_navigate': {
            if (!wv) throw new Error('No active webview')
            if (!isUrlSafe(args.url)) throw new Error(`Blocked navigation to unsafe URL: ${args.url}`)
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Navigation timed out')), 30_000)
              const onStop = () => { clearTimeout(timeout); resolve() }
              wv.addEventListener('did-stop-loading', onStop, { once: true })
              wv.loadURL(args.url)
            })
            result = { success: true, url: args.url }
            break
          }
          case 'browser_snapshot': {
            if (!wv) throw new Error('No active webview')
            const html = await wv.executeJavaScript('document.documentElement.outerHTML')
            const maxSize = args.max_size || 50000
            result = { html: html.slice(0, maxSize) }
            break
          }
          case 'browser_screenshot': {
            if (!wv) throw new Error('No active webview')
            const img = await wv.capturePage()
            result = { image: img.toDataURL() }
            break
          }
          case 'browser_click': {
            if (!wv) throw new Error('No active webview')
            const clickResult = await wv.executeJavaScript(`
              (() => {
                const el = document.querySelector('[data-ref="${args.ref}"]');
                if (!el) return { error: 'Element not found with ref: ${args.ref}' };
                el.click();
                return { success: true };
              })()
            `)
            if (clickResult.error) throw new Error(clickResult.error)
            result = clickResult
            break
          }
          case 'browser_type': {
            if (!wv) throw new Error('No active webview')
            const typeResult = await wv.executeJavaScript(`
              (() => {
                const el = document.querySelector('[data-ref="${args.ref}"]');
                if (!el) return { error: 'Element not found with ref: ${args.ref}' };
                el.value = ${JSON.stringify(args.text || '')};
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true };
              })()
            `)
            if (typeResult.error) throw new Error(typeResult.error)
            result = typeResult
            break
          }
          case 'browser_eval': {
            if (!wv) throw new Error('No active webview')
            const evalResult = await wv.executeJavaScript(args.expression || args.code || '')
            result = { value: evalResult }
            break
          }
          case 'browser_console_logs': {
            result = { entries: consoleEntries }
            break
          }
          default:
            throw new Error(`Unsupported browser command: ${tool}`)
        }

        window.api.send(resultChannel, result)
      } catch (err: any) {
        window.api.send(resultChannel, { error: err.message || String(err) })
      }
    })

    return cleanup
  }, [activeTabId, consoleEntries])

  // Keyboard shortcuts: Ctrl/Cmd+T, W, R, L
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      switch (e.key.toLowerCase()) {
        case 't':
          e.preventDefault()
          addTab()
          break
        case 'w':
          e.preventDefault()
          closeTab(activeTabId)
          break
        case 'r':
          e.preventDefault()
          getActiveWebview()?.reload()
          break
        case 'l':
          e.preventDefault()
          urlBarRef.current?.focus()
          urlBarRef.current?.select()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTabId, addTab, closeTab, getActiveWebview])

  function handleNavigate(url: string) {
    // Normalize URL
    let normalized = url.trim()
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://') && !normalized.startsWith('about:')) {
      if (normalized.includes('.') && !normalized.includes(' ')) {
        normalized = `https://${normalized}`
      } else {
        normalized = `https://www.google.com/search?q=${encodeURIComponent(normalized)}`
      }
    }

    if (!isUrlSafe(normalized)) return

    navigateTab(activeTabId, normalized)

    const wv = getActiveWebview()
    if (wv) {
      wv.loadURL(normalized)
    }
    // If no webview exists yet (was about:blank), the useEffect will create one
    // since we just updated the tab URL away from about:blank
  }

  function handleScreenshot() {
    const wv = getActiveWebview()
    if (wv && wv.capturePage) {
      wv.capturePage().then((img: any) => {
        const dataUrl = img.toDataURL()
        setAnnotationScreenshot(dataUrl)
        setShowAnnotation(true)
      })
    }
  }

  function handleAnnotationDone(dataUrl: string) {
    setShowAnnotation(false)
    setAnnotationScreenshot(null)
    // Save the annotated screenshot via IPC
    try {
      window.api.invoke(
        'browser:saveScreenshot' as any,
        projectId,
        dataUrl,
        activeTab.url,
        activeTab.title || activeTab.url
      )
    } catch {
      // Non-fatal
    }
  }

  function handleAnnotationCancel() {
    setShowAnnotation(false)
    setAnnotationScreenshot(null)
  }

  function handleCaptureIssue() {
    const wv = getActiveWebview()
    if (wv && wv.capturePage) {
      wv.capturePage().then((img: any) => {
        setCaptureScreenshot(img.toDataURL())
        setShowCaptureIssue(true)
      })
    } else {
      setCaptureScreenshot(null)
      setShowCaptureIssue(true)
    }
  }

  const hasWebview = activeTab.url !== 'about:blank' && webviewRefs.current.has(activeTabId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0%', minHeight: 0, overflow: 'hidden' }}>
      <BrowserTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={closeTab}
        onAdd={() => addTab()}
      />

      <BrowserToolbar
        url={activeTab.url === 'about:blank' ? '' : activeTab.url}
        onNavigate={handleNavigate}
        onBack={() => getActiveWebview()?.goBack()}
        onForward={() => getActiveWebview()?.goForward()}
        onReload={() => getActiveWebview()?.reload()}
        onScreenshot={handleScreenshot}
        onCaptureIssue={handleCaptureIssue}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        urlInputRef={urlBarRef}
      />

      {/* Webview container */}
      <div
        ref={webviewContainerRef}
        className="flex-1 min-h-0 overflow-hidden relative"
      >
        {/* Placeholder shown when no page is loaded */}
        {!hasWebview && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900">
            <Globe size={32} className="text-neutral-700 mb-3" />
            <p className="text-sm text-neutral-600">Enter a URL to get started</p>
          </div>
        )}
      </div>

      {/* DevTools panel (Console, Network, Elements) */}
      {showConsole && (
        <DevToolsPanel
          consoleEntries={consoleEntries}
          onClearConsole={() => setConsoleEntries([])}
          getActiveWebview={getActiveWebview}
        />
      )}

      {/* Console toggle footer */}
      <div className="flex items-center px-3 py-1 border-t border-neutral-800 bg-neutral-900 shrink-0">
        <button
          type="button"
          onClick={() => setShowConsole(!showConsole)}
          className="text-[10px] text-neutral-600 hover:text-codefire-orange transition-colors"
        >
          {showConsole ? 'Hide DevTools' : 'Show DevTools'}
        </button>
      </div>

      {/* Capture Issue Sheet */}
      {showCaptureIssue && (
        <CaptureIssueSheet
          projectId={projectId}
          screenshotDataUrl={captureScreenshot}
          pageUrl={activeTab.url}
          pageTitle={activeTab.title || activeTab.url}
          consoleEntries={consoleEntries}
          onClose={() => setShowCaptureIssue(false)}
        />
      )}

      {/* Screenshot Annotation Overlay */}
      {showAnnotation && annotationScreenshot && (
        <ScreenshotAnnotation
          imageDataUrl={annotationScreenshot}
          onDone={handleAnnotationDone}
          onCancel={handleAnnotationCancel}
        />
      )}
    </div>
  )
}

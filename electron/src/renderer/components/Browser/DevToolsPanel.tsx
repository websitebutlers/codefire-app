import { useState, useEffect, useRef } from 'react'
import { Trash2, ArrowDown, Filter } from 'lucide-react'

interface ConsoleEntry {
  level: string
  message: string
  timestamp: number
}

interface NetworkEntry {
  url: string
  method: string
  status: number
  type: string
  size: number
  time: number
  timestamp: number
}

type DevTab = 'console' | 'network' | 'elements'

interface DevToolsPanelProps {
  consoleEntries: ConsoleEntry[]
  onClearConsole: () => void
  getActiveWebview: () => any
}

export default function DevToolsPanel({
  consoleEntries,
  onClearConsole,
  getActiveWebview,
}: DevToolsPanelProps) {
  const [activeTab, setActiveTab] = useState<DevTab>('console')
  const [networkEntries, setNetworkEntries] = useState<NetworkEntry[]>([])
  const [elementTree, setElementTree] = useState<string>('')
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const [consoleFilter, setConsoleFilter] = useState<string>('')
  const [networkFilter, setNetworkFilter] = useState<string>('')
  const [autoScroll, setAutoScroll] = useState(true)
  const consoleEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll console
  useEffect(() => {
    if (autoScroll && activeTab === 'console') {
      consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [consoleEntries, autoScroll, activeTab])

  // Capture network requests from webview
  useEffect(() => {
    if (activeTab !== 'network') return

    const wv = getActiveWebview()
    if (!wv) return

    const handleDidFinishLoad = () => {
      // Inject a performance observer to capture network activity
      try {
        wv.executeJavaScript(`
          (function() {
            if (window.__cfNetworkObserver) return;
            window.__cfNetworkObserver = true;
            const observer = new PerformanceObserver((list) => {
              const entries = list.getEntries().map(e => ({
                url: e.name,
                method: 'GET',
                status: 200,
                type: e.initiatorType || 'other',
                size: e.transferSize || 0,
                time: Math.round(e.duration),
                timestamp: Date.now(),
              }));
              console.log('__CF_NETWORK__' + JSON.stringify(entries));
            });
            observer.observe({ type: 'resource', buffered: true });
          })();
        `)
      } catch { /* webview may not be ready */ }
    }

    wv.addEventListener('did-finish-load', handleDidFinishLoad)
    handleDidFinishLoad()

    return () => {
      try { wv.removeEventListener('did-finish-load', handleDidFinishLoad) } catch {}
    }
  }, [activeTab, getActiveWebview])

  // Listen for network entries from console messages
  useEffect(() => {
    const networkFromConsole = consoleEntries
      .filter((e) => e.message.startsWith('__CF_NETWORK__'))
      .flatMap((e) => {
        try {
          return JSON.parse(e.message.slice('__CF_NETWORK__'.length))
        } catch {
          return []
        }
      })
    if (networkFromConsole.length > 0) {
      setNetworkEntries((prev) => [...prev, ...networkFromConsole].slice(-500))
    }
  }, [consoleEntries])

  // Fetch DOM tree for Elements tab
  useEffect(() => {
    if (activeTab !== 'elements') return

    const wv = getActiveWebview()
    if (!wv) {
      setElementTree('')
      return
    }

    const fetchTree = () => {
      try {
        wv.executeJavaScript(`
          (function buildTree(el, depth) {
            if (depth > 4) return '';
            const tag = el.tagName?.toLowerCase();
            if (!tag) return '';
            const indent = '  '.repeat(depth);
            const id = el.id ? ' id="' + el.id + '"' : '';
            const cls = el.className && typeof el.className === 'string'
              ? ' class="' + el.className.split(' ').slice(0, 3).join(' ') + (el.className.split(' ').length > 3 ? '...' : '') + '"'
              : '';
            const children = Array.from(el.children || []);
            if (children.length === 0) {
              const text = (el.textContent || '').trim().slice(0, 40);
              return indent + '<' + tag + id + cls + '>' + (text ? text + (el.textContent.trim().length > 40 ? '...' : '') : '') + '</' + tag + '>';
            }
            let result = indent + '<' + tag + id + cls + '>\\n';
            for (const child of children.slice(0, 20)) {
              const r = buildTree(child, depth + 1);
              if (r) result += r + '\\n';
            }
            if (children.length > 20) result += indent + '  <!-- ... ' + (children.length - 20) + ' more -->\\n';
            result += indent + '</' + tag + '>';
            return result;
          })(document.documentElement, 0);
        `).then((tree: string) => {
          setElementTree(tree || '<html></html>')
        }).catch(() => setElementTree(''))
      } catch {
        setElementTree('')
      }
    }

    fetchTree()
    const interval = setInterval(fetchTree, 5000) // refresh every 5s
    return () => clearInterval(interval)
  }, [activeTab, getActiveWebview])

  const filteredConsole = consoleFilter
    ? consoleEntries.filter((e) => e.message.toLowerCase().includes(consoleFilter.toLowerCase()) && !e.message.startsWith('__CF_NETWORK__'))
    : consoleEntries.filter((e) => !e.message.startsWith('__CF_NETWORK__'))

  const filteredNetwork = networkFilter
    ? networkEntries.filter((e) => e.url.toLowerCase().includes(networkFilter.toLowerCase()))
    : networkEntries

  const tabs: { id: DevTab; label: string }[] = [
    { id: 'console', label: `Console (${filteredConsole.length})` },
    { id: 'network', label: `Network (${networkEntries.length})` },
    { id: 'elements', label: 'Elements' },
  ]

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="h-60 border-t border-neutral-800 bg-neutral-900 flex flex-col shrink-0">
      {/* Tab bar */}
      <div className="flex items-center border-b border-neutral-800 shrink-0">
        <div className="flex items-center">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-[10px] font-medium transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'text-neutral-200 border-codefire-orange'
                  : 'text-neutral-500 border-transparent hover:text-neutral-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1 px-2">
          {activeTab === 'console' && (
            <>
              <input
                type="text"
                value={consoleFilter}
                onChange={(e) => setConsoleFilter(e.target.value)}
                placeholder="Filter..."
                className="w-24 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[10px] text-neutral-300 placeholder-neutral-600 focus:outline-none"
              />
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                className={`p-1 rounded transition-colors ${autoScroll ? 'text-codefire-orange' : 'text-neutral-600 hover:text-neutral-400'}`}
                title="Auto-scroll"
              >
                <ArrowDown size={12} />
              </button>
              <button
                onClick={onClearConsole}
                className="p-1 text-neutral-600 hover:text-neutral-400 transition-colors"
                title="Clear"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
          {activeTab === 'network' && (
            <>
              <input
                type="text"
                value={networkFilter}
                onChange={(e) => setNetworkFilter(e.target.value)}
                placeholder="Filter..."
                className="w-24 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[10px] text-neutral-300 placeholder-neutral-600 focus:outline-none"
              />
              <button
                onClick={() => setNetworkEntries([])}
                className="p-1 text-neutral-600 hover:text-neutral-400 transition-colors"
                title="Clear"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
          {activeTab === 'elements' && (
            <button
              onClick={() => {
                const wv = getActiveWebview()
                if (wv) {
                  // Force refresh
                  setElementTree('')
                  setTimeout(() => {
                    // The useEffect will re-fetch
                    setActiveTab('console')
                    setTimeout(() => setActiveTab('elements'), 0)
                  }, 0)
                }
              }}
              className="p-1 text-neutral-600 hover:text-neutral-400 transition-colors"
              title="Refresh"
            >
              <Filter size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto font-mono text-[11px]">
        {activeTab === 'console' && (
          <div className="p-2">
            {filteredConsole.map((entry, i) => (
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
            <div ref={consoleEndRef} />
          </div>
        )}

        {activeTab === 'network' && (
          <div>
            {/* Header */}
            <div className="flex items-center gap-2 px-2 py-1 text-[9px] text-neutral-600 uppercase tracking-wider border-b border-neutral-800 sticky top-0 bg-neutral-900">
              <span className="w-8">Status</span>
              <span className="w-12">Method</span>
              <span className="flex-1">URL</span>
              <span className="w-16 text-right">Type</span>
              <span className="w-16 text-right">Size</span>
              <span className="w-14 text-right">Time</span>
            </div>
            {filteredNetwork.length === 0 ? (
              <div className="p-4 text-center text-neutral-600 text-xs">
                No network requests captured. Navigate to a page to see requests.
              </div>
            ) : (
              filteredNetwork.map((entry, i) => {
                const urlObj = (() => { try { return new URL(entry.url) } catch { return null } })()
                const shortUrl = urlObj ? urlObj.pathname + urlObj.search : entry.url
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-0.5 hover:bg-neutral-800/50 text-neutral-400"
                    title={entry.url}
                  >
                    <span className={`w-8 ${entry.status >= 400 ? 'text-red-400' : 'text-green-400'}`}>
                      {entry.status}
                    </span>
                    <span className="w-12 text-neutral-500">{entry.method}</span>
                    <span className="flex-1 truncate">{shortUrl}</span>
                    <span className="w-16 text-right text-neutral-500">{entry.type}</span>
                    <span className="w-16 text-right text-neutral-500">{formatSize(entry.size)}</span>
                    <span className="w-14 text-right text-neutral-500">{entry.time}ms</span>
                  </div>
                )
              })
            )}
          </div>
        )}

        {activeTab === 'elements' && (
          <div className="p-2">
            {!elementTree ? (
              <div className="text-center text-neutral-600 text-xs py-4">
                No page loaded. Navigate to a page to inspect elements.
              </div>
            ) : (
              <pre className="text-neutral-400 whitespace-pre leading-relaxed">
                {elementTree.split('\n').map((line, i) => {
                  const isSelected = selectedElement === `line-${i}`
                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedElement(isSelected ? null : `line-${i}`)}
                      className={`px-1 -mx-1 rounded cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-500/20 text-blue-300'
                          : 'hover:bg-neutral-800'
                      }`}
                    >
                      {line.replace(/<(\w+)/g, (_, tag) => `<${tag}`).replace(/>/g, '>')}
                    </div>
                  )
                })}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

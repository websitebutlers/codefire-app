import { useState, useEffect, useRef, useCallback } from 'react'
import { Trash2, ArrowDown, Filter, RefreshCw, X, MousePointer2 } from 'lucide-react'

interface ConsoleEntry {
  level: string
  message: string
  timestamp: number
}

export interface NetworkEntry {
  id: number
  url: string
  method: string
  status: number
  statusText: string
  type: string
  size: number
  time: number
  timestamp: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
}

type DevTab = 'console' | 'network' | 'elements'
type NetworkTypeFilter = 'all' | 'xhr' | 'script' | 'css' | 'img' | 'font' | 'other'

interface DevToolsPanelProps {
  consoleEntries: ConsoleEntry[]
  onClearConsole: () => void
  getActiveWebview: () => any
}

let networkIdCounter = 0

export default function DevToolsPanel({
  consoleEntries,
  onClearConsole,
  getActiveWebview,
}: DevToolsPanelProps) {
  const [activeTab, setActiveTab] = useState<DevTab>('console')
  const [networkEntries, setNetworkEntries] = useState<NetworkEntry[]>([])
  const [elementTree, setElementTree] = useState<string>('')
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const [selectedRequest, setSelectedRequest] = useState<NetworkEntry | null>(null)
  const [consoleFilter, setConsoleFilter] = useState<string>('')
  const [networkFilter, setNetworkFilter] = useState<string>('')
  const [networkTypeFilter, setNetworkTypeFilter] = useState<NetworkTypeFilter>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [pickerActive, setPickerActive] = useState(false)
  const [pickedElement, setPickedElement] = useState<{ tag: string; id: string; classes: string; text: string; rect: string } | null>(null)
  const consoleEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll console
  useEffect(() => {
    if (autoScroll && activeTab === 'console') {
      consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [consoleEntries, autoScroll, activeTab])

  // Capture network requests via PerformanceObserver + XHR/fetch interception
  useEffect(() => {
    if (activeTab !== 'network') return

    const wv = getActiveWebview()
    if (!wv) return

    const injectNetworkCapture = () => {
      try {
        wv.executeJavaScript(`
          (function() {
            if (window.__cfNetworkCapture) return;
            window.__cfNetworkCapture = true;

            // Capture via PerformanceObserver (resource timings)
            const perfObserver = new PerformanceObserver((list) => {
              const entries = list.getEntries().map(e => ({
                url: e.name,
                method: 'GET',
                status: 200,
                statusText: 'OK',
                type: e.initiatorType || 'other',
                size: e.transferSize || 0,
                time: Math.round(e.duration),
                timestamp: Date.now(),
              }));
              if (entries.length > 0) {
                console.log('__CF_NET__' + JSON.stringify(entries));
              }
            });
            perfObserver.observe({ type: 'resource', buffered: true });

            // Intercept fetch for method/status/headers
            const origFetch = window.fetch;
            window.fetch = async function(...args) {
              const req = args[0] instanceof Request ? args[0] : new Request(args[0], args[1]);
              const method = req.method || 'GET';
              const url = req.url;
              const start = performance.now();
              const reqHeaders = {};
              req.headers.forEach((v, k) => { reqHeaders[k] = v; });

              try {
                const res = await origFetch.apply(this, args);
                const elapsed = Math.round(performance.now() - start);
                const resHeaders = {};
                res.headers.forEach((v, k) => { resHeaders[k] = v; });
                const contentType = res.headers.get('content-type') || '';
                const type = contentType.includes('json') ? 'xhr'
                  : contentType.includes('javascript') ? 'script'
                  : contentType.includes('css') ? 'css'
                  : contentType.includes('image') ? 'img'
                  : 'fetch';

                console.log('__CF_NET_DETAIL__' + JSON.stringify({
                  url, method,
                  status: res.status,
                  statusText: res.statusText,
                  type,
                  time: elapsed,
                  timestamp: Date.now(),
                  requestHeaders: reqHeaders,
                  responseHeaders: resHeaders,
                }));
                return res;
              } catch (err) {
                const elapsed = Math.round(performance.now() - start);
                console.log('__CF_NET_DETAIL__' + JSON.stringify({
                  url, method, status: 0, statusText: 'Failed', type: 'fetch',
                  time: elapsed, timestamp: Date.now(),
                  requestHeaders: reqHeaders,
                }));
                throw err;
              }
            };

            // Intercept XMLHttpRequest
            const XHR = XMLHttpRequest.prototype;
            const origOpen = XHR.open;
            const origSend = XHR.send;
            const origSetHeader = XHR.setRequestHeader;

            XHR.open = function(method, url) {
              this.__cfMethod = method;
              this.__cfUrl = url;
              this.__cfHeaders = {};
              return origOpen.apply(this, arguments);
            };
            XHR.setRequestHeader = function(key, value) {
              if (this.__cfHeaders) this.__cfHeaders[key] = value;
              return origSetHeader.apply(this, arguments);
            };
            XHR.send = function() {
              const start = performance.now();
              const xhr = this;
              xhr.addEventListener('loadend', function() {
                const elapsed = Math.round(performance.now() - start);
                const resHeaders = {};
                (xhr.getAllResponseHeaders() || '').split('\\r\\n').forEach(line => {
                  const idx = line.indexOf(':');
                  if (idx > 0) resHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
                });
                console.log('__CF_NET_DETAIL__' + JSON.stringify({
                  url: xhr.__cfUrl,
                  method: xhr.__cfMethod || 'GET',
                  status: xhr.status,
                  statusText: xhr.statusText || '',
                  type: 'xhr',
                  size: xhr.responseText ? xhr.responseText.length : 0,
                  time: elapsed,
                  timestamp: Date.now(),
                  requestHeaders: xhr.__cfHeaders || {},
                  responseHeaders: resHeaders,
                }));
              });
              return origSend.apply(this, arguments);
            };
          })();
        `)
      } catch { /* webview may not be ready */ }
    }

    wv.addEventListener('did-finish-load', injectNetworkCapture)
    injectNetworkCapture()

    return () => {
      try { wv.removeEventListener('did-finish-load', injectNetworkCapture) } catch {}
    }
  }, [activeTab, getActiveWebview])

  // Parse element picker results from console messages
  useEffect(() => {
    for (const entry of consoleEntries) {
      if (entry.message.startsWith('__CF_PICK__')) {
        try {
          const info = JSON.parse(entry.message.slice('__CF_PICK__'.length))
          setPickedElement(info)
          setPickerActive(false)
        } catch {}
      }
    }
  }, [consoleEntries])

  // Parse network entries from console messages
  useEffect(() => {
    for (const entry of consoleEntries) {
      if (entry.message.startsWith('__CF_NET__')) {
        try {
          const items = JSON.parse(entry.message.slice('__CF_NET__'.length)) as Array<Omit<NetworkEntry, 'id'>>
          setNetworkEntries((prev) => {
            const newEntries = items.map((item) => ({ ...item, id: ++networkIdCounter }))
            return [...prev, ...newEntries].slice(-500)
          })
        } catch {}
      } else if (entry.message.startsWith('__CF_NET_DETAIL__')) {
        try {
          const item = JSON.parse(entry.message.slice('__CF_NET_DETAIL__'.length))
          setNetworkEntries((prev) =>
            [...prev, { ...item, id: ++networkIdCounter, size: item.size || 0 }].slice(-500)
          )
        } catch {}
      }
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
    const interval = setInterval(fetchTree, 5000)
    return () => clearInterval(interval)
  }, [activeTab, getActiveWebview])

  const filteredConsole = consoleFilter
    ? consoleEntries.filter((e) =>
        e.message.toLowerCase().includes(consoleFilter.toLowerCase()) &&
        !e.message.startsWith('__CF_NET')
      )
    : consoleEntries.filter((e) => !e.message.startsWith('__CF_NET') && !e.message.startsWith('__CF_PICK__'))

  const filteredNetwork = networkEntries.filter((e) => {
    if (networkFilter && !e.url.toLowerCase().includes(networkFilter.toLowerCase())) return false
    if (networkTypeFilter === 'all') return true
    if (networkTypeFilter === 'other') {
      return !['xhr', 'script', 'css', 'img', 'font', 'fetch'].includes(e.type)
    }
    if (networkTypeFilter === 'xhr') return e.type === 'xhr' || e.type === 'fetch'
    return e.type === networkTypeFilter
  })

  const tabs: { id: DevTab; label: string }[] = [
    { id: 'console', label: `Console (${filteredConsole.length})` },
    { id: 'network', label: `Network (${networkEntries.length})` },
    { id: 'elements', label: 'Elements' },
  ]

  const typeFilters: { id: NetworkTypeFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'xhr', label: 'XHR' },
    { id: 'script', label: 'JS' },
    { id: 'css', label: 'CSS' },
    { id: 'img', label: 'Img' },
    { id: 'font', label: 'Font' },
    { id: 'other', label: 'Other' },
  ]

  return (
    <div className="h-60 border-t border-neutral-800 bg-neutral-900 flex flex-col shrink-0">
      {/* Tab bar */}
      <div className="flex items-center border-b border-neutral-800 shrink-0">
        <div className="flex items-center">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedRequest(null) }}
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
              {typeFilters.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setNetworkTypeFilter(f.id)}
                  className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                    networkTypeFilter === f.id
                      ? 'bg-neutral-700 text-neutral-200'
                      : 'text-neutral-600 hover:text-neutral-400'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <div className="w-px h-3 bg-neutral-700 mx-0.5" />
              <input
                type="text"
                value={networkFilter}
                onChange={(e) => setNetworkFilter(e.target.value)}
                placeholder="Filter URL..."
                className="w-24 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[10px] text-neutral-300 placeholder-neutral-600 focus:outline-none"
              />
              <button
                onClick={() => { setNetworkEntries([]); setSelectedRequest(null) }}
                className="p-1 text-neutral-600 hover:text-neutral-400 transition-colors"
                title="Clear"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
          {activeTab === 'elements' && (
            <>
              <button
                onClick={() => {
                  const wv = getActiveWebview()
                  if (!wv) return
                  const newState = !pickerActive
                  setPickerActive(newState)
                  setPickedElement(null)
                  if (newState) {
                    wv.executeJavaScript(`
                      (function() {
                        if (window.__cfPickerCleanup) window.__cfPickerCleanup();
                        let overlay = document.createElement('div');
                        overlay.id = '__cf_picker_overlay';
                        overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #f97316;background:rgba(249,115,22,0.1);z-index:2147483647;transition:all 0.05s;display:none;';
                        document.body.appendChild(overlay);
                        function onMove(e) {
                          const el = document.elementFromPoint(e.clientX, e.clientY);
                          if (!el || el === overlay) return;
                          const r = el.getBoundingClientRect();
                          overlay.style.display = 'block';
                          overlay.style.left = r.left + 'px';
                          overlay.style.top = r.top + 'px';
                          overlay.style.width = r.width + 'px';
                          overlay.style.height = r.height + 'px';
                        }
                        function onClick(e) {
                          e.preventDefault();
                          e.stopPropagation();
                          const el = document.elementFromPoint(e.clientX, e.clientY);
                          if (!el || el === overlay) return;
                          const r = el.getBoundingClientRect();
                          const info = {
                            tag: el.tagName.toLowerCase(),
                            id: el.id || '',
                            classes: el.className && typeof el.className === 'string' ? el.className : '',
                            text: (el.textContent || '').trim().slice(0, 100),
                            rect: Math.round(r.width) + 'x' + Math.round(r.height) + ' at (' + Math.round(r.left) + ',' + Math.round(r.top) + ')'
                          };
                          console.log('__CF_PICK__' + JSON.stringify(info));
                          cleanup();
                        }
                        function cleanup() {
                          document.removeEventListener('mousemove', onMove, true);
                          document.removeEventListener('click', onClick, true);
                          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                          delete window.__cfPickerCleanup;
                        }
                        window.__cfPickerCleanup = cleanup;
                        document.addEventListener('mousemove', onMove, true);
                        document.addEventListener('click', onClick, true);
                      })();
                    `).catch(() => {})
                  } else {
                    wv.executeJavaScript(`if (window.__cfPickerCleanup) window.__cfPickerCleanup();`).catch(() => {})
                  }
                }}
                className={`p-1 rounded transition-colors ${pickerActive ? 'text-codefire-orange bg-codefire-orange/20' : 'text-neutral-600 hover:text-neutral-400'}`}
                title="Element picker — click to select an element on the page"
              >
                <MousePointer2 size={12} />
              </button>
              <button
                onClick={() => {
                  setElementTree('')
                  setTimeout(() => {
                    setActiveTab('console')
                    setTimeout(() => setActiveTab('elements'), 0)
                  }, 0)
                }}
                className="p-1 text-neutral-600 hover:text-neutral-400 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        <div className={`${selectedRequest ? 'w-1/2' : 'w-full'} overflow-y-auto font-mono text-[11px]`}>
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
                <span className="w-10">Status</span>
                <span className="w-10">Method</span>
                <span className="flex-1">URL</span>
                <span className="w-12 text-right">Type</span>
                <span className="w-14 text-right">Size</span>
                <span className="w-12 text-right">Time</span>
              </div>
              {filteredNetwork.length === 0 ? (
                <div className="p-4 text-center text-neutral-600 text-xs">
                  No network requests captured. Navigate to a page to see requests.
                </div>
              ) : (
                filteredNetwork.map((entry) => {
                  const urlObj = (() => { try { return new URL(entry.url) } catch { return null } })()
                  const shortUrl = urlObj ? urlObj.pathname + urlObj.search : entry.url
                  const isSelected = selectedRequest?.id === entry.id
                  return (
                    <div
                      key={entry.id}
                      onClick={() => setSelectedRequest(isSelected ? null : entry)}
                      className={`flex items-center gap-2 px-2 py-0.5 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-500/15 text-blue-300'
                          : 'text-neutral-400 hover:bg-neutral-800/50'
                      }`}
                      title={entry.url}
                    >
                      <span className={`w-10 ${statusColor(entry.status)}`}>
                        {entry.status || '---'}
                      </span>
                      <span className="w-10 text-neutral-500">{entry.method}</span>
                      <span className="flex-1 truncate">{shortUrl}</span>
                      <span className="w-12 text-right text-neutral-500">{entry.type}</span>
                      <span className="w-14 text-right text-neutral-500">{formatSize(entry.size)}</span>
                      <span className="w-12 text-right text-neutral-500">{entry.time}ms</span>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {activeTab === 'elements' && (
            <div className="p-2">
              {/* Picked element info */}
              {pickedElement && (
                <div className="mb-2 p-2 bg-neutral-800/60 rounded border border-neutral-700 text-[10px] space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-codefire-orange font-semibold">&lt;{pickedElement.tag}&gt;</span>
                    {pickedElement.id && <span className="text-blue-400">#{pickedElement.id}</span>}
                    <span className="text-neutral-500 ml-auto">{pickedElement.rect}</span>
                  </div>
                  {pickedElement.classes && (
                    <div className="text-neutral-400 truncate">
                      <span className="text-neutral-600">class: </span>
                      {pickedElement.classes}
                    </div>
                  )}
                  {pickedElement.text && (
                    <div className="text-neutral-500 truncate">
                      <span className="text-neutral-600">text: </span>
                      {pickedElement.text}
                    </div>
                  )}
                </div>
              )}
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

        {/* Request detail panel */}
        {selectedRequest && activeTab === 'network' && (
          <div className="w-1/2 border-l border-neutral-800 overflow-y-auto">
            <RequestDetailPanel
              request={selectedRequest}
              onClose={() => setSelectedRequest(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Request Detail Panel ──────────────────────────────────────────────────────

function RequestDetailPanel({
  request,
  onClose,
}: {
  request: NetworkEntry
  onClose: () => void
}) {
  const [detailTab, setDetailTab] = useState<'headers' | 'response'>('headers')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDetailTab('headers')}
            className={`px-2 py-0.5 text-[9px] rounded transition-colors ${
              detailTab === 'headers' ? 'bg-neutral-700 text-neutral-200' : 'text-neutral-500'
            }`}
          >
            Headers
          </button>
          <button
            onClick={() => setDetailTab('response')}
            className={`px-2 py-0.5 text-[9px] rounded transition-colors ${
              detailTab === 'response' ? 'bg-neutral-700 text-neutral-200' : 'text-neutral-500'
            }`}
          >
            Preview
          </button>
        </div>
        <button onClick={onClose} className="p-0.5 text-neutral-600 hover:text-neutral-400">
          <X size={10} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 text-[10px] font-mono">
        {detailTab === 'headers' && (
          <div className="space-y-3">
            {/* General */}
            <div>
              <div className="text-[9px] text-neutral-500 uppercase tracking-wider mb-1">General</div>
              <div className="space-y-0.5">
                <HeaderRow label="URL" value={request.url} />
                <HeaderRow label="Method" value={request.method} />
                <HeaderRow label="Status" value={`${request.status} ${request.statusText}`} />
                <HeaderRow label="Type" value={request.type} />
                <HeaderRow label="Duration" value={`${request.time}ms`} />
              </div>
            </div>

            {/* Response Headers */}
            {request.responseHeaders && Object.keys(request.responseHeaders).length > 0 && (
              <div>
                <div className="text-[9px] text-neutral-500 uppercase tracking-wider mb-1">Response Headers</div>
                <div className="space-y-0.5">
                  {Object.entries(request.responseHeaders).map(([k, v]) => (
                    <HeaderRow key={k} label={k} value={v} />
                  ))}
                </div>
              </div>
            )}

            {/* Request Headers */}
            {request.requestHeaders && Object.keys(request.requestHeaders).length > 0 && (
              <div>
                <div className="text-[9px] text-neutral-500 uppercase tracking-wider mb-1">Request Headers</div>
                <div className="space-y-0.5">
                  {Object.entries(request.requestHeaders).map(([k, v]) => (
                    <HeaderRow key={k} label={k} value={v} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {detailTab === 'response' && (
          <div className="text-neutral-500 text-center py-4">
            Response body preview not available for intercepted requests.
            <br />
            <span className="text-[9px] text-neutral-600">
              Use the Console tab to inspect response data.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function HeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-neutral-500 shrink-0">{label}:</span>
      <span className="text-neutral-300 break-all">{value}</span>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusColor(status: number): string {
  if (!status) return 'text-neutral-500'
  if (status >= 500) return 'text-red-400'
  if (status >= 400) return 'text-orange-400'
  if (status >= 300) return 'text-yellow-400'
  return 'text-green-400'
}

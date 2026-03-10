import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalTabProps {
  /** Unique ID for this terminal session */
  terminalId: string
  /** Whether this tab is currently visible */
  isActive: boolean
  /** Filesystem path for the project, used as the shell's cwd */
  projectPath: string
  /** Optional command to run after the shell starts */
  initialCommand?: string
}

/**
 * A single terminal tab backed by an xterm.js instance.
 *
 * - Sends keystrokes to main process via IPC `terminal:write`
 * - Receives PTY output via IPC `terminal:data`
 * - Auto-resizes via FitAddon + ResizeObserver
 * - Supports clickable URLs via WebLinksAddon
 */
/**
 * Paste text from clipboard, or if clipboard contains an image (no text),
 * save it to a temp file and insert the file path into the terminal.
 */
async function pasteWithImageFallback(termId: string) {
  // Try text first
  const text = await navigator.clipboard.readText().catch(() => '')
  if (text) {
    window.api.send('terminal:write', termId, text)
    return
  }

  // No text — check for image in clipboard
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith('image/'))
      if (imageType) {
        const blob = await item.getType(imageType)
        const buffer = await blob.arrayBuffer()
        const ext = imageType.split('/')[1] || 'png'
        // Save via IPC and get the temp file path back
        const filePath = await window.api.invoke(
          'terminal:saveClipboardImage',
          Array.from(new Uint8Array(buffer)),
          ext
        )
        if (typeof filePath === 'string') {
          // Insert the path, shell-escaped
          const escaped = filePath.includes(' ') ? `"${filePath}"` : filePath
          window.api.send('terminal:write', termId, escaped)
        }
        return
      }
    }
  } catch {
    // Clipboard API may not be available or permission denied — ignore
  }
}

export default function TerminalTab({ terminalId, isActive, projectPath, initialCommand }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // Track whether the PTY has exited so keystrokes restart instead of write
  const ptyExitedRef = useRef(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // ─── Create xterm.js instance ─────────────────────────────────────────
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"SF Mono", "Menlo", "Monaco", "Cascadia Code", "Consolas", "Courier New", monospace',
      rightClickSelectsWord: true,
      allowProposedApi: true,
      theme: {
        background: '#171717',
        foreground: '#e5e5e5',
        cursor: '#f97316',
        cursorAccent: '#171717',
        selectionBackground: 'rgba(249, 115, 22, 0.3)',
        black: '#171717',
        red: '#ef4444',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#22d3ee',
        white: '#e5e5e5',
        brightBlack: '#525252',
        brightRed: '#f87171',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#67e8f9',
        brightWhite: '#fafafa',
      },
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.open(container)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    ptyExitedRef.current = false

    // Initial fit
    try {
      fitAddon.fit()
    } catch {
      // Container may not be visible yet
    }

    // ─── Restart PTY helper ───────────────────────────────────────────────
    function restartPTY() {
      ptyExitedRef.current = false
      terminal.write('\r\n')
      window.api.invoke('terminal:create', terminalId, projectPath)
        .then(() => {
          terminal.clear()
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          terminal.write(`\r\n\x1b[31mFailed to restart terminal: ${msg}\x1b[0m\r\n`)
          ptyExitedRef.current = true
        })
    }

    // ─── Clipboard: Ctrl+Shift+C to copy, Ctrl+Shift+V to paste ──────────
    terminal.attachCustomKeyEventHandler((event) => {
      // Ctrl+Shift+C: copy selection
      if (event.ctrlKey && event.shiftKey && event.key === 'C' && event.type === 'keydown') {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
        }
        return false
      }
      // Ctrl+Shift+V: paste (text or image)
      if (event.ctrlKey && event.shiftKey && event.key === 'V' && event.type === 'keydown') {
        pasteWithImageFallback(terminalId)
        return false
      }
      // Ctrl+C with selection: copy instead of sending SIGINT
      if (event.ctrlKey && !event.shiftKey && event.key === 'c' && event.type === 'keydown') {
        if (terminal.hasSelection()) {
          navigator.clipboard.writeText(terminal.getSelection())
          terminal.clearSelection()
          return false
        }
      }
      // Ctrl+V: paste (text or image)
      if (event.ctrlKey && !event.shiftKey && event.key === 'v' && event.type === 'keydown') {
        pasteWithImageFallback(terminalId)
        return false
      }
      return true
    })

    // ─── Keystrokes → main process ────────────────────────────────────────
    const onDataDisposable = terminal.onData((data) => {
      // If PTY has exited, any keypress restarts the shell
      if (ptyExitedRef.current) {
        restartPTY()
        return
      }
      window.api.send('terminal:write', terminalId, data)
    })

    // ─── PTY output → xterm.js ────────────────────────────────────────────
    const removeDataListener = window.api.on(
      'terminal:data',
      (id: unknown, data: unknown) => {
        if (id === terminalId && typeof data === 'string') {
          terminal.write(data)
        }
      }
    )

    // ─── Create PTY AFTER listener is registered (eliminates race condition) ─
    window.api.invoke('terminal:create', terminalId, projectPath)
      .then(() => {
        if (initialCommand) {
          setTimeout(() => {
            window.api.send('terminal:write', terminalId, initialCommand + '\n')
          }, 300)
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        terminal.write(`\r\n\x1b[31mFailed to create terminal: ${msg}\x1b[0m\r\n`)
      })

    // ─── PTY exit ─────────────────────────────────────────────────────────
    const removeExitListener = window.api.on(
      'terminal:exit',
      (id: unknown, exitCode: unknown) => {
        if (id === terminalId) {
          ptyExitedRef.current = true
          terminal.write(`\r\n\x1b[90m[Process exited with code ${exitCode}. Press any key to restart.]\x1b[0m\r\n`)
        }
      }
    )

    // ─── Resize handling ──────────────────────────────────────────────────
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {
        // Ignore errors during disposal
      }
    })
    resizeObserver.observe(container)

    const onResizeDisposable = terminal.onResize(({ cols, rows }) => {
      window.api.send('terminal:resize', terminalId, cols, rows)
    })

    // ─── Cleanup ──────────────────────────────────────────────────────────
    return () => {
      onDataDisposable.dispose()
      onResizeDisposable.dispose()
      removeDataListener()
      removeExitListener()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [terminalId])

  // Re-fit when the tab becomes active (it may have been resized while hidden)
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      // Small delay to allow layout to settle
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit()
        } catch {
          // Ignore
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isActive])

  // Shell-escape a file path for safe pasting into terminal
  const shellEscape = (path: string): string => {
    // On Windows, wrap in double quotes if path contains spaces
    if (path.includes(' ') || path.includes('(') || path.includes(')')) {
      return `"${path.replace(/"/g, '\\"')}"`
    }
    return path
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
      setDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      const paths = files.map((f) => shellEscape(f.path)).join(' ')
      window.api.send('terminal:write', terminalId, paths)
    }
  }

  return (
    <div
      className="h-full w-full relative"
      style={{ display: isActive ? 'block' : 'none' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ backgroundColor: '#171717', padding: '8px 4px 4px 8px' }}
      />
      {dragOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 border-2 border-dashed border-codefire-orange/60 rounded pointer-events-none z-10">
          <span className="text-codefire-orange text-sm font-medium">Drop files to insert paths</span>
        </div>
      )}
    </div>
  )
}

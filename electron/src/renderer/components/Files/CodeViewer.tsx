import { useEffect, useRef, useState, useCallback } from 'react'
import { Loader2, FileCode, AlertTriangle, Pencil, Eye, Save, GitBranch } from 'lucide-react'
import { api } from '@renderer/lib/api'
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

interface CodeViewerProps {
  filePath: string | null
  projectPath?: string
}

function getExtension(filePath: string): string {
  const parts = filePath.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

function getLanguageExtension(filePath: string) {
  const ext = getExtension(filePath)
  switch (ext) {
    case 'js':
    case 'jsx':
      return javascript({ jsx: true })
    case 'ts':
    case 'tsx':
      return javascript({ jsx: true, typescript: true })
    case 'py':
      return python()
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
      return html()
    case 'css':
    case 'scss':
    case 'less':
      return css()
    case 'json':
      return json()
    case 'md':
    case 'mdx':
    case 'markdown':
      return markdown()
    default:
      return null
  }
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath
}

const LANG_LABELS: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java',
  c: 'C', cpp: 'C++', h: 'C Header', cs: 'C#', php: 'PHP',
  swift: 'Swift', kt: 'Kotlin', scala: 'Scala', sh: 'Shell',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', less: 'LESS',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML',
  md: 'Markdown', mdx: 'MDX', txt: 'Text', svg: 'SVG',
  vue: 'Vue', svelte: 'Svelte', sql: 'SQL', graphql: 'GraphQL',
}

function getLanguageLabel(filePath: string): string | null {
  const ext = getExtension(filePath)
  return LANG_LABELS[ext] ?? null
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function CodeViewer({ filePath, projectPath }: CodeViewerProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [diffMode, setDiffMode] = useState(false)
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffStaged, setDiffStaged] = useState(false)
  const originalContentRef = useRef<string>('')

  const saveFile = useCallback(async () => {
    if (!filePath || !viewRef.current) return
    setSaving(true)
    try {
      const content = viewRef.current.state.doc.toString()
      await api.files.write(filePath, content)
      originalContentRef.current = content
      setUnsaved(false)
    } catch (err) {
      console.error('Failed to save file:', err)
    } finally {
      setSaving(false)
    }
  }, [filePath])

  const fetchDiff = useCallback(async () => {
    if (!filePath || !projectPath) return
    try {
      const diff = await api.git.diff(projectPath, { file: filePath, staged: diffStaged })
      setDiffContent(diff || null)
    } catch {
      setDiffContent(null)
    }
  }, [filePath, projectPath, diffStaged])

  useEffect(() => {
    if (diffMode && projectPath) fetchDiff()
  }, [diffMode, fetchDiff, projectPath])

  useEffect(() => {
    if (!filePath || !editorRef.current) return

    let cancelled = false
    setLoading(true)
    setError(null)
    setUnsaved(false)

    api.files
      .read(filePath)
      .then((content: string) => {
        if (!cancelled) {
          setFileSize(new Blob([content]).size)
          originalContentRef.current = content
        }
        if (cancelled || !editorRef.current) return

        // Destroy previous editor
        if (viewRef.current) {
          viewRef.current.destroy()
          viewRef.current = null
        }

        const extensions = [
          lineNumbers(),
          highlightActiveLine(),
          EditorState.readOnly.of(!editMode),
          EditorView.editable.of(editMode),
          oneDark,
          EditorView.theme({
            '&': { height: '100%', backgroundColor: 'transparent' },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid #333' },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setUnsaved(update.state.doc.toString() !== originalContentRef.current)
            }
          }),
        ]

        const langExt = getLanguageExtension(filePath)
        if (langExt) {
          extensions.push(langExt)
        }

        const state = EditorState.create({
          doc: content,
          extensions,
        })

        viewRef.current = new EditorView({
          state,
          parent: editorRef.current,
        })

        setLoading(false)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to read file')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [filePath, editMode])

  // Ctrl+S to save
  useEffect(() => {
    if (!editMode) return
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveFile()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editMode, saveFile])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [])

  if (!filePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-600">
        <FileCode size={32} className="mb-2" />
        <p className="text-sm">Select a file to view</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* File path header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
        <FileCode size={14} className="text-neutral-500" />
        <span className="text-xs text-neutral-400 truncate" title={filePath}>
          {getFileName(filePath)}
        </span>
        {unsaved && (
          <span className="w-2 h-2 rounded-full bg-codefire-orange shrink-0" title="Unsaved changes" />
        )}
        {/* Language badge */}
        {getLanguageLabel(filePath) && (
          <span className="px-1.5 py-px rounded text-[10px] font-medium bg-blue-400/15 text-blue-400 shrink-0">
            {getLanguageLabel(filePath)}
          </span>
        )}
        {/* File size */}
        {fileSize !== null && (
          <span className={`text-[10px] font-mono shrink-0 ${fileSize > 1024 * 1024 ? 'text-amber-400' : 'text-neutral-600'}`}>
            {formatFileSize(fileSize)}
          </span>
        )}
        {/* Large file warning */}
        {fileSize !== null && fileSize > 1024 * 1024 && (
          <span className="flex items-center gap-0.5 text-[10px] text-amber-400 shrink-0" title="Large file - may affect performance">
            <AlertTriangle size={10} />
          </span>
        )}

        <div className="flex-1" />

        {/* Diff + Edit/View toggle + Save button */}
        <div className="flex items-center gap-1 shrink-0">
          {projectPath && (
            <>
              <button
                onClick={() => { setDiffMode(!diffMode); if (diffMode) setDiffContent(null) }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  diffMode
                    ? 'bg-green-500/15 text-green-400'
                    : 'bg-neutral-800 text-neutral-400 hover:text-neutral-300'
                }`}
                title="Toggle git diff view"
              >
                <GitBranch size={10} /> Diff
              </button>
              {diffMode && (
                <button
                  onClick={() => setDiffStaged(!diffStaged)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    diffStaged
                      ? 'bg-yellow-500/15 text-yellow-400'
                      : 'bg-neutral-800 text-neutral-400 hover:text-neutral-300'
                  }`}
                  title={diffStaged ? 'Showing staged changes' : 'Showing unstaged changes'}
                >
                  {diffStaged ? 'Staged' : 'Unstaged'}
                </button>
              )}
            </>
          )}
          {editMode && unsaved && (
            <button
              onClick={saveFile}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium
                         bg-codefire-orange/15 text-codefire-orange hover:bg-codefire-orange/25 transition-colors
                         disabled:opacity-50"
              title="Save (Ctrl+S)"
            >
              <Save size={10} />
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          <button
            onClick={() => { setEditMode(!editMode); if (!editMode) { setDiffMode(false); setDiffContent(null) } }}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              editMode
                ? 'bg-codefire-orange/15 text-codefire-orange'
                : 'bg-neutral-800 text-neutral-400 hover:text-neutral-300'
            }`}
            title={editMode ? 'Switch to view mode' : 'Switch to edit mode'}
          >
            {editMode ? <><Eye size={10} /> View</> : <><Pencil size={10} /> Edit</>}
          </button>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/80 z-10">
            <Loader2 size={16} className="animate-spin text-neutral-500" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/80 z-10">
            <p className="text-sm text-error">{error}</p>
          </div>
        )}

        {diffMode && diffContent !== null ? (
          <div className="h-full overflow-auto p-4 font-mono text-xs leading-5">
            {diffContent ? diffContent.split('\n').map((line, i) => {
              let cls = 'text-neutral-400'
              let bg = ''
              if (line.startsWith('+') && !line.startsWith('+++')) { cls = 'text-green-400'; bg = 'bg-green-500/10' }
              else if (line.startsWith('-') && !line.startsWith('---')) { cls = 'text-red-400'; bg = 'bg-red-500/10' }
              else if (line.startsWith('@@')) { cls = 'text-blue-400'; bg = 'bg-blue-500/5' }
              else if (line.startsWith('diff') || line.startsWith('index')) { cls = 'text-neutral-500' }
              return (
                <div key={i} className={`px-2 ${bg}`}>
                  <span className={cls}>{line}</span>
                </div>
              )
            }) : (
              <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
                No changes detected
              </div>
            )}
          </div>
        ) : (
          <div ref={editorRef} className="h-full" />
        )}
      </div>
    </div>
  )
}

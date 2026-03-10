import { useEffect, useRef, useState, useCallback } from 'react'
import { ScrollText, RotateCcw, Save, Sparkles, Loader2 } from 'lucide-react'
import { api } from '@renderer/lib/api'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'

interface RuleEditorProps {
  scope: string | null
  label: string
  color: 'blue' | 'purple' | 'orange'
  filePath: string
  exists: boolean
  content: string
  projectPath: string
  onSave: (filePath: string, content: string) => Promise<void>
  onCreate: (filePath: string) => Promise<void>
}

const badgeColors = {
  blue: 'bg-blue-400/20 text-blue-400',
  purple: 'bg-purple-400/20 text-purple-400',
  orange: 'bg-codefire-orange/20 text-codefire-orange',
} as const

const buttonColors = {
  blue: 'bg-blue-500 hover:bg-blue-600',
  purple: 'bg-purple-500 hover:bg-purple-600',
  orange: 'bg-codefire-orange hover:bg-codefire-orange-hover',
} as const

const scopeDescriptions: Record<string, string> = {
  global: '~/.claude/CLAUDE.md — Applied to all projects',
  project: 'CLAUDE.md — Committed to repo, shared with team',
  local: '.claude/CLAUDE.md — Local only, gitignored',
}

const scopeExplanations: Record<string, string> = {
  global:
    'Global rules apply to every project. Use this for personal preferences like coding style, communication style, or tools you always want Claude to use.',
  project:
    'Project rules are committed to your repository and shared with your team. Use this for project-specific conventions, architecture decisions, and coding standards.',
  local:
    'Local rules are gitignored and only apply to you. Use this for personal overrides, local environment details, or experimental instructions you don\'t want to share.',
}

export default function RuleEditor({
  scope,
  label,
  color,
  filePath,
  exists,
  content,
  projectPath,
  onSave,
  onCreate,
}: RuleEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [unsaved, setUnsaved] = useState(false)
  const [generating, setGenerating] = useState(false)
  const savedContentRef = useRef(content)

  // Track the original content for revert
  useEffect(() => {
    savedContentRef.current = content
    setUnsaved(false)
  }, [content])

  // Build/rebuild editor when scope or content changes
  useEffect(() => {
    if (!scope || !exists || !editorRef.current) return

    // Destroy previous editor
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.editable.of(true),
      markdown(),
      oneDark,
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'transparent' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          borderRight: '1px solid #333',
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const currentContent = update.state.doc.toString()
          setUnsaved(currentContent !== savedContentRef.current)
        }
      }),
    ]

    const state = EditorState.create({
      doc: content,
      extensions,
    })

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    })

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [scope, exists, content])

  const handleSave = useCallback(async () => {
    if (!viewRef.current) return
    const currentContent = viewRef.current.state.doc.toString()
    await onSave(filePath, currentContent)
    savedContentRef.current = currentContent
    setUnsaved(false)
  }, [filePath, onSave])

  const handleRevert = useCallback(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      changes: {
        from: 0,
        to: viewRef.current.state.doc.length,
        insert: savedContentRef.current,
      },
    })
    setUnsaved(false)
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!scope || !projectPath) return
    setGenerating(true)
    try {
      const generated = await api.rules.generate(projectPath, scope)
      if (viewRef.current) {
        viewRef.current.dispatch({
          changes: {
            from: 0,
            to: viewRef.current.state.doc.length,
            insert: generated,
          },
        })
      }
    } catch (err) {
      console.error('Failed to generate rules:', err)
    } finally {
      setGenerating(false)
    }
  }, [scope, projectPath])

  // ── Nothing selected ──────────────────────────────────────────────────────
  if (!scope) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-600">
        <ScrollText size={32} className="mb-2" />
        <p className="text-sm">Select a rule file to edit</p>
      </div>
    )
  }

  // ── File doesn't exist ────────────────────────────────────────────────────
  if (!exists) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500">
        <ScrollText size={32} className={`mb-3 ${badgeColors[color].split(' ')[1]}`} />
        <p className="text-sm font-medium text-neutral-300 mb-1">
          {scope ? scope.charAt(0).toUpperCase() + scope.slice(1) : ''} CLAUDE.md
        </p>
        <p className="text-xs text-neutral-500 mb-2">
          {scope ? scopeDescriptions[scope] : ''}
        </p>
        <p className="text-xs text-neutral-600 mb-5 max-w-sm text-center leading-relaxed">
          {scope ? scopeExplanations[scope] : ''}
        </p>
        <div className="flex gap-2">
          <button
            className={`px-4 py-2 rounded-cf text-sm text-white font-medium transition-colors ${buttonColors[color]}`}
            onClick={() => onCreate(filePath)}
          >
            Create with Template
          </button>
          <button
            className="px-4 py-2 rounded-cf text-sm text-white font-medium transition-colors bg-purple-500 hover:bg-purple-600 disabled:opacity-30"
            onClick={async () => {
              setGenerating(true)
              try {
                const generated = await api.rules.generate(projectPath, scope || 'project')
                await onCreate(filePath)
                // Small delay to let editor mount, then set content
                setTimeout(() => {
                  if (viewRef.current) {
                    viewRef.current.dispatch({
                      changes: { from: 0, to: viewRef.current.state.doc.length, insert: generated },
                    })
                  }
                }, 100)
              } catch (err) {
                console.error('Failed to generate rules:', err)
              } finally {
                setGenerating(false)
              }
            }}
            disabled={generating}
          >
            <span className="flex items-center gap-1">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {generating ? 'Generating...' : 'Generate with AI'}
            </span>
          </button>
        </div>
      </div>
    )
  }

  // ── File exists — show editor ─────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
        {/* Scope badge */}
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badgeColors[color]}`}>
          {scope.charAt(0).toUpperCase() + scope.slice(1)}
        </span>

        <span className="text-xs text-neutral-400">CLAUDE.md</span>

        {/* Unsaved indicator */}
        {unsaved && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-codefire-orange/15 text-codefire-orange">
            Unsaved
          </span>
        )}

        <div className="flex-1" />

        {/* Generate with AI button */}
        <button
          className="px-3 py-1 rounded-cf text-xs font-medium bg-purple-500/20 text-purple-400
                     hover:bg-purple-500/30 transition-colors disabled:opacity-30"
          onClick={handleGenerate}
          disabled={generating}
          title="Generate rules with AI"
        >
          <span className="flex items-center gap-1">
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {generating ? 'Generating...' : 'Generate with AI'}
          </span>
        </button>

        {/* Revert button */}
        <button
          className="p-1.5 rounded-cf text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-30"
          onClick={handleRevert}
          disabled={!unsaved}
          title="Revert changes"
        >
          <RotateCcw size={14} />
        </button>

        {/* Save button */}
        <button
          className="px-3 py-1 rounded-cf text-xs font-medium bg-codefire-orange/20 text-codefire-orange
                     hover:bg-codefire-orange/30 transition-colors disabled:opacity-30"
          onClick={handleSave}
          disabled={!unsaved}
          title="Save changes"
        >
          <span className="flex items-center gap-1">
            <Save size={12} />
            Save
          </span>
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <div ref={editorRef} className="h-full" />
      </div>
    </div>
  )
}

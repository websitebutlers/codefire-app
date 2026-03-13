import { useState, useEffect, useRef, useCallback } from 'react'
import { Brain, RotateCcw, Save } from 'lucide-react'
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'

const darkTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid #333' },
})

interface MemoryEditorProps {
  fileName: string | null
  filePath: string | null
  isMain: boolean
  content: string | null
  onSave: (filePath: string, content: string) => Promise<void>
}

export default function MemoryEditor({
  fileName,
  filePath,
  isMain,
  content,
  onSave,
}: MemoryEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [currentContent, setCurrentContent] = useState<string>('')
  const [savedContent, setSavedContent] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const isUnsaved = currentContent !== savedContent

  // Initialize / reinitialize editor when file changes
  useEffect(() => {
    if (!editorRef.current || content === null || !filePath) return

    // Destroy previous editor
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    setSavedContent(content)
    setCurrentContent(content)

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        markdown(),
        oneDark,
        darkTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setCurrentContent(update.state.doc.toString())
          }
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [filePath, content])

  const handleSave = useCallback(async () => {
    if (!filePath || !isUnsaved) return
    setSaving(true)
    try {
      await onSave(filePath, currentContent)
      setSavedContent(currentContent)
    } finally {
      setSaving(false)
    }
  }, [filePath, currentContent, isUnsaved, onSave])

  const handleRevert = useCallback(() => {
    if (!viewRef.current || !isUnsaved) return
    const view = viewRef.current
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: savedContent,
      },
    })
    setCurrentContent(savedContent)
  }, [savedContent, isUnsaved])

  // Empty state
  if (!filePath || content === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <Brain size={32} className="text-neutral-600 mb-3" />
        <p className="text-sm text-neutral-500">Select a memory file to edit</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
        <span className="px-2 py-0.5 bg-neutral-800 rounded-cf text-xs font-mono text-neutral-300">
          {fileName}
        </span>
        <span className="text-xs text-neutral-500">
          {isMain ? 'loaded every session' : 'loaded when referenced'}
        </span>
        {isUnsaved && (
          <span className="px-2 py-0.5 bg-codefire-orange/20 text-codefire-orange rounded-full text-xs">
            unsaved
          </span>
        )}

        <div className="flex-1" />

        <button
          className="px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 rounded-cf
                     hover:bg-neutral-800 transition-colors disabled:opacity-40"
          onClick={handleRevert}
          disabled={!isUnsaved}
          title="Revert changes"
        >
          <RotateCcw size={14} />
        </button>
        <button
          className="px-3 py-1 text-xs bg-codefire-orange/20 text-codefire-orange rounded-cf
                     hover:bg-codefire-orange/30 transition-colors disabled:opacity-40"
          onClick={handleSave}
          disabled={!isUnsaved || saving}
          title="Save changes"
        >
          <Save size={14} className="inline mr-1" />
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden" ref={editorRef} />
    </div>
  )
}

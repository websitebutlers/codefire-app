import { useState } from 'react'
import { X, Bug, Send, Loader2 } from 'lucide-react'
import { api } from '@renderer/lib/api'
import ScreenshotAnnotation from './ScreenshotAnnotation'

interface ConsoleEntry {
  level: string
  message: string
  timestamp: number
}

interface CaptureIssueSheetProps {
  projectId: string
  screenshotDataUrl: string | null
  pageUrl: string
  pageTitle: string
  consoleEntries: ConsoleEntry[]
  onClose: () => void
}

type Phase = 'annotate' | 'form'

export default function CaptureIssueSheet({
  projectId,
  screenshotDataUrl,
  pageUrl,
  pageTitle,
  consoleEntries,
  onClose,
}: CaptureIssueSheetProps) {
  const [phase, setPhase] = useState<Phase>(screenshotDataUrl ? 'annotate' : 'form')
  const [annotatedImage, setAnnotatedImage] = useState<string | null>(null)
  const [title, setTitle] = useState(`Bug: ${pageTitle}`)
  const [description, setDescription] = useState('')
  const [includeConsole, setIncludeConsole] = useState(true)
  const [includeScreenshot, setIncludeScreenshot] = useState(true)
  const [saving, setSaving] = useState(false)

  const errorEntries = consoleEntries.filter((e) => e.level === 'error' || e.level === 'warning')

  const finalImage = annotatedImage ?? screenshotDataUrl

  function handleAnnotationDone(dataUrl: string) {
    setAnnotatedImage(dataUrl)
    setPhase('form')
  }

  function handleAnnotationSkip() {
    setAnnotatedImage(null)
    setPhase('form')
  }

  async function handleSubmit() {
    setSaving(true)
    try {
      let desc = description
      desc += `\n\n**URL:** ${pageUrl}`
      if (includeConsole && errorEntries.length > 0) {
        desc += '\n\n**Console Errors:**\n```\n'
        desc += errorEntries
          .slice(-20)
          .map((e) => `[${e.level}] ${e.message}`)
          .join('\n')
        desc += '\n```'
      }

      // Save screenshot to disk if included
      let screenshotPath: string | null = null
      if (includeScreenshot && finalImage) {
        try {
          screenshotPath = (await window.api.invoke(
            'browser:saveScreenshot' as any,
            projectId,
            finalImage,
            pageUrl,
            pageTitle
          )) as string
          if (screenshotPath) {
            desc += `\n\n**Screenshot:** ${screenshotPath}`
          }
        } catch {
          // Non-fatal — still create the task without screenshot
        }
      }

      await api.tasks.create({
        projectId,
        title: title.trim(),
        description: desc.trim(),
        priority: 3,
        labels: ['bug', 'browser'],
      })
      onClose()
    } catch (err) {
      console.error('Failed to create issue:', err)
    } finally {
      setSaving(false)
    }
  }

  // Phase 1: Annotation
  if (phase === 'annotate' && screenshotDataUrl) {
    return (
      <ScreenshotAnnotation
        imageDataUrl={screenshotDataUrl}
        onDone={handleAnnotationDone}
        onCancel={handleAnnotationSkip}
      />
    )
  }

  // Phase 2: Issue Form
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-[520px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Bug size={16} className="text-red-400" />
            <span className="text-sm font-medium text-neutral-200">Capture Issue</span>
          </div>
          <button onClick={onClose} className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Screenshot preview */}
          {finalImage && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-neutral-500 uppercase tracking-wider">
                  Screenshot {annotatedImage ? '(annotated)' : ''}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeScreenshot}
                    onChange={(e) => setIncludeScreenshot(e.target.checked)}
                    className="rounded border-neutral-600"
                  />
                  Include
                </label>
              </div>
              {includeScreenshot && (
                <img
                  src={finalImage}
                  alt="Page screenshot"
                  className="w-full rounded border border-neutral-700 max-h-40 object-cover object-top"
                />
              )}
            </div>
          )}

          {/* URL */}
          <div className="space-y-1">
            <label className="text-[11px] text-neutral-500 uppercase tracking-wider">URL</label>
            <div className="text-xs text-neutral-400 font-mono bg-neutral-800 rounded px-2 py-1.5 truncate">
              {pageUrl}
            </div>
          </div>

          {/* Title */}
          <div className="space-y-1">
            <label className="text-[11px] text-neutral-500 uppercase tracking-wider">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-codefire-orange/50"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-[11px] text-neutral-500 uppercase tracking-wider">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-codefire-orange/50 resize-none"
              placeholder="Describe the issue..."
            />
          </div>

          {/* Console logs */}
          {errorEntries.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-neutral-500 uppercase tracking-wider">
                  Console Errors ({errorEntries.length})
                </label>
                <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeConsole}
                    onChange={(e) => setIncludeConsole(e.target.checked)}
                    className="rounded border-neutral-600"
                  />
                  Include
                </label>
              </div>
              <div className="bg-neutral-800 rounded border border-neutral-700 max-h-28 overflow-y-auto p-2 font-mono text-[10px]">
                {errorEntries.slice(-20).map((entry, i) => (
                  <div
                    key={i}
                    className={entry.level === 'error' ? 'text-red-400' : 'text-yellow-400'}
                  >
                    [{entry.level}] {entry.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-neutral-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors disabled:opacity-40"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Create Issue
          </button>
        </div>
      </div>
    </div>
  )
}

import {
  Image, Copy, FolderOpen, Maximize2, Clipboard, Check, RefreshCw, Loader2, Download,
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import type { GeneratedImage } from '@shared/models'
import { api } from '@renderer/lib/api'

interface MediaViewerProps {
  image: GeneratedImage | null
  onVariation?: (newImage: GeneratedImage) => void
}

export default function MediaViewer({ image, onVariation }: MediaViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editPrompt, setEditPrompt] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [imageSrc, setImageSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!image?.filePath) {
      setImageSrc(null)
      return
    }
    api.images.readFile(image.filePath).then((dataUrl) => {
      setImageSrc(dataUrl)
    })
  }, [image?.filePath])

  const handleDownload = useCallback(() => {
    if (!imageSrc || !image) return
    const a = document.createElement('a')
    a.href = imageSrc
    const timestamp = new Date(image.createdAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.download = `codefire-${timestamp}.png`
    a.click()
  }, [imageSrc, image])

  async function handleCopyToClipboard() {
    if (!image || !imageSrc) return
    try {
      const response = await fetch(imageSrc)
      const blob = await response.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      await navigator.clipboard.writeText(image.filePath)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function handleRevealInExplorer() {
    if (!image) return
    api.shell.showInExplorer(image.filePath)
  }

  async function handleGenerateVariation() {
    if (!image || generating) return
    const prompt = editPrompt.trim() || image.prompt
    let apiKey: string | undefined
    try {
      const config = await api.settings.get()
      apiKey = config?.openRouterKey
    } catch {}
    if (!apiKey) {
      setEditError('OpenRouter API key not configured. Set it in Settings > Engine.')
      return
    }

    setGenerating(true)
    setEditError(null)
    try {
      const result = await api.images.edit({
        imageId: image.id,
        prompt,
        apiKey,
        model: image.model,
        aspectRatio: image.aspectRatio ?? '1:1',
        imageSize: image.imageSize ?? '1K',
      })
      if (result.error) {
        setEditError(result.error)
      } else if (result.image) {
        onVariation?.(result.image)
        setEditMode(false)
        setEditPrompt('')
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Edit failed')
    } finally {
      setGenerating(false)
    }
  }

  if (!image) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
        <Image size={32} />
        <p className="text-sm">Select an image to view</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800">
          <span className="text-[10px] font-mono text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded">
            {image.aspectRatio ?? '1:1'}
          </span>
          <span className="text-[10px] font-mono text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded">
            {image.model.split('/').pop()}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => { setEditMode(!editMode); setEditPrompt(image.prompt); setEditError(null) }}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              editMode
                ? 'bg-purple-500/15 text-purple-400'
                : 'bg-neutral-800 text-neutral-400 hover:text-neutral-300'
            }`}
            title="Edit image with AI"
          >
            <RefreshCw size={10} /> Edit
          </button>
          <button
            type="button"
            onClick={handleCopyToClipboard}
            className="flex items-center gap-1 text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Copy image to clipboard"
          >
            {copied ? <Check size={14} className="text-green-400" /> : <Clipboard size={14} />}
          </button>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(image.filePath)}
            className="text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Copy file path"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Save image as..."
          >
            <Download size={14} />
          </button>
          <button
            type="button"
            onClick={handleRevealInExplorer}
            className="text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Reveal in explorer"
          >
            <FolderOpen size={14} />
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen(true)}
            className="text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Fullscreen"
          >
            <Maximize2 size={14} />
          </button>
        </div>

        {/* Edit/variation bar */}
        {editMode && (
          <div className="px-3 py-2 border-b border-neutral-800 bg-neutral-900/50 space-y-2">
            <textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="Describe how to modify this image..."
              rows={3}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 resize-none"
            />
            {editError && (
              <p className="text-[10px] text-red-400">{editError}</p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleGenerateVariation}
                disabled={generating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 rounded text-xs transition-colors disabled:opacity-50"
              >
                {generating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {generating ? 'Editing...' : 'Apply Edit'}
              </button>
              <button
                type="button"
                onClick={() => { setEditMode(false); setEditError(null) }}
                className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Image display */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-neutral-950/50">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={image.prompt}
              className="max-w-full max-h-full object-contain rounded-lg"
              onContextMenu={(e) => { e.preventDefault(); handleDownload() }}
            />
          ) : (
            <div className="w-8 h-8 border-2 border-neutral-700 border-t-codefire-orange rounded-full animate-spin" />
          )}
        </div>

        {/* Prompt display */}
        <div className="px-3 py-2 border-t border-neutral-800">
          <p className="text-[10px] text-neutral-600 uppercase tracking-wider mb-1">Prompt</p>
          <p className="text-xs text-neutral-300">{image.prompt}</p>
          {image.responseText && (
            <>
              <p className="text-[10px] text-neutral-600 uppercase tracking-wider mt-2 mb-1">Response</p>
              <p className="text-xs text-neutral-400">{image.responseText}</p>
            </>
          )}
        </div>
      </div>

      {/* Fullscreen overlay */}
      {isFullscreen && imageSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-pointer"
          onClick={() => setIsFullscreen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setIsFullscreen(false)}
          role="button"
          tabIndex={0}
        >
          <img
            src={imageSrc}
            alt={image.prompt}
            className="max-w-[90vw] max-h-[90vh] object-contain"
          />
        </div>
      )}
    </>
  )
}

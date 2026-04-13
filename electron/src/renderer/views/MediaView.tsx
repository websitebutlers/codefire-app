import { useState, useEffect, useCallback, useRef } from 'react'
import { Send, Loader2, ChevronDown, Upload, X, RotateCcw, ImagePlus, Hash } from 'lucide-react'
import { api } from '@renderer/lib/api'
import type { GeneratedImage } from '@shared/models'
import {
  IMAGE_MODELS, DEFAULT_MODEL,
  getModelById, modelSupports,
  type ModelCapabilities,
} from '@shared/media-models'
import ImageHistoryList from '@renderer/components/Images/ImageHistoryList'
import MediaViewer from '@renderer/components/Images/MediaViewer'

interface MediaViewProps {
  projectId: string
}

export default function MediaView({ projectId }: MediaViewProps) {
  const [items, setItems] = useState<GeneratedImage[]>([])
  const [selected, setSelected] = useState<GeneratedImage | null>(null)
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Model selection
  const [modelId, setModelId] = useState(DEFAULT_MODEL.id)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const modelPickerRef = useRef<HTMLDivElement>(null)

  const model = getModelById(modelId) ?? DEFAULT_MODEL

  // Generation options
  const [aspectRatio, setAspectRatio] = useState(model.defaultAspectRatio)
  const [imageSize, setImageSize] = useState(model.defaultResolution)

  // Advanced options
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [seed, setSeed] = useState<string>('')

  // Reference images
  const [referenceImages, setReferenceImages] = useState<string[]>([])

  const fetchItems = useCallback(async () => {
    const imgs = await api.images.list(projectId)
    setItems(imgs)
    if (imgs.length > 0 && !selected) setSelected(imgs[0])
  }, [projectId, selected])

  useEffect(() => { fetchItems() }, [fetchItems])

  // Close model picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false)
      }
    }
    if (showModelPicker) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showModelPicker])

  // Reset defaults when model changes
  useEffect(() => {
    const m = getModelById(modelId) ?? DEFAULT_MODEL
    setAspectRatio(m.defaultAspectRatio)
    setImageSize(m.defaultResolution)
    setReferenceImages([])
    setSeed('')
  }, [modelId])

  async function getApiKey(): Promise<string | undefined> {
    try {
      const config = await api.settings.get()
      return config?.openRouterKey
    } catch { return undefined }
  }

  async function handleGenerate() {
    const trimmed = prompt.trim()
    if (!trimmed || generating) return

    const apiKey = await getApiKey()
    if (!apiKey) {
      setError('OpenRouter API key not configured. Set it in Settings > Engine.')
      return
    }

    setGenerating(true)
    setError(null)

    try {
      const result = await api.images.generate({
        projectId,
        prompt: trimmed,
        apiKey,
        model: modelId,
        aspectRatio,
        imageSize,
        seed: seed ? parseInt(seed, 10) : undefined,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      })

      if (result.error) {
        setError(result.error)
      } else if (result.image) {
        setItems((prev) => [result.image!, ...prev])
        setSelected(result.image)
        setPrompt('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function handleDelete(id: number) {
    api.images.delete(id).then((ok) => {
      if (ok) {
        setItems((prev) => prev.filter((i) => i.id !== id))
        if (selected?.id === id) {
          setSelected(items.find((i) => i.id !== id) ?? null)
        }
      }
    })
  }

  async function handleClearCache() {
    await api.images.resetConversation()
  }

  async function handleAddReferenceImages() {
    try {
      const paths = await api.dialog.selectFiles()
      if (paths?.length) {
        const maxRefs = model.capabilities.maxReferenceImages ?? 8
        setReferenceImages((prev) => [...prev, ...paths].slice(0, maxRefs))
      }
    } catch {}
  }

  function cap(key: keyof ModelCapabilities): boolean {
    return modelSupports(model, key)
  }

  const hasReferenceInput = cap('imageToImage') || cap('styleTransfer') || cap('characterReference')
  const hasAdvanced = cap('seed')

  return (
    <div className="flex flex-col h-full">
      {/* Generation bar */}
      <div className="px-3 py-2 border-b border-neutral-800 bg-neutral-900 shrink-0 space-y-1.5">
        {/* Row 1: Model selector + Prompt + Generate */}
        <div className="flex items-center gap-2">
          {/* Model picker */}
          <div className="relative" ref={modelPickerRef}>
            <button
              type="button"
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-1 px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-[10px] font-medium text-neutral-300 hover:border-neutral-600 transition-colors min-w-[140px]"
            >
              <ImagePlus size={10} className="text-codefire-orange shrink-0" />
              <span className="truncate">{model.name}</span>
              <ChevronDown size={10} className="shrink-0 text-neutral-500" />
            </button>

            {showModelPicker && (
              <div className="absolute top-full left-0 mt-1 z-50 w-72 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl overflow-hidden">
                <div className="px-2 py-1.5 bg-neutral-800 border-b border-neutral-700 sticky top-0 z-10">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-codefire-orange">Image Generators</span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {IMAGE_MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setModelId(m.id); setShowModelPicker(false) }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-neutral-700/60 transition-colors ${
                        modelId === m.id ? 'bg-neutral-800 border-l-2 border-codefire-orange' : 'bg-neutral-900'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-neutral-200">{m.name}</span>
                        <span className="text-[9px] text-neutral-500">{m.provider}</span>
                      </div>
                      <p className="text-[9px] text-neutral-500 mt-0.5">{m.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            placeholder="Describe an image to generate..."
            disabled={generating}
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-codefire-orange/50 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!prompt.trim() || generating}
            className="p-1.5 rounded bg-codefire-orange/20 text-codefire-orange hover:bg-codefire-orange/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>

        {/* Row 2: Options */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Aspect ratio */}
          {model.aspectRatios.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-neutral-600">Ratio:</span>
              {model.aspectRatios.slice(0, 6).map((r) => (
                <button
                  key={r.value}
                  onClick={() => setAspectRatio(r.value)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    aspectRatio === r.value
                      ? 'bg-codefire-orange/20 text-codefire-orange border border-codefire-orange/30'
                      : 'bg-neutral-800 text-neutral-500 border border-neutral-700 hover:text-neutral-300'
                  }`}
                >
                  {r.label}
                </button>
              ))}
              {model.aspectRatios.length > 6 && (
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5 text-[10px] text-neutral-400"
                >
                  {model.aspectRatios.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Image size */}
          {model.resolutions.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-neutral-600">Size:</span>
              {model.resolutions.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setImageSize(s.value)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    imageSize === s.value
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-neutral-800 text-neutral-500 border border-neutral-700 hover:text-neutral-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Reference images */}
          {hasReferenceInput && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleAddReferenceImages}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700 hover:text-neutral-300 hover:border-neutral-600 transition-colors"
              >
                <Upload size={10} />
                Ref Images ({referenceImages.length}/{model.capabilities.maxReferenceImages ?? 8})
              </button>
              {referenceImages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setReferenceImages([])}
                  className="p-0.5 rounded text-neutral-600 hover:text-red-400 transition-colors"
                  title="Clear reference images"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )}

          {/* Advanced toggle */}
          {hasAdvanced && (
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                showAdvanced
                  ? 'bg-neutral-700 text-neutral-300'
                  : 'bg-neutral-800 text-neutral-500 border border-neutral-700 hover:text-neutral-300'
              }`}
            >
              Advanced
            </button>
          )}

          {/* Clear cache */}
          <button
            type="button"
            onClick={handleClearCache}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-500 border border-neutral-700 hover:text-neutral-300 hover:border-neutral-600 transition-colors ml-auto"
            title="Clear conversation cache for fresh generation"
          >
            <RotateCcw size={9} />
            Clear Cache
          </button>
        </div>

        {/* Row 3: Advanced options */}
        {showAdvanced && hasAdvanced && (
          <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-neutral-800/50">
            {cap('seed') && (
              <div className="flex items-center gap-1">
                <Hash size={10} className="text-neutral-600" />
                <span className="text-[10px] text-neutral-600">Seed:</span>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="Random"
                  className="w-20 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[10px] text-neutral-300 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
                />
              </div>
            )}
          </div>
        )}

        {/* Reference image thumbnails */}
        {referenceImages.length > 0 && (
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[10px] text-neutral-600 shrink-0">References:</span>
            {referenceImages.map((refPath, i) => (
              <div key={refPath} className="relative group">
                <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 overflow-hidden">
                  <RefThumbnail filePath={refPath} />
                </div>
                <button
                  type="button"
                  onClick={() => setReferenceImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={8} className="text-white" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-red-900/20 border-b border-red-800/30 text-xs text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-500 hover:text-red-300">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: History list */}
        <div className="w-64 border-r border-neutral-800 shrink-0">
          <ImageHistoryList
            images={items}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            onDelete={handleDelete}
          />
        </div>

        {/* Right: Image viewer */}
        <div className="flex-1">
          <MediaViewer
            image={selected}
            onVariation={(newImage) => {
              setItems((prev) => [newImage, ...prev])
              setSelected(newImage)
            }}
          />
        </div>
      </div>
    </div>
  )
}

function RefThumbnail({ filePath }: { filePath: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    api.images.readFile(filePath).then((dataUrl) => setSrc(dataUrl))
  }, [filePath])
  if (!src) return null
  return <img src={src} alt="" className="w-full h-full object-cover" />
}

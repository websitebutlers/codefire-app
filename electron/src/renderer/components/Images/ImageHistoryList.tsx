import { Image, Trash2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import type { GeneratedImage } from '@shared/models'
import { api } from '@renderer/lib/api'

interface ImageHistoryListProps {
  images: GeneratedImage[]
  selectedId: number | null
  onSelect: (image: GeneratedImage) => void
  onDelete: (id: number) => void
}

function Thumbnail({ filePath }: { filePath: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    api.images.readFile(filePath).then((dataUrl) => setSrc(dataUrl))
  }, [filePath])

  if (!src) return null

  return (
    <img
      src={src}
      alt=""
      className="w-full h-full object-cover"
    />
  )
}

export default function ImageHistoryList({
  images,
  selectedId,
  onSelect,
  onDelete,
}: ImageHistoryListProps) {
  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
        <Image size={24} />
        <p className="text-xs">No images yet</p>
        <p className="text-[10px] text-neutral-600">
          Generate images with AI tools
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-neutral-800">
        <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
          Image History
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {images.map((img) => (
          <button
            key={img.id}
            type="button"
            onClick={() => onSelect(img)}
            className={`w-full text-left px-3 py-2 border-b border-neutral-800/50 hover:bg-neutral-800/60 transition-colors group ${
              selectedId === img.id ? 'bg-neutral-800/80' : ''
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="w-10 h-10 rounded bg-neutral-800 overflow-hidden shrink-0 mt-0.5">
                <Thumbnail filePath={img.filePath} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-neutral-300 line-clamp-2">
                  {img.prompt}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-neutral-600">
                    {img.model.split('/').pop()}
                  </span>
                  <span className="text-[10px] text-neutral-600">
                    {new Date(img.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(img.id)
                }}
                className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition-all p-1"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

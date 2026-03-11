import { useState } from 'react'
import { Database } from 'lucide-react'

interface IndexIndicatorProps {
  status: 'idle' | 'indexing' | 'ready' | 'error'
  totalChunks?: number
  progress?: number // 0-100
  lastError?: string
  onRequestIndex?: () => void
}

export default function IndexIndicator({
  status,
  totalChunks,
  progress,
  lastError,
  onRequestIndex,
}: IndexIndicatorProps) {
  const [showError, setShowError] = useState(false)

  const handleClick = () => {
    if (status === 'idle' && onRequestIndex) {
      onRequestIndex()
    } else if (status === 'error') {
      setShowError((prev) => !prev)
    }
  }

  const tooltipText = buildTooltip(status, totalChunks, lastError, !!onRequestIndex)
  const isClickable = (status === 'idle' && !!onRequestIndex) || status === 'error'

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={!isClickable}
        className={`
          flex items-center gap-1.5
          ${isClickable ? 'cursor-pointer hover:text-neutral-400' : 'cursor-default'}
        `}
        title={tooltipText}
      >
        {/* Status indicator */}
        {status === 'indexing' ? (
          <span className="inline-block w-2 h-2 flex-shrink-0">
            <span className="inline-block w-2 h-2 rounded-full border border-codefire-orange border-t-transparent animate-spin" />
          </span>
        ) : (
          <span
            className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dotClass(status)}${status === 'idle' ? ' animate-pulse' : ''}`}
          />
        )}

        <Database className="w-3 h-3 text-neutral-500 flex-shrink-0" />

        {/* Label */}
        <span className={`text-tiny ${status === 'idle' && onRequestIndex ? 'text-codefire-orange underline' : status === 'error' ? 'text-error underline' : 'text-neutral-500'}`}>
          {labelText(status, totalChunks, progress)}
        </span>
      </button>

      {/* Error detail popover */}
      {showError && status === 'error' && (
        <div className="absolute bottom-full left-0 mb-1 px-2 py-1.5 rounded-cf bg-neutral-800 border border-neutral-700 max-w-64 z-50">
          <p className="text-tiny text-error break-words">{lastError || 'Unknown error'}</p>
        </div>
      )}
    </div>
  )
}

function dotClass(status: IndexIndicatorProps['status']): string {
  switch (status) {
    case 'idle':
      return 'bg-codefire-orange'
    case 'ready':
      return 'bg-success'
    case 'error':
      return 'bg-error'
    default:
      return 'bg-neutral-600'
  }
}

function labelText(
  status: IndexIndicatorProps['status'],
  totalChunks?: number,
  progress?: number
): string {
  switch (status) {
    case 'idle':
      return 'Not indexed'
    case 'indexing':
      return progress !== undefined ? `Indexing... ${progress}%` : 'Indexing...'
    case 'ready':
      return totalChunks !== undefined ? `${totalChunks} chunks` : 'Indexed'
    case 'error':
      return 'Index error'
  }
}

function buildTooltip(
  status: IndexIndicatorProps['status'],
  totalChunks?: number,
  lastError?: string,
  canIndex?: boolean
): string {
  switch (status) {
    case 'idle':
      return canIndex ? 'Click to index project' : 'Project has not been indexed yet'
    case 'indexing':
      return 'Indexing project files...'
    case 'ready':
      return totalChunks !== undefined
        ? `Index ready: ${totalChunks} chunks indexed`
        : 'Index ready'
    case 'error':
      return 'Index error — click for details'
  }
}

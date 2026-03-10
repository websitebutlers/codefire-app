import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Pen,
  Highlighter,
  MoveRight,
  Square,
  Circle,
  Type,
  Undo2,
  Eraser,
  Check,
} from 'lucide-react'

type Tool = 'pen' | 'highlight' | 'arrow' | 'rect' | 'ellipse' | 'text'

interface Annotation {
  tool: Tool
  color: string
  points?: Array<{ x: number; y: number }>
  start?: { x: number; y: number }
  end?: { x: number; y: number }
  text?: string
}

interface ScreenshotAnnotationProps {
  imageDataUrl: string
  onDone: (annotatedDataUrl: string) => void
  onCancel: () => void
}

const TOOLS: Array<{ id: Tool; icon: typeof Pen; label: string }> = [
  { id: 'pen', icon: Pen, label: 'Pen' },
  { id: 'highlight', icon: Highlighter, label: 'Highlight' },
  { id: 'arrow', icon: MoveRight, label: 'Arrow' },
  { id: 'rect', icon: Square, label: 'Rectangle' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse' },
  { id: 'text', icon: Type, label: 'Text' },
]

const COLORS = [
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#ffffff', label: 'White' },
  { value: '#000000', label: 'Black' },
]

export default function ScreenshotAnnotation({
  imageDataUrl,
  onDone,
  onCancel,
}: ScreenshotAnnotationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [activeTool, setActiveTool] = useState<Tool>('pen')
  const [activeColor, setActiveColor] = useState('#ef4444')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentAnnotation, setCurrentAnnotation] = useState<Annotation | null>(null)
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null)
  const [canvasScale, setCanvasScale] = useState({ sx: 1, sy: 1 })

  // Load image and set up canvas
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imageRef.current = img
      redrawCanvas()
    }
    img.src = imageDataUrl
  }, [imageDataUrl])

  // Recalculate scale when annotations change
  useEffect(() => {
    redrawCanvas()
  }, [annotations, currentAnnotation])

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      }
    },
    []
  )

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return

    // Fit canvas to image while respecting container
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Draw base image
    ctx.drawImage(img, 0, 0)

    // Draw all completed annotations
    for (const ann of annotations) {
      drawAnnotation(ctx, ann)
    }

    // Draw current in-progress annotation
    if (currentAnnotation) {
      drawAnnotation(ctx, currentAnnotation)
    }
  }, [annotations, currentAnnotation])

  function drawAnnotation(ctx: CanvasRenderingContext2D, ann: Annotation) {
    ctx.save()
    ctx.strokeStyle = ann.color
    ctx.fillStyle = ann.color

    switch (ann.tool) {
      case 'pen': {
        if (!ann.points || ann.points.length < 2) break
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(ann.points[0].x, ann.points[0].y)
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y)
        }
        ctx.stroke()
        break
      }
      case 'highlight': {
        if (!ann.points || ann.points.length < 2) break
        ctx.lineWidth = 20
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalAlpha = 0.35
        ctx.beginPath()
        ctx.moveTo(ann.points[0].x, ann.points[0].y)
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y)
        }
        ctx.stroke()
        break
      }
      case 'arrow': {
        if (!ann.start || !ann.end) break
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        // Draw line
        ctx.beginPath()
        ctx.moveTo(ann.start.x, ann.start.y)
        ctx.lineTo(ann.end.x, ann.end.y)
        ctx.stroke()
        // Draw filled arrowhead (matches Swift implementation)
        const angle = Math.atan2(ann.end.y - ann.start.y, ann.end.x - ann.start.x)
        const headLen = 16
        const arrowAngle = Math.PI / 6
        ctx.beginPath()
        ctx.moveTo(ann.end.x, ann.end.y)
        ctx.lineTo(
          ann.end.x - headLen * Math.cos(angle - arrowAngle),
          ann.end.y - headLen * Math.sin(angle - arrowAngle)
        )
        ctx.lineTo(
          ann.end.x - headLen * Math.cos(angle + arrowAngle),
          ann.end.y - headLen * Math.sin(angle + arrowAngle)
        )
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'rect': {
        if (!ann.start || !ann.end) break
        ctx.lineWidth = 3
        const rx = Math.min(ann.start.x, ann.end.x)
        const ry = Math.min(ann.start.y, ann.end.y)
        const rw = Math.abs(ann.end.x - ann.start.x)
        const rh = Math.abs(ann.end.y - ann.start.y)
        ctx.strokeRect(rx, ry, rw, rh)
        break
      }
      case 'ellipse': {
        if (!ann.start || !ann.end) break
        ctx.lineWidth = 3
        const cx = (ann.start.x + ann.end.x) / 2
        const cy = (ann.start.y + ann.end.y) / 2
        const radiusX = Math.abs(ann.end.x - ann.start.x) / 2
        const radiusY = Math.abs(ann.end.y - ann.start.y) / 2
        ctx.beginPath()
        ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2)
        ctx.stroke()
        break
      }
      case 'text': {
        if (!ann.start || !ann.text) break
        ctx.font = 'bold 24px sans-serif'
        ctx.fillText(ann.text, ann.start.x, ann.start.y)
        break
      }
    }
    ctx.restore()
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (activeTool === 'text') {
      const coords = getCanvasCoords(e)
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      setTextInput({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        value: '',
      })
      return
    }

    setIsDrawing(true)
    const coords = getCanvasCoords(e)

    if (activeTool === 'pen' || activeTool === 'highlight') {
      setCurrentAnnotation({
        tool: activeTool,
        color: activeColor,
        points: [coords],
      })
    } else {
      setCurrentAnnotation({
        tool: activeTool,
        color: activeColor,
        start: coords,
        end: coords,
      })
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawing || !currentAnnotation) return
    const coords = getCanvasCoords(e)

    if (currentAnnotation.tool === 'pen' || currentAnnotation.tool === 'highlight') {
      setCurrentAnnotation({
        ...currentAnnotation,
        points: [...(currentAnnotation.points || []), coords],
      })
    } else {
      setCurrentAnnotation({
        ...currentAnnotation,
        end: coords,
      })
    }
  }

  function handleMouseUp() {
    if (!isDrawing || !currentAnnotation) return
    setIsDrawing(false)
    setAnnotations((prev) => [...prev, currentAnnotation])
    setCurrentAnnotation(null)
  }

  function handleTextSubmit() {
    if (!textInput || !textInput.value.trim()) {
      setTextInput(null)
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (textInput.x / rect.width) * canvas.width
    const y = (textInput.y / rect.height) * canvas.height

    setAnnotations((prev) => [
      ...prev,
      { tool: 'text', color: activeColor, start: { x, y }, text: textInput.value },
    ])
    setTextInput(null)
  }

  function handleUndo() {
    setAnnotations((prev) => prev.slice(0, -1))
  }

  function handleClear() {
    setAnnotations([])
  }

  function handleDone() {
    const canvas = canvasRef.current
    if (!canvas) return onDone(imageDataUrl)
    onDone(canvas.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 bg-neutral-900 border-b border-neutral-800 shrink-0">
        {/* Tools */}
        <div className="flex items-center gap-0.5 mr-3">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              title={tool.label}
              className={`p-1.5 rounded transition-colors ${
                activeTool === tool.id
                  ? 'bg-codefire-orange/20 text-codefire-orange'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              <tool.icon size={16} />
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-neutral-700 mx-1" />

        {/* Colors */}
        <div className="flex items-center gap-1 mr-3">
          {COLORS.map((color) => (
            <button
              key={color.value}
              onClick={() => setActiveColor(color.value)}
              title={color.label}
              className={`w-5 h-5 rounded-full border-2 transition-transform ${
                activeColor === color.value ? 'border-white scale-110' : 'border-neutral-600'
              }`}
              style={{ backgroundColor: color.value }}
            />
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-neutral-700 mx-1" />

        {/* Actions */}
        <button
          onClick={handleUndo}
          disabled={annotations.length === 0}
          title="Undo"
          className="p-1.5 text-neutral-500 hover:text-neutral-300 disabled:opacity-30 transition-colors"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={handleClear}
          disabled={annotations.length === 0}
          title="Clear all"
          className="p-1.5 text-neutral-500 hover:text-neutral-300 disabled:opacity-30 transition-colors"
        >
          <Eraser size={16} />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Done / Cancel */}
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          Skip
        </button>
        <button
          onClick={handleDone}
          className="flex items-center gap-1 px-3 py-1 text-xs bg-codefire-orange/20 text-codefire-orange hover:bg-codefire-orange/30 rounded transition-colors"
        >
          <Check size={12} />
          Done
        </button>
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-4 relative">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="max-w-full max-h-full object-contain rounded border border-neutral-700 cursor-crosshair"
          style={{ imageRendering: 'auto' }}
        />

        {/* Inline text input */}
        {textInput && (
          <input
            type="text"
            autoFocus
            value={textInput.value}
            onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTextSubmit()
              if (e.key === 'Escape') setTextInput(null)
            }}
            onBlur={handleTextSubmit}
            className="absolute px-1 py-0.5 text-sm bg-transparent border border-neutral-500 text-white outline-none"
            style={{
              left: textInput.x + 16, // offset from canvas container padding
              top: textInput.y + 48, // offset from toolbar height
              color: activeColor,
              minWidth: 100,
            }}
          />
        )}
      </div>

      {/* Status */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-900 border-t border-neutral-800 text-[10px] text-neutral-600 shrink-0">
        <span>{annotations.length} annotation{annotations.length !== 1 ? 's' : ''}</span>
        <span>Click and drag to draw. Press Enter to confirm text.</span>
      </div>
    </div>
  )
}

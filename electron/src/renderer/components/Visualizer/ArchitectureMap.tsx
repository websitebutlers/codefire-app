import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, Network } from 'lucide-react'
import { api } from '@renderer/lib/api'

interface ArchitectureMapProps {
  projectPath: string
}

interface ArchNode {
  id: string
  name: string
  directory: string
  fileType: string
  imports: string[]
  x: number
  y: number
}

interface ArchEdge {
  id: string
  from: string
  to: string
}

const TYPE_COLORS: Record<string, string> = {
  swift: '#f97316',
  ts: '#3b82f6',
  tsx: '#3b82f6',
  js: '#eab308',
  jsx: '#eab308',
  dart: '#06b6d4',
  py: '#22c55e',
  rs: '#ef4444',
  go: '#14b8a6',
}

export default function ArchitectureMap({ projectPath }: ArchitectureMapProps) {
  const [nodes, setNodes] = useState<ArchNode[]>([])
  const [edges, setEdges] = useState<ArchEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    api.services
      .scanArchitecture(projectPath)
      .then((data) => {
        if (!cancelled) {
          setNodes(data.nodes)
          setEdges(data.edges)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to scan architecture')
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [projectPath])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(scale, scale)

    // Draw edges
    for (const edge of edges) {
      const from = nodes.find((n) => n.id === edge.from)
      const to = nodes.find((n) => n.id === edge.to)
      if (!from || !to) continue

      const isHighlighted = selectedNode === edge.from || selectedNode === edge.to
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.strokeStyle = isHighlighted ? 'rgba(249, 115, 22, 0.6)' : 'rgba(115, 115, 115, 0.15)'
      ctx.lineWidth = isHighlighted ? 1.5 : 0.5
      ctx.stroke()

      // Arrow head
      if (isHighlighted) {
        const dx = to.x - from.x
        const dy = to.y - from.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > 20) {
          const ux = dx / dist
          const uy = dy / dist
          const tipX = to.x - ux * 8
          const tipY = to.y - uy * 8
          const sz = 4
          ctx.beginPath()
          ctx.moveTo(tipX, tipY)
          ctx.lineTo(tipX - ux * sz * 2 + (-uy) * sz, tipY - uy * sz * 2 + ux * sz)
          ctx.lineTo(tipX - ux * sz * 2 - (-uy) * sz, tipY - uy * sz * 2 - ux * sz)
          ctx.closePath()
          ctx.fillStyle = 'rgba(249, 115, 22, 0.6)'
          ctx.fill()
        }
      }
    }

    // Draw nodes
    for (const node of nodes) {
      const isSelected = selectedNode === node.id
      const color = TYPE_COLORS[node.fileType] || '#888'
      const radius = isSelected ? 8 : 5

      if (isSelected) {
        ctx.beginPath()
        ctx.arc(node.x, node.y, 12, 0, Math.PI * 2)
        ctx.fillStyle = color.replace(')', ', 0.2)').replace('rgb', 'rgba')
        ctx.fill()
      }

      ctx.beginPath()
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()

      if (isSelected) {
        ctx.font = '10px monospace'
        ctx.fillStyle = '#e5e5e5'
        ctx.textAlign = 'center'
        ctx.fillText(node.name, node.x, node.y - radius - 6)
      }
    }

    ctx.restore()
  }, [nodes, edges, selectedNode, scale, offset])

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const obs = new ResizeObserver(() => draw())
    obs.observe(container)
    return () => obs.disconnect()
  }, [draw])

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    const newScale = Math.max(0.2, Math.min(3, scale - e.deltaY * 0.001))
    setScale(newScale)
  }

  function handleMouseDown(e: React.MouseEvent) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, offsetX: offset.x, offsetY: offset.y }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (dragRef.current) {
      setOffset({
        x: dragRef.current.offsetX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.offsetY + (e.clientY - dragRef.current.startY),
      })
    }
  }

  function handleMouseUp() {
    dragRef.current = null
  }

  function handleClick(e: React.MouseEvent) {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const mx = (e.clientX - rect.left - offset.x) / scale
    const my = (e.clientY - rect.top - offset.y) / scale

    const clicked = nodes.find((n) => {
      const dx = n.x - mx
      const dy = n.y - my
      return Math.sqrt(dx * dx + dy * dy) < 12
    })
    setSelectedNode(clicked ? (clicked.id === selectedNode ? null : clicked.id) : null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={16} className="animate-spin text-neutral-500" />
        <span className="ml-2 text-xs text-neutral-500">Scanning source files...</span>
      </div>
    )
  }

  if (error) return <div className="p-4 text-xs text-error">{error}</div>

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-600">
        <Network size={28} className="mb-2 opacity-40" />
        <p className="text-xs">No source files found</p>
        <p className="text-[10px] text-neutral-700 mt-1">
          Architecture map shows import relationships between source files
        </p>
      </div>
    )
  }

  const activeTypes = [...new Set(nodes.map((n) => n.fileType))].sort()
  const selected = selectedNode ? nodes.find((n) => n.id === selectedNode) : null

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-neutral-950">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      />

      {/* Legend */}
      <div className="absolute top-3 left-3 bg-neutral-900/80 backdrop-blur rounded-lg p-2 space-y-1">
        <p className="text-[9px] font-semibold text-neutral-500 uppercase tracking-wider">File Types</p>
        {activeTypes.map((type) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: TYPE_COLORS[type] || '#888' }} />
            <span className="text-[10px] text-neutral-400 font-mono">.{type}</span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="absolute bottom-3 right-3 bg-neutral-900/80 backdrop-blur rounded-lg px-3 py-1.5 flex gap-3">
        <span className="text-[10px] text-neutral-500">{nodes.length} files</span>
        <span className="text-[10px] text-neutral-500">{edges.length} imports</span>
      </div>

      {/* Selected node detail */}
      {selected && (
        <div className="absolute bottom-3 left-3 bg-neutral-900/90 backdrop-blur rounded-lg p-3 max-w-[240px]">
          <p className="text-[11px] font-bold text-neutral-200 font-mono">{selected.name}</p>
          <p className="text-[10px] text-neutral-500 font-mono">{selected.directory}</p>
          {selected.imports.length > 0 && (
            <>
              <p className="text-[9px] text-neutral-500 mt-2 uppercase tracking-wider font-semibold">
                Imports ({selected.imports.length})
              </p>
              {selected.imports.slice(0, 8).map((imp) => (
                <p key={imp} className="text-[9px] text-codefire-orange font-mono truncate">{imp}</p>
              ))}
              {selected.imports.length > 8 && (
                <p className="text-[9px] text-neutral-600">+{selected.imports.length - 8} more</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

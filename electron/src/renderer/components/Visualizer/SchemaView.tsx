import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, Database, Key, ArrowDownRight } from 'lucide-react'
import { api } from '@renderer/lib/api'

interface SchemaViewProps {
  projectPath: string
}

interface SchemaColumn {
  id: string
  name: string
  type: string
  isPrimaryKey: boolean
  isForeignKey: boolean
  references: string | null
}

interface SchemaTable {
  id: string
  name: string
  columns: SchemaColumn[]
  x: number
  y: number
}

export default function SchemaView({ projectPath }: SchemaViewProps) {
  const [tables, setTables] = useState<SchemaTable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    api.services
      .scanSchema(projectPath)
      .then((data) => {
        if (!cancelled) {
          setTables(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to scan schema')
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [projectPath])

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    setScale((s) => Math.max(0.3, Math.min(2, s - e.deltaY * 0.001)))
  }

  function handleMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('.table-card')) return
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={16} className="animate-spin text-neutral-500" />
        <span className="ml-2 text-xs text-neutral-500">Scanning for database schema...</span>
      </div>
    )
  }

  if (error) return <div className="p-4 text-xs text-error">{error}</div>

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-600">
        <Database size={28} className="mb-2 opacity-40" />
        <p className="text-xs">No database schema found</p>
        <p className="text-[10px] text-neutral-700 mt-1">
          Supports Prisma, SQL, and migration files
        </p>
      </div>
    )
  }

  // Build FK relationship lines data
  const fkLines: Array<{
    fromX: number; fromY: number; toX: number; toY: number
    highlighted: boolean
  }> = []

  for (const table of tables) {
    for (const col of table.columns) {
      if (col.isForeignKey && col.references) {
        const target = tables.find((t) => t.name === col.references)
        if (target) {
          fkLines.push({
            fromX: table.x + 120,
            fromY: table.y + 50,
            toX: target.x + 120,
            toY: target.y + 30,
            highlighted: selectedTable === table.id || selectedTable === target.id,
          })
        }
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-neutral-950 cursor-grab active:cursor-grabbing"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          position: 'absolute',
        }}
      >
        {/* FK relationship lines (SVG) */}
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{ width: '4000px', height: '4000px' }}
        >
          {fkLines.map((line, i) => {
            const midX = (line.fromX + line.toX) / 2
            return (
              <g key={i}>
                <path
                  d={`M ${line.fromX} ${line.fromY} C ${midX} ${line.fromY}, ${midX} ${line.toY}, ${line.toX} ${line.toY}`}
                  fill="none"
                  stroke={line.highlighted ? '#f97316' : 'rgba(115, 115, 115, 0.3)'}
                  strokeWidth={line.highlighted ? 2 : 1}
                  strokeDasharray={line.highlighted ? 'none' : '4 3'}
                />
                <circle
                  cx={line.toX}
                  cy={line.toY}
                  r={3}
                  fill={line.highlighted ? '#f97316' : 'rgba(115, 115, 115, 0.4)'}
                />
              </g>
            )
          })}
        </svg>

        {/* Table cards */}
        {tables.map((table) => (
          <div
            key={table.id}
            className={`table-card absolute w-[240px] rounded-lg overflow-hidden border shadow-md cursor-pointer ${
              selectedTable === table.id
                ? 'border-codefire-orange/50 shadow-codefire-orange/10'
                : 'border-neutral-700/40'
            }`}
            style={{ left: table.x, top: table.y }}
            onClick={() => setSelectedTable(selectedTable === table.id ? null : table.id)}
          >
            {/* Header */}
            <div
              className={`px-2.5 py-2 flex items-center gap-1.5 ${
                selectedTable === table.id
                  ? 'bg-codefire-orange/10'
                  : 'bg-neutral-800/60'
              }`}
            >
              <Database size={10} className="text-neutral-400" />
              <span className="text-[11px] font-bold text-neutral-200 font-mono flex-1">
                {table.name}
              </span>
              <span className="text-[9px] text-neutral-500">{table.columns.length}</span>
            </div>

            <div className="border-t border-neutral-700/30" />

            {/* Columns */}
            <div className="bg-neutral-900/80 py-1">
              {table.columns.map((col) => (
                <div
                  key={col.id}
                  className="flex items-center gap-1.5 px-2.5 py-0.5"
                >
                  {/* Key indicator */}
                  <span className="w-3 flex justify-center">
                    {col.isPrimaryKey ? (
                      <Key size={8} className="text-yellow-400" />
                    ) : col.isForeignKey ? (
                      <ArrowDownRight size={8} className="text-purple-400" />
                    ) : null}
                  </span>
                  <span className="text-[10px] text-neutral-300 font-mono flex-1 truncate">
                    {col.name}
                  </span>
                  <span className="text-[9px] text-neutral-500 font-mono">
                    {col.type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import type { TaskItem } from '@shared/models'

export type SortField = 'recent' | 'priority'
export type SortDir = 'asc' | 'desc'
export interface SortOption { field: SortField; dir: SortDir }

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'recent', label: 'Recent' },
  { field: 'priority', label: 'Priority' },
]

interface SortControlsProps {
  sort: SortOption
  onChange: (sort: SortOption) => void
}

export function SortControls({ sort, onChange }: SortControlsProps) {
  const handleClick = (field: SortField) => {
    if (sort.field === field) {
      onChange({ field, dir: sort.dir === 'desc' ? 'asc' : 'desc' })
    } else {
      onChange({ field, dir: 'desc' })
    }
  }

  return (
    <div className="flex items-center gap-1">
      <ArrowUpDown size={12} className="text-neutral-600 mr-0.5" />
      {SORT_OPTIONS.map((opt) => {
        const isActive = sort.field === opt.field
        const Icon = isActive ? (sort.dir === 'desc' ? ArrowDown : ArrowUp) : ArrowUpDown
        return (
          <button
            key={opt.field}
            onClick={() => handleClick(opt.field)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors ${
              isActive
                ? 'bg-neutral-700 text-neutral-200'
                : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            {opt.label}
            {isActive && <Icon size={10} />}
          </button>
        )
      })}
    </div>
  )
}

export function sortTasks(tasks: TaskItem[], sort: SortOption): TaskItem[] {
  const sorted = [...tasks]
  const dir = sort.dir === 'desc' ? -1 : 1

  sorted.sort((a, b) => {
    const aTime = a.updatedAt || a.createdAt || ''
    const bTime = b.updatedAt || b.createdAt || ''
    if (sort.field === 'priority') {
      const pDiff = ((a.priority ?? 0) - (b.priority ?? 0)) * dir
      if (pDiff !== 0) return pDiff
      // Secondary sort: recent desc
      return bTime.localeCompare(aTime)
    }
    // recent
    return aTime.localeCompare(bTime) * dir
  })

  return sorted
}

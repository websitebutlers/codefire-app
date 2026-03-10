import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface CollapsibleSectionProps {
  title: string
  count?: number
  icon?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

export default function CollapsibleSection({
  title,
  count,
  icon,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-neutral-800/60 transition-colors"
      >
        <ChevronDown
          size={14}
          className={`text-neutral-500 shrink-0 transition-transform duration-150 ${open ? 'rotate-0' : '-rotate-90'}`}
        />
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-300">
          {title}
        </span>
        {count !== undefined && (
          <span className="text-[10px] bg-neutral-800 text-neutral-400 rounded-full px-1.5 py-0.5 leading-none">
            {count}
          </span>
        )}
      </button>

      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  )
}

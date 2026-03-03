import { formatCost } from '@renderer/hooks/useSessions'

interface CostBadgeProps {
  cost: number
}

export default function CostBadge({ cost }: CostBadgeProps) {
  let colorClass: string
  if (cost < 1) {
    colorClass = 'bg-green-500/15 text-green-400 border-green-500/30'
  } else if (cost <= 5) {
    colorClass = 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
  } else {
    colorClass = 'bg-orange-500/15 text-orange-400 border-orange-500/30'
  }

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${colorClass}`}
    >
      {formatCost(cost)}
    </span>
  )
}

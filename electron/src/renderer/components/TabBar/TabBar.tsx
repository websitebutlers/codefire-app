import { useRef, useState, useEffect } from 'react'
import {
  CheckSquare,
  FileText,
  FolderOpen,
  Globe,
  Brain,
  ScrollText,
  Cloud,
  GitBranch,
  Clapperboard,
  Clock,
  LayoutDashboard,
  AudioLines,
  BarChart3,
  Activity,
  BookOpen,
  GitPullRequest,
} from 'lucide-react'
import TabButton from './TabButton'

interface TabBarProps {
  activeTab: string
  onTabChange: (tab: string) => void
  hiddenTabs?: Set<string>
}

const tabs = [
  { id: 'Tasks', icon: CheckSquare },
  { id: 'Dashboard', icon: LayoutDashboard },
  { id: 'Activity', icon: Activity },
  { id: 'Sessions', icon: Clock },
  { id: 'Notes', icon: FileText },
  { id: 'Memory', icon: Brain },

  { id: 'Rules', icon: ScrollText },
  { id: 'Files', icon: FolderOpen },
  { id: 'Git', icon: GitBranch },
  { id: 'Docs', icon: BookOpen },
  { id: 'Browser', icon: Globe },
  { id: 'Media', icon: Clapperboard },
  { id: 'Transcribe', icon: AudioLines },
  { id: 'Reviews', icon: GitPullRequest },
] as const

export default function TabBar({ activeTab, onTabChange, hiddenTabs }: TabBarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [iconOnly, setIconOnly] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      // Each tab with label is ~90px, icon-only is ~32px
      const visibleCount = tabs.filter((t) => !hiddenTabs?.has(t.id)).length
      const needed = visibleCount * 90
      setIconOnly(el.clientWidth < needed)
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [hiddenTabs])

  return (
    <div
      ref={containerRef}
      className="flex items-center overflow-x-auto scrollbar-none bg-neutral-900 border-b border-neutral-800 shrink-0"
    >
      {tabs.filter((tab) => !hiddenTabs?.has(tab.id)).map((tab) => (
        <TabButton
          key={tab.id}
          label={tab.id}
          icon={<tab.icon size={16} />}
          isActive={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
          iconOnly={iconOnly}
        />
      ))}
    </div>
  )
}

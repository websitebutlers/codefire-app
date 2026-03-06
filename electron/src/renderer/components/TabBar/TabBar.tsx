import {
  CheckSquare,
  FileText,
  FolderOpen,
  Globe,
  Brain,
  ScrollText,
  Cloud,
  GitBranch,
  Image,
  Clock,
  Info,
  Mic,
  BarChart3,
} from 'lucide-react'
import TabButton from './TabButton'

interface TabBarProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

const tabs = [
  { id: 'Tasks', icon: CheckSquare },
  { id: 'Notes', icon: FileText },
  { id: 'Files', icon: FolderOpen },
  { id: 'Browser', icon: Globe },
  { id: 'Memory', icon: Brain },
  { id: 'Rules', icon: ScrollText },
  { id: 'Services', icon: Cloud },
  { id: 'Git', icon: GitBranch },
  { id: 'Images', icon: Image },
  { id: 'Sessions', icon: Clock },
  { id: 'Details', icon: Info },
  { id: 'Recordings', icon: Mic },
  { id: 'Visualizer', icon: BarChart3 },
] as const

export default function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="flex items-center overflow-x-auto scrollbar-none bg-neutral-900 border-b border-neutral-800 shrink-0">
      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          label={tab.id}
          icon={<tab.icon size={16} />}
          isActive={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
        />
      ))}
    </div>
  )
}

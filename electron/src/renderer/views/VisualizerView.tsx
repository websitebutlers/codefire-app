import { useState } from 'react'
import { GitBranch, Flame, Network, Database } from 'lucide-react'
import GitGraph from '@renderer/components/Visualizer/GitGraph'
import FileHeatmap from '@renderer/components/Visualizer/FileHeatmap'
import ArchitectureMap from '@renderer/components/Visualizer/ArchitectureMap'
import SchemaViewComp from '@renderer/components/Visualizer/SchemaView'

interface VisualizerViewProps {
  projectId: string
  projectPath: string
}

const subTabs = [
  { id: 'git-graph', label: 'Git Graph', icon: GitBranch },
  { id: 'file-heatmap', label: 'Activity Heatmap', icon: Flame },
  { id: 'architecture', label: 'Architecture Map', icon: Network },
  { id: 'schema', label: 'Schema View', icon: Database },
] as const

type SubTab = (typeof subTabs)[number]['id']

export default function VisualizerView({ projectPath }: VisualizerViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('git-graph')

  const active = subTabs.find((t) => t.id === activeSubTab)!

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-neutral-800 bg-neutral-900 shrink-0">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
              activeSubTab === tab.id
                ? 'bg-neutral-800 text-neutral-200'
                : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50'
            }`}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeSubTab === 'git-graph' && <GitGraph projectPath={projectPath} />}
        {activeSubTab === 'file-heatmap' && <FileHeatmap projectPath={projectPath} />}
        {activeSubTab === 'architecture' && <ArchitectureMap projectPath={projectPath} />}
        {activeSubTab === 'schema' && <SchemaViewComp projectPath={projectPath} />}
      </div>
    </div>
  )
}

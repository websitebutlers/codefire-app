import { useState } from 'react'
import { GitBranch, Flame, Network, Database } from 'lucide-react'

interface VisualizerViewProps {
  projectId: string
  projectPath: string
}

const subTabs = [
  { id: 'git-graph', label: 'Git Graph', icon: GitBranch },
  { id: 'file-heatmap', label: 'File Heatmap', icon: Flame },
  { id: 'architecture', label: 'Architecture Map', icon: Network },
  { id: 'schema', label: 'Schema View', icon: Database },
] as const

type SubTab = (typeof subTabs)[number]['id']

export default function VisualizerView({ projectId: _projectId, projectPath: _projectPath }: VisualizerViewProps) {
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

      {/* Placeholder content */}
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <active.icon size={40} className="text-neutral-700 mb-4" />
        <h3 className="text-sm font-medium text-neutral-400 mb-1">{active.label}</h3>
        <p className="text-xs text-neutral-600 max-w-xs">
          {activeSubTab === 'git-graph' && 'Visualize commit history, branches, and merge patterns.'}
          {activeSubTab === 'file-heatmap' && 'See which files change most frequently across commits.'}
          {activeSubTab === 'architecture' && 'Explore dependency graphs and module relationships.'}
          {activeSubTab === 'schema' && 'View database schema and table relationships.'}
        </p>
        <span className="mt-4 text-[10px] text-neutral-700 uppercase tracking-wider">Coming Soon</span>
      </div>
    </div>
  )
}

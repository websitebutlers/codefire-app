import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Client, Project } from '@shared/models'
import ProjectItem from './ProjectItem'

interface ClientGroupProps {
  client: Client
  projects: Project[]
  onProjectClick: (projectId: string) => void
  selectedProjectId?: string | null
  allClients?: Client[]
  onRefresh?: () => void
}

export default function ClientGroup({
  client,
  projects,
  onProjectClick,
  selectedProjectId,
  allClients,
  onRefresh,
}: ClientGroupProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      {/* Client header */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="
          w-full flex items-center gap-2 px-3 py-1.5
          text-[11px] text-neutral-400 hover:text-neutral-200
          hover:bg-white/[0.04] transition-colors duration-100 cursor-default
        "
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: client.color || '#737373' }}
        />
        <span className="truncate font-semibold uppercase tracking-wider">
          {client.name}
        </span>
        <span className="ml-auto flex-shrink-0 text-neutral-600">
          <ChevronDown size={12} className={`transition-transform duration-150 ${expanded ? 'rotate-0' : '-rotate-90'}`} />
        </span>
      </button>

      {/* Project list */}
      {expanded && projects.length > 0 && (
        <div className="mt-0.5">
          {projects.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              onClick={() => onProjectClick(project.id)}
              indent
              isSelected={selectedProjectId === project.id}
              clients={allClients}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}

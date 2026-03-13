import { useState, useEffect, useMemo, useCallback } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useGlobalTasks } from '@renderer/hooks/useGlobalTasks'
import KanbanBoard from '@renderer/components/Kanban/KanbanBoard'
import { SortControls, sortTasks, type SortOption } from '@renderer/components/Kanban/SortControls'
import ProjectTaskSummary from '@renderer/components/Home/ProjectTaskSummary'
import RecentEmails from '@renderer/components/Home/RecentEmails'
import { ListTodo } from 'lucide-react'
import { api } from '@renderer/lib/api'
import type { TaskItem } from '@shared/models'
import type { Project, Client } from '@shared/models'

export default function AllProjectsView() {
  const [sort, setSort] = useState<SortOption>({ field: 'recent', dir: 'desc' })
  const [filterProject, setFilterProject] = useState<string>('all')
  const [filterGroup, setFilterGroup] = useState<string>('all')
  const {
    tasks,
    todoTasks,
    inProgressTasks,
    doneTasks,
    loading,
    error,
    createTask,
    updateTask,
    deleteTask,
    pollingPaused,
  } = useGlobalTasks()

  // Fetch projects and clients/groups for filter options
  const [projectNames, setProjectNames] = useState<Record<string, string>>({})
  const [projectColors, setProjectColors] = useState<Record<string, string | null>>({})
  const [projectGroupColors, setProjectGroupColors] = useState<Record<string, string | null>>({})
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])

  useEffect(() => {
    Promise.all([api.projects.list(), api.clients.list()]).then(([projectList, clientList]) => {
      const map: Record<string, string> = {}
      const colors: Record<string, string | null> = {}
      const groupColors: Record<string, string | null> = {}
      const clientColorMap = new Map<string, string>()
      for (const c of clientList) clientColorMap.set(c.id, c.color)
      for (const p of projectList) {
        if (p.id !== '__global__') {
          map[p.id] = p.name
          colors[p.id] = p.color
          groupColors[p.id] = p.clientId ? (clientColorMap.get(p.clientId) ?? null) : null
        }
      }
      setProjectNames(map)
      setProjectColors(colors)
      setProjectGroupColors(groupColors)
      setProjects(projectList)
      setClients(clientList)
    }).catch(() => {})
  }, [])

  // Collect unique project IDs that have tasks
  const projectOptions = useMemo(() => {
    const projectSet = new Set<string>()
    for (const t of tasks) {
      if (t.projectId) projectSet.add(t.projectId)
    }
    return Array.from(projectSet).sort()
  }, [tasks])

  // Map clientId → set of projectIds for group filtering
  const groupProjectIds = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    for (const p of projects) {
      if (p.clientId) {
        if (!map[p.clientId]) map[p.clientId] = new Set()
        map[p.clientId].add(p.id)
      }
    }
    return map
  }, [projects])

  // Apply filters
  const applyFilter = useCallback((list: TaskItem[]) => {
    return list.filter((t) => {
      if (filterProject !== 'all' && t.projectId !== filterProject) return false
      if (filterGroup !== 'all') {
        const groupProjects = groupProjectIds[filterGroup]
        if (!groupProjects || !groupProjects.has(t.projectId)) return false
      }
      return true
    })
  }, [filterProject, filterGroup, groupProjectIds])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-neutral-600">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-error">{error}</p>
      </div>
    )
  }

  const filteredTodo = applyFilter(todoTasks)
  const filteredInProgress = applyFilter(inProgressTasks)
  const filteredDone = applyFilter(doneTasks)

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-800 bg-neutral-950 shrink-0">
        <ListTodo size={16} className="text-codefire-orange" />
        <h1 className="text-sm font-semibold text-neutral-200">Planner</h1>

        {/* Project filter */}
        <select
          value={filterProject}
          onChange={(e) => setFilterProject(e.target.value)}
          className="text-[10px] bg-neutral-800 text-neutral-300 border border-neutral-700 rounded px-1.5 py-0.5 focus:outline-none focus:border-neutral-600"
        >
          <option value="all">All Projects</option>
          <option value="__global__">Global</option>
          {projectOptions.filter(id => id !== '__global__').map((id) => (
            <option key={id} value={id}>{projectNames[id] || id.slice(0, 8)}</option>
          ))}
        </select>

        {/* Group/Client filter */}
        <select
          value={filterGroup}
          onChange={(e) => setFilterGroup(e.target.value)}
          className="text-[10px] bg-neutral-800 text-neutral-300 border border-neutral-700 rounded px-1.5 py-0.5 focus:outline-none focus:border-neutral-600"
        >
          <option value="all">All Groups</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <div className="flex-1" />
        <SortControls sort={sort} onChange={setSort} />
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
          {filteredTodo.length + filteredInProgress.length} open
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-500">
          {filteredDone.length} done
        </span>
      </div>

      {/* Content: Kanban top, project summary + emails bottom */}
      <div className="flex-1 overflow-hidden">
        <Group orientation="vertical" id="all-projects-layout">
          {/* Top: Global Kanban Board */}
          <Panel id="kanban" defaultSize="60%" minSize="25%">
            <div className="h-full overflow-hidden">
              <KanbanBoard
                todoTasks={sortTasks(filteredTodo, sort)}
                inProgressTasks={sortTasks(filteredInProgress, sort)}
                doneTasks={sortTasks(filteredDone, sort)}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
                onAddTask={createTask}
                projectNames={projectNames}
                projectColors={projectColors}
                projectGroupColors={projectGroupColors}
                projectId="__global__"
                pollingPaused={pollingPaused}
              />
            </div>
          </Panel>

          <Separator className="h-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />

          {/* Bottom: Project Summary + Recent Emails side by side */}
          <Panel id="bottom-panel" defaultSize="40%" minSize="15%">
            <Group orientation="horizontal" id="bottom-split">
              <Panel id="project-summary" defaultSize="60%" minSize="30%">
                <ProjectTaskSummary />
              </Panel>
              <Separator className="w-[2px] bg-neutral-800 hover:bg-codefire-orange active:bg-codefire-orange transition-colors duration-150" />
              <Panel id="recent-emails" defaultSize="40%" minSize="20%">
                <RecentEmails />
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
    </div>
  )
}

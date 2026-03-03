import type {
  Project,
  TaskItem,
  TaskNote,
  Note,
  Session,
  Client,
} from '@shared/models'

const invoke = window.api.invoke

export const api = {
  projects: {
    list: () => invoke('projects:list') as Promise<Project[]>,
    get: (id: string) => invoke('projects:get', id) as Promise<Project | undefined>,
    getByPath: (path: string) =>
      invoke('projects:getByPath', path) as Promise<Project | undefined>,
    create: (data: {
      id?: string
      name: string
      path: string
      claudeProject?: string
      clientId?: string
      tags?: string
    }) => invoke('projects:create', data) as Promise<Project>,
    update: (
      id: string,
      data: {
        name?: string
        path?: string
        claudeProject?: string | null
        clientId?: string | null
        tags?: string | null
        sortOrder?: number
      }
    ) => invoke('projects:update', id, data) as Promise<Project | undefined>,
    updateLastOpened: (id: string) =>
      invoke('projects:updateLastOpened', id) as Promise<void>,
    delete: (id: string) => invoke('projects:delete', id) as Promise<boolean>,
  },

  tasks: {
    list: (projectId: string, status?: string) =>
      invoke('tasks:list', projectId, status) as Promise<TaskItem[]>,
    listGlobal: (status?: string) =>
      invoke('tasks:listGlobal', status) as Promise<TaskItem[]>,
    get: (id: number) =>
      invoke('tasks:get', id) as Promise<TaskItem | undefined>,
    create: (data: {
      projectId: string
      title: string
      description?: string
      priority?: number
      source?: string
      labels?: string[]
      isGlobal?: boolean
    }) => invoke('tasks:create', data) as Promise<TaskItem>,
    update: (
      id: number,
      data: {
        title?: string
        description?: string
        status?: string
        priority?: number
        labels?: string[]
      }
    ) => invoke('tasks:update', id, data) as Promise<TaskItem | undefined>,
    delete: (id: number) => invoke('tasks:delete', id) as Promise<boolean>,
  },

  taskNotes: {
    list: (taskId: number) =>
      invoke('taskNotes:list', taskId) as Promise<TaskNote[]>,
    create: (data: {
      taskId: number
      content: string
      source?: string
      sessionId?: string
    }) => invoke('taskNotes:create', data) as Promise<TaskNote>,
  },

  notes: {
    list: (projectId: string, pinnedOnly?: boolean, isGlobal?: boolean) =>
      invoke('notes:list', projectId, pinnedOnly, isGlobal) as Promise<Note[]>,
    get: (id: number) => invoke('notes:get', id) as Promise<Note | undefined>,
    create: (data: {
      projectId: string
      title: string
      content?: string
      pinned?: boolean
      sessionId?: string
      isGlobal?: boolean
    }) => invoke('notes:create', data) as Promise<Note>,
    update: (
      id: number,
      data: {
        title?: string
        content?: string
        pinned?: boolean
      }
    ) => invoke('notes:update', id, data) as Promise<Note | undefined>,
    delete: (id: number) => invoke('notes:delete', id) as Promise<boolean>,
    search: (projectId: string, query: string, isGlobal?: boolean) =>
      invoke('notes:search', projectId, query, isGlobal) as Promise<Note[]>,
  },

  sessions: {
    list: (projectId: string) =>
      invoke('sessions:list', projectId) as Promise<Session[]>,
    get: (id: string) =>
      invoke('sessions:get', id) as Promise<Session | undefined>,
    create: (data: {
      id: string
      projectId: string
      slug?: string
      startedAt?: string
      model?: string
      gitBranch?: string
      summary?: string
    }) => invoke('sessions:create', data) as Promise<Session>,
    update: (
      id: string,
      data: {
        endedAt?: string
        summary?: string
        messageCount?: number
        toolUseCount?: number
        filesChanged?: string
        inputTokens?: number
        outputTokens?: number
        cacheCreationTokens?: number
        cacheReadTokens?: number
      }
    ) => invoke('sessions:update', id, data) as Promise<Session | undefined>,
    search: (query: string) =>
      invoke('sessions:search', query) as Promise<Session[]>,
  },

  clients: {
    list: () => invoke('clients:list') as Promise<Client[]>,
    get: (id: string) =>
      invoke('clients:get', id) as Promise<Client | undefined>,
    create: (data: { name: string; color?: string }) =>
      invoke('clients:create', data) as Promise<Client>,
  },

  windows: {
    openProject: (projectId: string) =>
      invoke('window:openProject', projectId) as Promise<{ windowId: number }>,
    closeProject: (projectId: string) =>
      invoke('window:closeProject', projectId) as Promise<void>,
    getProjectWindows: () =>
      invoke('window:getProjectWindows') as Promise<string[]>,
    focusMain: () => invoke('window:focusMain') as Promise<void>,
  },

  git: {
    status: (projectPath: string) =>
      invoke('git:status', projectPath) as Promise<{
        branch: string
        files: Array<{ status: string; path: string }>
        isClean: boolean
      }>,
    diff: (projectPath: string, options?: { staged?: boolean; file?: string }) =>
      invoke('git:diff', projectPath, options) as Promise<string>,
    log: (projectPath: string, options?: { limit?: number; file?: string }) =>
      invoke('git:log', projectPath, options) as Promise<
        Array<{
          hash: string
          author: string
          email: string
          date: string
          subject: string
          body: string
        }>
      >,
    stage: (projectPath: string, files: string[]) =>
      invoke('git:stage', projectPath, files) as Promise<void>,
    unstage: (projectPath: string, files: string[]) =>
      invoke('git:unstage', projectPath, files) as Promise<void>,
    commit: (projectPath: string, message: string) =>
      invoke('git:commit', projectPath, message) as Promise<{ hash: string }>,
  },
}

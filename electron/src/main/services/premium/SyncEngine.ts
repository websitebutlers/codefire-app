import type Database from 'better-sqlite3'
import { getSupabaseClient } from './SupabaseClient'
import type { SyncState } from '@shared/premium-models'
import { normalizeGitUrl } from '../ProjectDiscovery'

/**
 * SyncEngine manages bidirectional sync between the local SQLite database
 * and the remote Supabase backend for premium team features.
 *
 * Push-then-pull with last-write-wins conflict resolution.
 * Matches projects by normalized git repo URL (canonical team identifier).
 */
export class SyncEngine {
  private db: Database.Database
  private intervalId: ReturnType<typeof setInterval> | null = null
  private isSyncing = false
  private currentMappings: Array<{ localId: string; remoteId: string }> = []

  constructor(db: Database.Database) {
    this.db = db
    this.ensureSyncTable()
  }

  private ensureSyncTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS syncState (
        entityType TEXT NOT NULL,
        localId TEXT NOT NULL,
        remoteId TEXT,
        projectId TEXT,
        lastSyncedAt TEXT,
        dirty INTEGER NOT NULL DEFAULT 0,
        isDeleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (entityType, localId)
      )
    `)
  }

  /** Start the periodic sync loop */
  start(intervalMs = 30_000): void {
    if (this.intervalId) return
    // Run immediately, then on interval
    this.syncAll().catch((err) => console.error('[SyncEngine] Initial sync failed:', err))
    this.intervalId = setInterval(() => {
      this.syncAll().catch((err) => console.error('[SyncEngine] Sync cycle failed:', err))
    }, intervalMs)
    console.log(`[SyncEngine] Started with ${intervalMs}ms interval`)
  }

  /** Stop the periodic sync loop */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.log('[SyncEngine] Stopped')
    }
  }

  /** Track an entity for syncing */
  trackEntity(entityType: string, localId: string, projectId: string): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO syncState (entityType, localId, projectId, dirty) VALUES (?, ?, ?, 1)`
    ).run(entityType, localId, projectId)
  }

  /** Mark an entity as dirty (needs sync) */
  markDirty(entityType: string, localId: string): void {
    this.db.prepare(
      `UPDATE syncState SET dirty = 1 WHERE entityType = ? AND localId = ?`
    ).run(entityType, localId)
  }

  /** Get sync state for all tracked entities */
  getSyncStates(): SyncState[] {
    const rows = this.db.prepare(`SELECT * FROM syncState`).all() as Array<{
      entityType: string
      localId: string
      remoteId: string | null
      projectId: string | null
      lastSyncedAt: string | null
      dirty: number
    }>
    return rows.map((r) => ({
      entityType: r.entityType as SyncState['entityType'],
      localId: r.localId,
      remoteId: r.remoteId,
      projectId: r.projectId,
      lastSyncedAt: r.lastSyncedAt,
      dirty: r.dirty === 1,
    }))
  }

  /**
   * Resolve a local project ID to its remote (synced) project ID.
   * Used by all premium collaborative features (presence, activity, docs, reviews)
   * so that all team members share the same remote project namespace.
   */
  async getRemoteProjectId(localProjectId: string): Promise<string | null> {
    // Check cached mappings first
    const cached = this.currentMappings.find((m) => m.localId === localProjectId)
    if (cached) return cached.remoteId

    // Fetch fresh mappings if cache is empty
    try {
      const mappings = await this.fetchProjectMappings()
      this.currentMappings = mappings
      const match = mappings.find((m) => m.localId === localProjectId)
      return match?.remoteId ?? null
    } catch {
      return null
    }
  }

  /** Run a full sync cycle: push dirty entities, then pull remote updates */
  private async syncAll(): Promise<void> {
    const client = getSupabaseClient()
    if (!client) return

    const { data: { user } } = await client.auth.getUser()
    if (!user || this.isSyncing) return

    this.isSyncing = true
    try {
      this.currentMappings = await this.fetchProjectMappings()
      for (const mapping of this.currentMappings) {
        await this.syncProject(mapping.localId, mapping.remoteId, user.id)
      }
    } catch (err) {
      console.error('[SyncEngine] Sync failed:', err)
    }
    this.isSyncing = false
  }

  private async syncProject(localId: string, remoteId: string, userId: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) return

    await this.pushDirtyTasks(localId, remoteId, userId, client)
    await this.pushDirtyNotes(localId, remoteId, userId, client)
    await this.pushDirtyTaskNotes(localId, remoteId, userId, client)
    await this.pullRemoteTasks(localId, remoteId, client)
    await this.pullRemoteNotes(localId, remoteId, client)
  }

  // ─── Push: Tasks ──────────────────────────────────────────────────────────────

  private async pushDirtyTasks(
    projectId: string, remoteProjectId: string, userId: string,
    client: NonNullable<ReturnType<typeof getSupabaseClient>>
  ): Promise<void> {
    const dirtyRows = this.db.prepare(
      `SELECT * FROM syncState WHERE dirty = 1 AND entityType = 'task' AND projectId = ?`
    ).all(projectId) as Array<{ localId: string; remoteId: string | null; isDeleted: number }>

    for (const row of dirtyRows) {
      try {
        if (row.isDeleted) {
          if (row.remoteId) {
            await client.from('synced_tasks').delete().eq('id', row.remoteId)
          }
          this.db.prepare(
            `DELETE FROM syncState WHERE entityType = 'task' AND localId = ?`
          ).run(row.localId)
          continue
        }

        const task = this.db.prepare(
          `SELECT * FROM taskItems WHERE id = ?`
        ).get(Number(row.localId)) as any
        if (!task) continue

        const body: Record<string, unknown> = {
          project_id: remoteProjectId,
          local_id: String(task.id),
          title: task.title,
          status: task.status,
          priority: task.priority,
          source: task.source,
          created_by: userId,
          created_at: task.createdAt,
          updated_at: task.updatedAt || task.createdAt,
        }
        if (task.description) body.description = task.description
        if (task.completedAt) body.completed_at = task.completedAt
        if (task.labels) {
          try { body.labels = JSON.parse(task.labels) } catch { /* skip */ }
        }

        let remoteId = row.remoteId
        if (remoteId) {
          await client.from('synced_tasks').update(body).eq('id', remoteId)
        } else {
          const { data, error } = await client.from('synced_tasks').insert(body).select('id').single()
          if (error) { console.error('[SyncEngine] Push task failed:', error); continue }
          remoteId = data.id
        }

        this.db.prepare(
          `UPDATE syncState SET dirty = 0, remoteId = ?, lastSyncedAt = datetime('now')
           WHERE entityType = 'task' AND localId = ?`
        ).run(remoteId, row.localId)
      } catch (err) {
        console.error(`[SyncEngine] Failed to push task ${row.localId}:`, err)
      }
    }
  }

  // ─── Push: Notes ──────────────────────────────────────────────────────────────

  private async pushDirtyNotes(
    projectId: string, remoteProjectId: string, userId: string,
    client: NonNullable<ReturnType<typeof getSupabaseClient>>
  ): Promise<void> {
    const dirtyRows = this.db.prepare(
      `SELECT * FROM syncState WHERE dirty = 1 AND entityType = 'note' AND projectId = ?`
    ).all(projectId) as Array<{ localId: string; remoteId: string | null; isDeleted: number }>

    for (const row of dirtyRows) {
      try {
        if (row.isDeleted) {
          if (row.remoteId) {
            await client.from('synced_notes').delete().eq('id', row.remoteId)
          }
          this.db.prepare(
            `DELETE FROM syncState WHERE entityType = 'note' AND localId = ?`
          ).run(row.localId)
          continue
        }

        const note = this.db.prepare(
          `SELECT * FROM notes WHERE id = ?`
        ).get(Number(row.localId)) as any
        if (!note) continue

        const body: Record<string, unknown> = {
          project_id: remoteProjectId,
          title: note.title,
          content: note.content,
          pinned: !!note.pinned,
          created_by: userId,
          created_at: note.createdAt,
          updated_at: note.updatedAt,
        }

        let remoteId = row.remoteId
        if (remoteId) {
          await client.from('synced_notes').update(body).eq('id', remoteId)
        } else {
          const { data, error } = await client.from('synced_notes').insert(body).select('id').single()
          if (error) { console.error('[SyncEngine] Push note failed:', error); continue }
          remoteId = data.id
        }

        this.db.prepare(
          `UPDATE syncState SET dirty = 0, remoteId = ?, lastSyncedAt = datetime('now')
           WHERE entityType = 'note' AND localId = ?`
        ).run(remoteId, row.localId)
      } catch (err) {
        console.error(`[SyncEngine] Failed to push note ${row.localId}:`, err)
      }
    }
  }

  // ─── Push: Task Notes ─────────────────────────────────────────────────────────

  private async pushDirtyTaskNotes(
    projectId: string, _remoteProjectId: string, userId: string,
    client: NonNullable<ReturnType<typeof getSupabaseClient>>
  ): Promise<void> {
    const dirtyRows = this.db.prepare(
      `SELECT * FROM syncState WHERE dirty = 1 AND entityType = 'taskNote' AND projectId = ?`
    ).all(projectId) as Array<{ localId: string; remoteId: string | null; isDeleted: number }>

    for (const row of dirtyRows) {
      try {
        if (row.isDeleted) {
          if (row.remoteId) {
            await client.from('synced_task_notes').delete().eq('id', row.remoteId)
          }
          this.db.prepare(
            `DELETE FROM syncState WHERE entityType = 'taskNote' AND localId = ?`
          ).run(row.localId)
          continue
        }

        const taskNote = this.db.prepare(
          `SELECT * FROM taskNotes WHERE id = ?`
        ).get(Number(row.localId)) as any
        if (!taskNote) continue

        // Find the remote task ID for this task note's parent task
        const taskSync = this.db.prepare(
          `SELECT remoteId FROM syncState WHERE entityType = 'task' AND localId = ?`
        ).get(String(taskNote.taskId)) as { remoteId: string | null } | undefined
        if (!taskSync?.remoteId) continue

        const body: Record<string, unknown> = {
          task_id: taskSync.remoteId,
          content: taskNote.content,
          source: taskNote.source,
          created_by: userId,
          created_at: taskNote.createdAt,
        }
        if (taskNote.mentions) {
          try { body.mentions = JSON.parse(taskNote.mentions) } catch { /* skip */ }
        }

        let remoteId = row.remoteId
        if (remoteId) {
          await client.from('synced_task_notes').update(body).eq('id', remoteId)
        } else {
          const { data, error } = await client.from('synced_task_notes').insert(body).select('id').single()
          if (error) { console.error('[SyncEngine] Push task note failed:', error); continue }
          remoteId = data.id
        }

        this.db.prepare(
          `UPDATE syncState SET dirty = 0, remoteId = ?, lastSyncedAt = datetime('now')
           WHERE entityType = 'taskNote' AND localId = ?`
        ).run(remoteId, row.localId)
      } catch (err) {
        console.error(`[SyncEngine] Failed to push taskNote ${row.localId}:`, err)
      }
    }
  }

  // ─── Pull: Tasks ──────────────────────────────────────────────────────────────

  private async pullRemoteTasks(
    projectId: string, remoteProjectId: string,
    client: NonNullable<ReturnType<typeof getSupabaseClient>>
  ): Promise<void> {
    const { data: remoteTasks, error } = await client
      .from('synced_tasks')
      .select('*')
      .eq('project_id', remoteProjectId)
      .order('updated_at', { ascending: false })

    if (error || !remoteTasks) return

    for (const remote of remoteTasks) {
      const remoteId = remote.id as string

      // Check if we already have a sync mapping for this remote task
      const existing = this.db.prepare(
        `SELECT localId FROM syncState WHERE entityType = 'task' AND remoteId = ?`
      ).get(remoteId) as { localId: string } | undefined

      if (existing) {
        // Check if local is dirty (has unsaved changes)
        const syncState = this.db.prepare(
          `SELECT dirty FROM syncState WHERE entityType = 'task' AND localId = ?`
        ).get(existing.localId) as { dirty: number } | undefined

        if (syncState?.dirty) {
          // Conflict: local is dirty — use last-write-wins
          const localTask = this.db.prepare(
            `SELECT updatedAt, createdAt FROM taskItems WHERE id = ?`
          ).get(Number(existing.localId)) as { updatedAt: string | null; createdAt: string } | undefined

          const localUpdated = localTask?.updatedAt || localTask?.createdAt || '1970-01-01'
          const remoteUpdated = remote.updated_at || '1970-01-01'

          if (remoteUpdated > localUpdated) {
            this.applyRemoteTask(remote, Number(existing.localId))
            this.db.prepare(
              `UPDATE syncState SET dirty = 0, lastSyncedAt = datetime('now') WHERE entityType = 'task' AND localId = ?`
            ).run(existing.localId)
          }
          // else: local wins, will be pushed next cycle
        } else {
          // No conflict, apply remote
          this.applyRemoteTask(remote, Number(existing.localId))
          this.db.prepare(
            `UPDATE syncState SET lastSyncedAt = datetime('now') WHERE entityType = 'task' AND localId = ?`
          ).run(existing.localId)
        }
      } else {
        // New remote task — create locally
        const localId = this.createLocalTask(remote, projectId)
        this.db.prepare(
          `INSERT OR REPLACE INTO syncState (entityType, localId, remoteId, projectId, dirty, lastSyncedAt)
           VALUES ('task', ?, ?, ?, 0, datetime('now'))`
        ).run(String(localId), remoteId, projectId)
      }
    }
  }

  // ─── Pull: Notes ──────────────────────────────────────────────────────────────

  private async pullRemoteNotes(
    projectId: string, remoteProjectId: string,
    client: NonNullable<ReturnType<typeof getSupabaseClient>>
  ): Promise<void> {
    const { data: remoteNotes, error } = await client
      .from('synced_notes')
      .select('*')
      .eq('project_id', remoteProjectId)
      .order('updated_at', { ascending: false })

    if (error || !remoteNotes) return

    for (const remote of remoteNotes) {
      const remoteId = remote.id as string

      const existing = this.db.prepare(
        `SELECT localId FROM syncState WHERE entityType = 'note' AND remoteId = ?`
      ).get(remoteId) as { localId: string } | undefined

      if (existing) {
        const syncState = this.db.prepare(
          `SELECT dirty FROM syncState WHERE entityType = 'note' AND localId = ?`
        ).get(existing.localId) as { dirty: number } | undefined

        if (syncState?.dirty) {
          const localNote = this.db.prepare(
            `SELECT updatedAt FROM notes WHERE id = ?`
          ).get(Number(existing.localId)) as { updatedAt: string } | undefined

          const localUpdated = localNote?.updatedAt || '1970-01-01'
          const remoteUpdated = remote.updated_at || '1970-01-01'

          if (remoteUpdated > localUpdated) {
            this.applyRemoteNote(remote, Number(existing.localId))
            this.db.prepare(
              `UPDATE syncState SET dirty = 0, lastSyncedAt = datetime('now') WHERE entityType = 'note' AND localId = ?`
            ).run(existing.localId)
          }
        } else {
          this.applyRemoteNote(remote, Number(existing.localId))
          this.db.prepare(
            `UPDATE syncState SET lastSyncedAt = datetime('now') WHERE entityType = 'note' AND localId = ?`
          ).run(existing.localId)
        }
      } else {
        const localId = this.createLocalNote(remote, projectId)
        this.db.prepare(
          `INSERT OR REPLACE INTO syncState (entityType, localId, remoteId, projectId, dirty, lastSyncedAt)
           VALUES ('note', ?, ?, ?, 0, datetime('now'))`
        ).run(String(localId), remoteId, projectId)
      }
    }
  }

  // ─── Apply Remote → Local ─────────────────────────────────────────────────────

  private applyRemoteTask(remote: Record<string, any>, localId: number): void {
    const labels = remote.labels ? JSON.stringify(remote.labels) : null
    this.db.prepare(
      `UPDATE taskItems SET title = ?, description = ?, status = ?, priority = ?,
       labels = ?, completedAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      remote.title,
      remote.description || null,
      remote.status || 'todo',
      remote.priority || 0,
      labels,
      remote.completed_at || null,
      remote.updated_at || new Date().toISOString(),
      localId
    )
  }

  private createLocalTask(remote: Record<string, any>, projectId: string): number {
    const now = new Date().toISOString()
    const labels = remote.labels ? JSON.stringify(remote.labels) : null
    const result = this.db.prepare(
      `INSERT INTO taskItems (projectId, title, description, status, priority, source, labels, createdAt, updatedAt, completedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      projectId,
      remote.title || '',
      remote.description || null,
      remote.status || 'todo',
      remote.priority || 0,
      remote.source || 'synced',
      labels,
      remote.created_at || now,
      remote.updated_at || now,
      remote.completed_at || null
    )
    return Number(result.lastInsertRowid)
  }

  private applyRemoteNote(remote: Record<string, any>, localId: number): void {
    this.db.prepare(
      `UPDATE notes SET title = ?, content = ?, pinned = ?, updatedAt = ? WHERE id = ?`
    ).run(
      remote.title,
      remote.content || '',
      remote.pinned ? 1 : 0,
      remote.updated_at || new Date().toISOString(),
      localId
    )
  }

  private createLocalNote(remote: Record<string, any>, projectId: string): number {
    const now = new Date().toISOString()
    const result = this.db.prepare(
      `INSERT INTO notes (projectId, title, content, pinned, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      projectId,
      remote.title || '',
      remote.content || '',
      remote.pinned ? 1 : 0,
      remote.created_at || now,
      remote.updated_at || now
    )
    return Number(result.lastInsertRowid)
  }

  // ─── Project Mappings ─────────────────────────────────────────────────────────

  /**
   * Fetch synced projects from Supabase and match them to local projects
   * by normalized git repo URL (primary) or name (fallback).
   */
  private async fetchProjectMappings(): Promise<Array<{ localId: string; remoteId: string }>> {
    const client = getSupabaseClient()
    if (!client) return []

    // Get team ID from current user's membership
    const { data: { user } } = await client.auth.getUser()
    if (!user) return []

    const { data: membership } = await client.from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .limit(1)
      .single()
    if (!membership) return []

    const { data: remoteProjects } = await client
      .from('synced_projects')
      .select('id, name, repo_url')
      .eq('team_id', membership.team_id)
    if (!remoteProjects) return []

    // Get local projects (exclude __global__)
    const localProjects = this.db.prepare(
      `SELECT id, name, repoUrl FROM projects WHERE id != '__global__'`
    ).all() as Array<{ id: string; name: string; repoUrl: string | null }>

    const mappings: Array<{ localId: string; remoteId: string }> = []

    for (const remote of remoteProjects) {
      const remoteRepoUrl = remote.repo_url as string | null
      const remoteName = remote.name as string | null
      let match: typeof localProjects[0] | undefined

      // Match by normalized repo URL first (canonical team identifier)
      if (remoteRepoUrl) {
        const normalizedRemote = normalizeGitUrl(remoteRepoUrl)
        match = localProjects.find((p) => {
          if (!p.repoUrl) return false
          return normalizeGitUrl(p.repoUrl) === normalizedRemote
        })
      }

      // Fall back to name matching for non-git projects
      if (!match && remoteName) {
        match = localProjects.find((p) => p.name === remoteName)
      }

      if (match) {
        mappings.push({ localId: match.id, remoteId: remote.id })
      }
    }

    return mappings
  }
}

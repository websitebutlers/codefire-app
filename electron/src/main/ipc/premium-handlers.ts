import { ipcMain } from 'electron'
import type { AuthService } from '../services/premium/AuthService'
import type { TeamService } from '../services/premium/TeamService'
import type { SyncEngine } from '../services/premium/SyncEngine'
import type { PresenceService } from '../services/premium/PresenceService'
import { getSupabaseClient } from '../services/premium/SupabaseClient'
import { getConfigValue } from '../services/ConfigStore'

/** Ensure thrown values are proper Error instances so Electron IPC serializes the message */
function ensureError(err: unknown): Error {
  if (err instanceof Error) return err
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return new Error(String((err as any).message))
  }
  return new Error(String(err))
}

/**
 * Resolve a local project ID to its remote (synced) project ID.
 * All collaborative features (presence, activity, docs, reviews, sessions)
 * must use the remote ID so all team members share the same namespace.
 * Falls back to local ID if no mapping exists (project not yet synced).
 */
async function resolveProjectId(syncEngine: SyncEngine, localProjectId: string): Promise<string> {
  const remoteId = await syncEngine.getRemoteProjectId(localProjectId)
  return remoteId ?? localProjectId
}

export function registerPremiumHandlers(
  authService: AuthService,
  teamService: TeamService,
  syncEngine: SyncEngine,
  presenceService: PresenceService
) {
  // Auth
  ipcMain.handle('premium:getStatus', () => authService.getStatus())
  ipcMain.handle('premium:signUp', async (_e, email: string, password: string, displayName: string) => {
    const result = await authService.signUp(email, password, displayName)
    const status = await authService.getStatus()
    return { ...status, confirmationRequired: result.confirmationRequired }
  })
  ipcMain.handle('premium:signIn', async (_e, email: string, password: string) => {
    await authService.signIn(email, password)
    return authService.getStatus()
  })
  ipcMain.handle('premium:signOut', () => authService.signOut())

  // Team management
  ipcMain.handle('premium:createTeam', (_e, name: string, slug: string) =>
    teamService.createTeam(name, slug))
  ipcMain.handle('premium:getTeam', () => authService.getStatus().then(s => s.team))
  ipcMain.handle('premium:listMembers', (_e, teamId: string) =>
    teamService.listMembers(teamId))
  ipcMain.handle('premium:inviteMember', (_e, teamId: string, email: string, role: 'admin' | 'member') =>
    teamService.inviteMember(teamId, email, role))
  ipcMain.handle('premium:removeMember', (_e, teamId: string, userId: string) =>
    teamService.removeMember(teamId, userId))
  ipcMain.handle('premium:acceptInvite', (_e, token: string) =>
    teamService.acceptInvite(token))
  ipcMain.handle('premium:getMyInvites', () =>
    teamService.getMyInvites())
  ipcMain.handle('premium:acceptInviteById', (_e, inviteId: string) =>
    teamService.acceptInviteById(inviteId))

  // Project sync
  ipcMain.handle('premium:syncProject', (_e, teamId: string, projectId: string, name: string, repoUrl?: string) => {
    return teamService.syncProject(teamId, projectId, name, repoUrl)
  })
  ipcMain.handle('premium:unsyncProject', (_e, projectId: string) => {
    return teamService.unsyncProject(projectId)
  })
  ipcMain.handle('premium:listSyncedProjects', (_e, teamId: string) => {
    return teamService.listSyncedProjects(teamId)
  })
  ipcMain.handle('premium:inviteToProject', (_e, teamId: string, projectId: string, projectName: string, repoUrl: string | null, memberUserIds: string[]) => {
    return teamService.inviteToProject(teamId, projectId, projectName, repoUrl, memberUserIds)
  })

  // Sync status
  ipcMain.handle('premium:getSyncStatus', () => {
    const states = syncEngine.getSyncStates()
    const dirtyCount = states.filter((s) => s.dirty).length
    const lastSynced = states
      .filter((s) => s.lastSyncedAt)
      .sort((a, b) => (b.lastSyncedAt! > a.lastSyncedAt! ? 1 : -1))
    return {
      lastSyncAt: lastSynced.length > 0 ? lastSynced[0].lastSyncedAt : null,
      dirtyCount,
      isSyncing: false, // SyncEngine doesn't expose isSyncing publicly; approximate
    }
  })

  // Billing
  ipcMain.handle('premium:createCheckout', async (_e, teamId: string | null, plan: string, extraSeats?: number) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Premium not configured')
    const body: Record<string, unknown> = { plan, extraSeats: extraSeats ?? 0 }
    if (teamId) body.teamId = teamId
    const { data, error } = await client.functions.invoke('create-checkout', { body })
    if (error) {
      // Extract the actual error message from the edge function response
      const context = (error as any).context
      if (context instanceof Response) {
        try {
          const detail = await context.json()
          throw new Error(detail?.error || `Checkout failed (${context.status})`)
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') throw parseErr
        }
      }
      throw ensureError(error)
    }
    return data
  })

  ipcMain.handle('premium:getBillingPortal', async (_e, teamId: string | null) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Premium not configured')
    const body: Record<string, unknown> = {}
    if (teamId) body.teamId = teamId
    const { data, error } = await client.functions.invoke('billing-portal', { body })
    if (error) {
      const context = (error as any).context
      if (context instanceof Response) {
        try {
          const detail = await context.json()
          throw new Error(detail?.error || `Billing portal failed (${context.status})`)
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') throw parseErr
        }
      }
      throw ensureError(error)
    }
    return data
  })

  // Notifications
  ipcMain.handle('premium:getNotifications', async (_e, limit?: number) => {
    const client = getSupabaseClient()
    if (!client) return []
    const { data: { user } } = await client.auth.getUser()
    if (!user) return []
    const { data } = await client
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit || 50)
    // Transform snake_case Supabase columns to camelCase for renderer
    return (data || []).map((n: Record<string, unknown>) => ({
      id: n.id,
      userId: n.user_id,
      projectId: n.project_id,
      type: n.type,
      title: n.title,
      body: n.body,
      entityType: n.entity_type,
      entityId: n.entity_id,
      isRead: n.is_read,
      createdAt: n.created_at,
    }))
  })

  ipcMain.handle('premium:markNotificationRead', async (_e, notificationId: string) => {
    const client = getSupabaseClient()
    if (!client) return
    await client.from('notifications').update({ is_read: true }).eq('id', notificationId)
  })

  ipcMain.handle('premium:markAllNotificationsRead', async () => {
    const client = getSupabaseClient()
    if (!client) return
    const { data: { user } } = await client.auth.getUser()
    if (!user) return
    await client.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
  })

  // Team messages
  ipcMain.handle(
    'premium:sendTeamMessage',
    async (_e, recipientUserId: string, message: string, projectId?: string) => {
      const client = getSupabaseClient()
      if (!client) throw ensureError('Supabase not configured')
      const { data: { user } } = await client.auth.getUser()
      if (!user) throw ensureError('Not authenticated')

      const { data: profile } = await client
        .from('users')
        .select('display_name')
        .eq('id', user.id)
        .single()
      const senderName = profile?.display_name || user.email || 'A team member'

      const remoteProjectId = projectId
        ? await resolveProjectId(syncEngine, projectId)
        : null

      const { error } = await client.from('notifications').insert({
        user_id: recipientUserId,
        project_id: remoteProjectId,
        type: 'message',
        title: `Alert from ${senderName}`,
        body: message,
        entity_type: 'user',
        entity_id: user.id,
        is_read: false,
      })
      if (error) throw ensureError(error)
    }
  )

  // Activity feed
  ipcMain.handle('premium:getActivityFeed', async (_e, projectId: string, limit?: number) => {
    const client = getSupabaseClient()
    if (!client) return []
    const remoteId = await resolveProjectId(syncEngine, projectId)
    const { data } = await client
      .from('activity_events')
      .select('*, user:users(id, email, display_name, avatar_url)')
      .eq('project_id', remoteId)
      .order('created_at', { ascending: false })
      .limit(limit || 50)
    return (data || []).map((d: any) => ({
      id: d.id,
      projectId: d.project_id,
      userId: d.user_id,
      eventType: d.event_type,
      entityType: d.entity_type,
      entityId: d.entity_id,
      metadata: d.metadata || {},
      createdAt: d.created_at,
      user: d.user ? {
        id: d.user.id,
        email: d.user.email,
        displayName: d.user.display_name,
        avatarUrl: d.user.avatar_url,
      } : undefined,
    }))
  })

  // Session Summaries
  ipcMain.handle('premium:listSessionSummaries', async (_e, projectId: string) => {
    const client = getSupabaseClient()
    if (!client) return []
    const remoteId = await resolveProjectId(syncEngine, projectId)
    const { data } = await client
      .from('session_summaries')
      .select('*, user:users(id, email, display_name, avatar_url)')
      .eq('project_id', remoteId)
      .order('shared_at', { ascending: false })
      .limit(50)
    return (data || []).map((d: any) => ({
      id: d.id,
      projectId: d.project_id,
      userId: d.user_id,
      sessionSlug: d.session_slug,
      model: d.model,
      gitBranch: d.git_branch,
      summary: d.summary,
      filesChanged: d.files_changed || [],
      durationMins: d.duration_mins,
      startedAt: d.started_at,
      endedAt: d.ended_at,
      sharedAt: d.shared_at,
      user: d.user ? {
        id: d.user.id,
        email: d.user.email,
        displayName: d.user.display_name,
        avatarUrl: d.user.avatar_url,
      } : undefined,
    }))
  })

  ipcMain.handle('premium:shareSessionSummary', async (_e, payload: {
    projectId: string
    sessionSlug?: string
    model?: string
    gitBranch?: string
    summary: string
    filesChanged?: string[]
    durationMins?: number
    startedAt?: string
    endedAt?: string
  }) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Premium not configured')
    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')
    const remoteId = await resolveProjectId(syncEngine, payload.projectId)
    const { data, error } = await client
      .from('session_summaries')
      .insert({
        project_id: remoteId,
        user_id: user.id,
        session_slug: payload.sessionSlug || null,
        model: payload.model || null,
        git_branch: payload.gitBranch || null,
        summary: payload.summary,
        files_changed: payload.filesChanged || [],
        duration_mins: payload.durationMins || null,
        started_at: payload.startedAt || null,
        ended_at: payload.endedAt || null,
      })
      .select('*, user:users(id, email, display_name, avatar_url)')
      .single()
    if (error) throw ensureError(error)
    return {
      id: data.id,
      projectId: data.project_id,
      userId: data.user_id,
      sessionSlug: data.session_slug,
      model: data.model,
      gitBranch: data.git_branch,
      summary: data.summary,
      filesChanged: data.files_changed || [],
      durationMins: data.duration_mins,
      startedAt: data.started_at,
      endedAt: data.ended_at,
      sharedAt: data.shared_at,
      user: data.user ? {
        id: (data.user as any).id,
        email: (data.user as any).email,
        displayName: (data.user as any).display_name,
        avatarUrl: (data.user as any).avatar_url,
      } : undefined,
    }
  })

  // Presence — resolve to remote project ID so all team members join the same channel
  ipcMain.handle('premium:joinPresence', async (_e, projectId: string) => {
    const client = getSupabaseClient()
    if (!client) return
    const { data: { user } } = await client.auth.getUser()
    if (!user) return
    const { data: profile } = await client.from('users').select('display_name, avatar_url').eq('id', user.id).single()
    const localName = getConfigValue('profileName')
    const localAvatar = getConfigValue('profileAvatarUrl')
    const remoteId = await resolveProjectId(syncEngine, projectId)
    await presenceService.joinProject(remoteId, {
      userId: user.id,
      displayName: localName || profile?.display_name || user.email || 'Unknown',
      avatarUrl: localAvatar || profile?.avatar_url || null,
      activeFile: null,
      gitBranch: null,
      onlineAt: new Date().toISOString(),
    })
  })

  ipcMain.handle('premium:leavePresence', async (_e, projectId: string) => {
    const remoteId = await resolveProjectId(syncEngine, projectId)
    await presenceService.leaveProject(remoteId)
  })

  ipcMain.handle('premium:getPresence', async (_e, projectId: string) => {
    const remoteId = await resolveProjectId(syncEngine, projectId)
    return presenceService.getPresence(remoteId)
  })

  // ─── Project Docs (Wiki) ────────────────────────────────────────────────────

  ipcMain.handle('premium:listProjectDocs', async (_e, projectId: string) => {
    const client = getSupabaseClient()
    if (!client) return []
    const remoteId = await resolveProjectId(syncEngine, projectId)
    const { data } = await client
      .from('project_docs')
      .select('*, created_by_user:users!project_docs_created_by_fkey(id, email, display_name, avatar_url), last_edited_by_user:users!project_docs_last_edited_by_fkey(id, email, display_name, avatar_url)')
      .eq('project_id', remoteId)
      .order('sort_order', { ascending: true })
    return (data || []).map((d: any) => ({
      id: d.id,
      projectId: d.project_id,
      title: d.title,
      content: d.content,
      sortOrder: d.sort_order,
      createdBy: d.created_by,
      lastEditedBy: d.last_edited_by,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      createdByUser: d.created_by_user ? {
        id: d.created_by_user.id,
        email: d.created_by_user.email,
        displayName: d.created_by_user.display_name,
        avatarUrl: d.created_by_user.avatar_url,
      } : undefined,
      lastEditedByUser: d.last_edited_by_user ? {
        id: d.last_edited_by_user.id,
        email: d.last_edited_by_user.email,
        displayName: d.last_edited_by_user.display_name,
        avatarUrl: d.last_edited_by_user.avatar_url,
      } : undefined,
    }))
  })

  ipcMain.handle('premium:getProjectDoc', async (_e, docId: string) => {
    const client = getSupabaseClient()
    if (!client) return null
    const { data } = await client
      .from('project_docs')
      .select('*, created_by_user:users!project_docs_created_by_fkey(id, email, display_name, avatar_url), last_edited_by_user:users!project_docs_last_edited_by_fkey(id, email, display_name, avatar_url)')
      .eq('id', docId)
      .single()
    if (!data) return null
    return {
      id: data.id,
      projectId: data.project_id,
      title: data.title,
      content: data.content,
      sortOrder: data.sort_order,
      createdBy: data.created_by,
      lastEditedBy: data.last_edited_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      createdByUser: data.created_by_user ? {
        id: (data.created_by_user as any).id,
        email: (data.created_by_user as any).email,
        displayName: (data.created_by_user as any).display_name,
        avatarUrl: (data.created_by_user as any).avatar_url,
      } : undefined,
      lastEditedByUser: data.last_edited_by_user ? {
        id: (data.last_edited_by_user as any).id,
        email: (data.last_edited_by_user as any).email,
        displayName: (data.last_edited_by_user as any).display_name,
        avatarUrl: (data.last_edited_by_user as any).avatar_url,
      } : undefined,
    }
  })

  ipcMain.handle('premium:createProjectDoc', async (_e, input: { projectId: string; title: string; content: string }) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Premium not configured')
    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const remoteId = await resolveProjectId(syncEngine, input.projectId)

    // Get max sort_order for this project
    const { data: existing } = await client
      .from('project_docs')
      .select('sort_order')
      .eq('project_id', remoteId)
      .order('sort_order', { ascending: false })
      .limit(1)
    const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

    const { data, error } = await client
      .from('project_docs')
      .insert({
        project_id: remoteId,
        title: input.title,
        content: input.content,
        sort_order: nextOrder,
        created_by: user.id,
      })
      .select()
      .single()
    if (error) throw ensureError(error)
    return {
      id: data.id,
      projectId: data.project_id,
      title: data.title,
      content: data.content,
      sortOrder: data.sort_order,
      createdBy: data.created_by,
      lastEditedBy: data.last_edited_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  })

  ipcMain.handle('premium:updateProjectDoc', async (_e, docId: string, updates: { title?: string; content?: string }) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Premium not configured')
    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const updatePayload: Record<string, unknown> = { last_edited_by: user.id }
    if (updates.title !== undefined) updatePayload.title = updates.title
    if (updates.content !== undefined) updatePayload.content = updates.content

    const { data, error } = await client
      .from('project_docs')
      .update(updatePayload)
      .eq('id', docId)
      .select()
      .single()
    if (error) throw ensureError(error)
    return {
      id: data.id,
      projectId: data.project_id,
      title: data.title,
      content: data.content,
      sortOrder: data.sort_order,
      createdBy: data.created_by,
      lastEditedBy: data.last_edited_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  })

  ipcMain.handle('premium:deleteProjectDoc', async (_e, docId: string) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Premium not configured')
    const { error } = await client.from('project_docs').delete().eq('id', docId)
    if (error) throw ensureError(error)
  })

  // ─── Review Requests ──────────────────────────────────────────────────────────

  ipcMain.handle('premium:requestReview', async (_e, data: {
    projectId: string
    taskId: string
    assignedTo: string
    comment?: string
  }) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Premium not configured')
    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const remoteId = await resolveProjectId(syncEngine, data.projectId)

    const { data: review, error } = await client
      .from('review_requests')
      .insert({
        project_id: remoteId,
        task_id: data.taskId,
        requested_by: user.id,
        assigned_to: data.assignedTo,
        status: 'pending',
        comment: data.comment || null,
      })
      .select('*')
      .single()
    if (error) throw ensureError(error)

    // Create a notification for the assigned reviewer
    const { data: profile } = await client.from('users').select('display_name').eq('id', user.id).single()
    await client.from('notifications').insert({
      user_id: data.assignedTo,
      project_id: remoteId,
      type: 'review_request',
      title: 'Review requested',
      body: `${profile?.display_name || user.email || 'A team member'} requested your review`,
      entity_type: 'review_request',
      entity_id: review.id,
    })

    return review
  })

  ipcMain.handle('premium:resolveReview', async (_e, reviewId: string, status: 'approved' | 'changes_requested' | 'dismissed') => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Premium not configured')
    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data: review, error } = await client
      .from('review_requests')
      .update({
        status,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', reviewId)
      .select('*')
      .single()
    if (error) throw ensureError(error)

    // Notify the requester that the review was resolved
    const { data: profile } = await client.from('users').select('display_name').eq('id', user.id).single()
    const statusLabel = status === 'approved' ? 'approved' : status === 'changes_requested' ? 'requested changes on' : 'dismissed'
    await client.from('notifications').insert({
      user_id: review.requested_by,
      project_id: review.project_id,
      type: 'review_resolved',
      title: `Review ${statusLabel}`,
      body: `${profile?.display_name || user.email || 'A team member'} ${statusLabel} your review request`,
      entity_type: 'review_request',
      entity_id: review.id,
    })

    return review
  })

  ipcMain.handle('premium:listReviewRequests', async (_e, projectId: string) => {
    const client = getSupabaseClient()
    if (!client) return []
    const remoteId = await resolveProjectId(syncEngine, projectId)
    const { data } = await client
      .from('review_requests')
      .select('*, requestedByUser:users!review_requests_requested_by_fkey(id, email, display_name, avatar_url), assignedToUser:users!review_requests_assigned_to_fkey(id, email, display_name, avatar_url)')
      .eq('project_id', remoteId)
      .order('created_at', { ascending: false })
    return data || []
  })

  // ─── Super Admin ─────────────────────────────────────────────────────────────

  ipcMain.handle('premium:admin:isSuperAdmin', async () => {
    const client = getSupabaseClient()
    if (!client) return false
    const { data: { user } } = await client.auth.getUser()
    if (!user) return false
    const { data } = await client.from('super_admins').select('user_id').eq('user_id', user.id).single()
    return !!data
  })

  ipcMain.handle('premium:admin:searchUsers', async (_e, email: string) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Not configured')
    const { data } = await client.from('users').select('id, email, display_name').ilike('email', `%${email}%`).limit(10)
    return data || []
  })

  ipcMain.handle('premium:admin:listGrants', async () => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Not configured')
    const { data } = await client.from('team_grants').select('*').order('created_at', { ascending: false })
    return data || []
  })

  ipcMain.handle('premium:admin:grantTeam', async (_e, grant: {
    teamId: string
    grantType: string
    planTier: string
    seatLimit?: number
    projectLimit?: number
    repoUrl?: string
    note?: string
    expiresAt?: string
  }) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Not configured')
    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')
    const { data, error } = await client.from('team_grants').insert({
      team_id: grant.teamId,
      grant_type: grant.grantType,
      plan_tier: grant.planTier,
      seat_limit: grant.seatLimit || null,
      project_limit: grant.projectLimit || null,
      repo_url: grant.repoUrl || null,
      note: grant.note || null,
      expires_at: grant.expiresAt || null,
      granted_by: user.id,
    }).select().single()
    if (error) throw ensureError(error)
    return data
  })

  ipcMain.handle('premium:admin:revokeGrant', async (_e, grantId: string) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Not configured')
    const { error } = await client.from('team_grants').delete().eq('id', grantId)
    if (error) throw ensureError(error)
  })
}

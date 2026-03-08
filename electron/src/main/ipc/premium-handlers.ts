import { ipcMain } from 'electron'
import type { AuthService } from '../services/premium/AuthService'
import type { TeamService } from '../services/premium/TeamService'
import type { SyncEngine } from '../services/premium/SyncEngine'
import type { PresenceService } from '../services/premium/PresenceService'
import { getSupabaseClient } from '../services/premium/SupabaseClient'

/** Ensure thrown values are proper Error instances so Electron IPC serializes the message */
function ensureError(err: unknown): Error {
  if (err instanceof Error) return err
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return new Error(String((err as any).message))
  }
  return new Error(String(err))
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

  // Billing
  ipcMain.handle('premium:createCheckout', async (_e, teamId: string | null, plan: string, extraSeats?: number) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Premium not configured')
    const body: Record<string, unknown> = { plan, extraSeats: extraSeats || 0 }
    if (teamId) body.teamId = teamId
    const { data, error } = await client.functions.invoke('create-checkout', { body })
    if (error) throw ensureError(error)
    return data
  })

  ipcMain.handle('premium:getBillingPortal', async (_e, teamId: string) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Premium not configured')
    const { data, error } = await client.functions.invoke('billing-portal', {
      body: { teamId }
    })
    if (error) throw ensureError(error)
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
    return data || []
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

  // Activity feed
  ipcMain.handle('premium:getActivityFeed', async (_e, projectId: string, limit?: number) => {
    const client = getSupabaseClient()
    if (!client) return []
    const { data } = await client
      .from('activity_events')
      .select('*, user:users(id, email, display_name, avatar_url)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit || 50)
    return data || []
  })

  // Session Summaries
  ipcMain.handle('premium:listSessionSummaries', async (_e, projectId: string) => {
    const client = getSupabaseClient()
    if (!client) return []
    const { data } = await client
      .from('session_summaries')
      .select('*, user:users(id, email, display_name, avatar_url)')
      .eq('project_id', projectId)
      .order('shared_at', { ascending: false })
      .limit(50)
    return data || []
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
    const { data, error } = await client
      .from('session_summaries')
      .insert({
        project_id: payload.projectId,
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
    return data
  })

  // Presence
  ipcMain.handle('premium:joinPresence', async (_e, projectId: string) => {
    const client = getSupabaseClient()
    if (!client) return
    const { data: { user } } = await client.auth.getUser()
    if (!user) return
    const { data: profile } = await client.from('users').select('display_name').eq('id', user.id).single()
    await presenceService.joinProject(projectId, {
      userId: user.id,
      displayName: profile?.display_name || user.email || 'Unknown',
      activeFile: null,
      gitBranch: null,
      onlineAt: new Date().toISOString(),
    })
  })

  ipcMain.handle('premium:leavePresence', async (_e, projectId: string) => {
    await presenceService.leaveProject(projectId)
  })

  ipcMain.handle('premium:getPresence', (_e, projectId: string) => {
    return presenceService.getPresence(projectId)
  })

  // ─── Project Docs (Wiki) ────────────────────────────────────────────────────

  ipcMain.handle('premium:listProjectDocs', async (_e, projectId: string) => {
    const client = getSupabaseClient()
    if (!client) return []
    const { data } = await client
      .from('project_docs')
      .select('*, created_by_user:users!project_docs_created_by_fkey(id, email, display_name, avatar_url), last_edited_by_user:users!project_docs_last_edited_by_fkey(id, email, display_name, avatar_url)')
      .eq('project_id', projectId)
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

    // Get max sort_order for this project
    const { data: existing } = await client
      .from('project_docs')
      .select('sort_order')
      .eq('project_id', input.projectId)
      .order('sort_order', { ascending: false })
      .limit(1)
    const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

    const { data, error } = await client
      .from('project_docs')
      .insert({
        project_id: input.projectId,
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

    const { data: review, error } = await client
      .from('review_requests')
      .insert({
        project_id: data.projectId,
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
      project_id: data.projectId,
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
    const { data } = await client
      .from('review_requests')
      .select('*, requestedByUser:users!review_requests_requested_by_fkey(id, email, display_name, avatar_url), assignedToUser:users!review_requests_assigned_to_fkey(id, email, display_name, avatar_url)')
      .eq('project_id', projectId)
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

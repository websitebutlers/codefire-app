import { getSupabaseClient } from './SupabaseClient'
import type { Team, TeamMember, TeamInvite } from '@shared/premium-models'

export class TeamService {
  async createTeam(name: string, slug: string): Promise<Team> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Check if user has a pre-team subscription to transfer
    const { data: profile } = await client.from('users')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('id', user.id)
      .single()

    const { data, error } = await client.from('teams').insert({
      name,
      slug,
      owner_id: user.id,
      // Transfer user's Stripe IDs to the new team
      stripe_customer_id: profile?.stripe_customer_id || null,
      stripe_subscription_id: profile?.stripe_subscription_id || null,
    }).select().single()

    if (error) throw new Error(error.message)

    await client.from('team_members').insert({
      team_id: data.id,
      user_id: user.id,
      role: 'owner',
    })

    // Clear user-level subscription IDs (now owned by team)
    if (profile?.stripe_subscription_id) {
      await client.from('users').update({
        stripe_customer_id: null,
        stripe_subscription_id: null,
      }).eq('id', user.id)
    }

    return {
      id: data.id,
      name: data.name,
      slug: data.slug,
      ownerId: data.owner_id,
      plan: data.plan,
      seatLimit: data.seat_limit,
      projectLimit: data.project_limit,
      createdAt: data.created_at,
    }
  }

  async listMembers(teamId: string): Promise<TeamMember[]> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data, error } = await client.from('team_members')
      .select('*, users(*)')
      .eq('team_id', teamId)

    if (error) throw new Error(error.message)

    return (data || []).map((m: any) => ({
      teamId: m.team_id,
      userId: m.user_id,
      role: m.role,
      joinedAt: m.joined_at,
      user: m.users ? {
        id: m.users.id,
        email: m.users.email,
        displayName: m.users.display_name,
        avatarUrl: m.users.avatar_url,
      } : undefined,
    }))
  }

  async inviteMember(teamId: string, email: string, role: 'admin' | 'member'): Promise<TeamInvite> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await client.from('team_invites').insert({
      team_id: teamId,
      email,
      role,
      invited_by: user.id,
    }).select().single()

    if (error) throw new Error(error.message)

    return {
      id: data.id,
      teamId: data.team_id,
      email: data.email,
      role: data.role,
      status: data.status,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
    }
  }

  async acceptInvite(token: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data: invite, error } = await client.from('team_invites')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

    if (error || !invite) throw new Error('Invalid or expired invite')

    await client.from('team_members').insert({
      team_id: invite.team_id,
      user_id: user.id,
      role: invite.role,
    })

    await client.from('team_invites').update({ status: 'accepted' }).eq('id', invite.id)
  }

  async getMyInvites(): Promise<(TeamInvite & { teamName: string })[]> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await client.from('team_invites')
      .select('*, teams(name)')
      .eq('email', user.email)
      .eq('status', 'pending')

    if (error) throw new Error(error.message)

    return (data || []).map((inv: any) => ({
      id: inv.id,
      teamId: inv.team_id,
      email: inv.email,
      role: inv.role,
      status: inv.status,
      createdAt: inv.created_at,
      expiresAt: inv.expires_at,
      teamName: inv.teams?.name || 'Unknown Team',
    }))
  }

  async acceptInviteById(inviteId: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data: invite, error } = await client.from('team_invites')
      .select('*')
      .eq('id', inviteId)
      .eq('status', 'pending')
      .single()

    if (error || !invite) throw new Error('Invalid or expired invite')

    await client.from('team_members').insert({
      team_id: invite.team_id,
      user_id: user.id,
      role: invite.role,
    })

    await client.from('team_invites').update({ status: 'accepted' }).eq('id', invite.id)
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { error } = await client.from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', userId)

    if (error) throw new Error(error.message)
  }

  async syncProject(teamId: string, projectId: string, name: string, repoUrl?: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    await client.from('synced_projects').upsert({
      id: projectId,
      team_id: teamId,
      name,
      repo_url: repoUrl || null,
      created_by: user.id,
    })

    await client.from('project_members').upsert({
      project_id: projectId,
      user_id: user.id,
      role: 'lead',
    })
  }

  async unsyncProject(projectId: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    await client.from('synced_projects').delete().eq('id', projectId)
  }

  async listSyncedProjects(teamId: string): Promise<{ id: string; name: string; repoUrl: string | null; createdBy: string }[]> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data, error } = await client.from('synced_projects')
      .select('id, name, repo_url, created_by')
      .eq('team_id', teamId)

    if (error) throw new Error(error.message)

    return (data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      repoUrl: p.repo_url,
      createdBy: p.created_by,
    }))
  }

  async inviteToProject(
    teamId: string,
    projectId: string,
    projectName: string,
    repoUrl: string | null,
    memberUserIds: string[]
  ): Promise<void> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Ensure the project is registered as a synced project
    await client.from('synced_projects').upsert({
      id: projectId,
      team_id: teamId,
      name: projectName,
      repo_url: repoUrl,
      created_by: user.id,
    })

    // Add the sender as project lead
    await client.from('project_members').upsert({
      project_id: projectId,
      user_id: user.id,
      role: 'lead',
    })

    // Get sender display name for the notification
    const { data: profile } = await client.from('users')
      .select('display_name')
      .eq('id', user.id)
      .single()
    const senderName = profile?.display_name || user.email || 'A team member'

    // Send a notification to each invited member
    const notifications = memberUserIds
      .filter((uid) => uid !== user.id)
      .map((uid) => ({
        user_id: uid,
        project_id: projectId,
        type: 'project_invite' as const,
        title: `Project invite: ${projectName}`,
        body: `${senderName} invited you to collaborate on "${projectName}"`,
        entity_type: 'project',
        entity_id: projectId,
        is_read: false,
      }))

    if (notifications.length > 0) {
      await client.from('notifications').insert(notifications)
    }
  }
}

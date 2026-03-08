import { getSupabaseClient, resetSupabaseClient } from './SupabaseClient'
import type { PremiumUser, PremiumStatus } from '@shared/premium-models'

export class AuthService {
  async signUp(email: string, password: string, displayName: string): Promise<PremiumUser & { confirmationRequired?: boolean }> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: 'codefire://auth/callback',
      },
    })
    if (error) throw new Error(error.message)
    if (!data.user) throw new Error('Sign up failed')

    // Supabase returns a user with no session when email confirmation is required
    const confirmationRequired = !data.session

    return {
      id: data.user.id,
      email: data.user.email!,
      displayName,
      avatarUrl: null,
      confirmationRequired,
    }
  }

  async signIn(email: string, password: string): Promise<PremiumUser> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)

    const { data: profile } = await client.from('users').select('*').eq('id', data.user.id).single()

    return {
      id: data.user.id,
      email: data.user.email!,
      displayName: profile?.display_name || email.split('@')[0],
      avatarUrl: profile?.avatar_url || null,
    }
  }

  async signOut(): Promise<void> {
    const client = getSupabaseClient()
    if (client) {
      await client.auth.signOut()
    }
    resetSupabaseClient()
  }

  async getStatus(): Promise<PremiumStatus> {
    const client = getSupabaseClient()
    if (!client) {
      return { enabled: false, authenticated: false, user: null, team: null, grant: null, subscriptionActive: false, syncEnabled: false }
    }

    const { data: { user } } = await client.auth.getUser()
    if (!user) {
      return { enabled: true, authenticated: false, user: null, team: null, grant: null, subscriptionActive: false, syncEnabled: false }
    }

    const { data: profile } = await client.from('users').select('*').eq('id', user.id).single()

    const { data: membership } = await client.from('team_members')
      .select('team_id, role, teams(*)')
      .eq('user_id', user.id)
      .limit(1)
      .single()

    const team = membership?.teams as unknown as {
      id: string; name: string; slug: string; owner_id: string;
      plan: string; seat_limit: number; project_limit: number | null;
      stripe_subscription_id: string | null; created_at: string;
    } | null

    let grant = null
    if (team) {
      const { data: grantData } = await client.from('team_grants')
        .select('*')
        .eq('team_id', team.id)
        .or('expires_at.is.null,expires_at.gt.now()')
        .limit(1)
        .single()
      if (grantData) {
        grant = {
          id: grantData.id,
          teamId: grantData.team_id,
          grantType: grantData.grant_type,
          planTier: grantData.plan_tier,
          seatLimit: grantData.seat_limit,
          projectLimit: grantData.project_limit,
          repoUrl: grantData.repo_url,
          note: grantData.note,
          expiresAt: grantData.expires_at,
          createdAt: grantData.created_at,
        }
      }
    }

    // Subscription is active if on a team (teams require payment), has a stripe sub, or there's a grant
    const subscriptionActive = !!team
      || !!grant
      || !!(profile?.stripe_subscription_id)

    return {
      enabled: true,
      authenticated: true,
      user: {
        id: user.id,
        email: user.email!,
        displayName: profile?.display_name || user.email!.split('@')[0],
        avatarUrl: profile?.avatar_url || null,
      },
      team: team ? {
        id: team.id,
        name: team.name,
        slug: team.slug,
        ownerId: team.owner_id,
        plan: team.plan as 'starter' | 'agency',
        seatLimit: team.seat_limit,
        projectLimit: team.project_limit,
        createdAt: team.created_at,
      } : null,
      grant,
      subscriptionActive,
      syncEnabled: subscriptionActive,
    }
  }
}

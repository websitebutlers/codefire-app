import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PRICE_MAP = {
  starter: {
    base: 'price_1T854NIxSwQrUVKo0idZwVYv',
    extraSeat: 'price_1T854NIxSwQrUVKogKg4kRqy',
  },
  agency: {
    base: 'price_1T854WIxSwQrUVKoaZysVbvR',
    extraSeat: 'price_1T854XIxSwQrUVKo9ot5Ruls',
  },
} as const

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Authenticate user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Parse request body
    const { teamId, plan, extraSeats = 0 } = await req.json()

    if (!plan || !['starter', 'agency'].includes(plan)) {
      return new Response(JSON.stringify({ error: `Invalid plan: "${plan}". Must be "starter" or "agency".` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (typeof extraSeats !== 'number' || extraSeats < 0) {
      return new Response(JSON.stringify({ error: `extraSeats must be a non-negative number, got: ${typeof extraSeats} (${extraSeats})` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let customerId: string | null = null
    const metadata: Record<string, string> = { plan, userId: user.id }

    if (teamId) {
      // ── Team-level checkout (existing team) ─────────────────────────
      const { data: team, error: teamError } = await supabaseAdmin
        .from('teams')
        .select('id, name, owner_id, stripe_customer_id')
        .eq('id', teamId)
        .single()

      if (teamError || !team) {
        return new Response(JSON.stringify({ error: 'Team not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (team.owner_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Only the team owner can manage billing' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      customerId = team.stripe_customer_id

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { teamId, supabaseUserId: user.id },
          name: team.name,
        })
        customerId = customer.id

        await supabaseAdmin
          .from('teams')
          .update({ stripe_customer_id: customerId })
          .eq('id', teamId)
      }

      metadata.teamId = teamId
    } else {
      // ── User-level checkout (pre-team subscription) ─────────────────
      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('stripe_customer_id, display_name')
        .eq('id', user.id)
        .single()

      customerId = profile?.stripe_customer_id ?? null

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { supabaseUserId: user.id },
          name: profile?.display_name || user.email,
        })
        customerId = customer.id

        await supabaseAdmin
          .from('users')
          .update({ stripe_customer_id: customerId })
          .eq('id', user.id)
      }
    }

    // Build line items
    const prices = PRICE_MAP[plan as keyof typeof PRICE_MAP]
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      { price: prices.base, quantity: 1 },
    ]

    if (extraSeats > 0) {
      lineItems.push({ price: prices.extraSeat, quantity: extraSeats })
    }

    // Create Checkout session
    const appUrl = Deno.env.get('APP_URL') || 'codefire://billing'

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: lineItems,
      success_url: `${appUrl}?success=true${teamId ? `&team=${teamId}` : ''}`,
      cancel_url: `${appUrl}?canceled=true`,
      subscription_data: {
        metadata,
      },
      metadata,
    })

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('create-checkout error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// FEAT-PLUGGY-CONNECT-TOKEN-ROUTE-v1
// Rota protegida que cunha o accessToken (connect token) da Pluggy ·
// usa fn_pluggy_get_credentials (RPC service_role) pra ler client_id/secret
// e troca por accessToken de curta duracao pro Pluggy Connect Widget.
// Server-side · credenciais nunca tocam o front.

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PluggyCredentials {
  client_id?: string
  client_secret?: string
  error?: string
}

export const POST = withAuth(async () => {
  const { data: creds, error } = await supabaseAdmin.rpc('fn_pluggy_get_credentials')
  const c = (creds ?? {}) as PluggyCredentials
  if (error || c.error || !c.client_id || !c.client_secret) {
    return NextResponse.json({ error: 'credentials_missing' }, { status: 500 })
  }

  const auth = await fetch('https://api.pluggy.ai/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: c.client_id, clientSecret: c.client_secret }),
  })
  const authJson = (await auth.json()) as { apiKey?: string }
  if (!authJson?.apiKey) {
    return NextResponse.json({ error: 'auth_failed' }, { status: 502 })
  }

  const ct = await fetch('https://api.pluggy.ai/connect_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': authJson.apiKey },
    body: JSON.stringify({}),
  })
  const ctJson = (await ct.json()) as { accessToken?: string }
  if (!ctJson?.accessToken) {
    return NextResponse.json({ error: 'connect_token_failed' }, { status: 502 })
  }

  return NextResponse.json({ connectToken: ctJson.accessToken })
})

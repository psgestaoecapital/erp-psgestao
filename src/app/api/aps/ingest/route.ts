// POST /api/aps/ingest — dispara/retomada do processamento APS de uma planta DWG.
// Body: { planta_id, forcar?: boolean }
// Auth: sessao (Bearer OU cookie via @supabase/ssr). Valida company via get_user_company_ids().
// Delega a edge function 'aps-ingest' com service role.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// APS translate + poll pode ir ate ~140s no edge — deixamos 300s aqui.
export const maxDuration = 300

function userSupabaseBearer(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
}
async function userSupabaseCookies() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const store = await cookies()
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
      setAll: () => { /* read-only */ },
    },
  })
}
type AuthedClient = ReturnType<typeof userSupabaseBearer>
async function resolverSessao(req: NextRequest): Promise<{ sb: AuthedClient | null; userId: string | null }> {
  const auth = req.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    const sb = userSupabaseBearer(req)
    const { data: { user } } = await sb.auth.getUser()
    if (user) return { sb, userId: user.id }
  }
  try {
    const sb = (await userSupabaseCookies()) as unknown as AuthedClient
    const { data: { user } } = await sb.auth.getUser()
    if (user) return { sb, userId: user.id }
  } catch { /* sem cookie */ }
  return { sb: null, userId: null }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const plantaId: string | undefined = body?.planta_id
    const forcar = !!body?.forcar
    if (!plantaId) return NextResponse.json({ ok: false, erro: 'planta_id obrigatorio' }, { status: 400 })

    const { sb, userId } = await resolverSessao(req)
    if (!sb || !userId) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    const { data: perm, error: permErr } = await sb.rpc('get_user_company_ids')
    if (permErr) return NextResponse.json({ ok: false, erro: permErr.message }, { status: 500 })
    const permitidas = (Array.isArray(perm) ? (perm as string[]) : []).filter(Boolean)

    // Confere que a planta pertence a uma company acessivel.
    const { data: planta } = await supabaseAdmin
      .from('erp_obra_planta')
      .select('id, company_id')
      .eq('id', plantaId)
      .maybeSingle()
    if (!planta) return NextResponse.json({ ok: false, erro: 'planta_nao_encontrada' }, { status: 404 })
    if (!permitidas.includes(planta.company_id)) {
      return NextResponse.json({ ok: false, erro: 'sem acesso a esta empresa' }, { status: 403 })
    }

    // Delega ao edge (service role) — o edge faz todo o trabalho pesado.
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/aps-ingest`
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ planta_id: plantaId, user_id: userId, forcar }),
    })
    const j = await r.json().catch(() => ({}))
    return NextResponse.json(j, { status: r.status })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

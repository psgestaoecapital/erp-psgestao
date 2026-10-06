// GET /api/saude — monitor de queda (CEO 05/10). Uma consulta leve ao banco (RPC fn_saude_ping, só service_role no servidor) com timeout de 5 s.
// 200 {"ok":true,"db_ms":N} ou 503 {"ok":false}. Sem dado sensível, sem segredo, sem cache.

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const t0 = Date.now()
  try {
    if (!url || !key) throw new Error('config')
    const r = await fetch(`${url}/rest/v1/rpc/fn_saude_ping`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) throw new Error('db')
    return NextResponse.json({ ok: true, db_ms: Date.now() - t0 }, { headers: HEADERS })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })
  }
}

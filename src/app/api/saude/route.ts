import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

// Monitor de queda: 1 consulta leve ao banco (HEAD, limit 0) com timeout de 5 s.
// Qualquer resposta < 500 prova que API + Postgres responderam (anon sem permissão dá 401/403 depois de tocar o banco).
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })

  const t0 = Date.now()
  try {
    const r = await fetch(`${url}/rest/v1/erp_handoff_sessao?select=id&limit=0`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (r.status >= 500) return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })
    return NextResponse.json({ ok: true, db_ms: Date.now() - t0 }, { headers: HEADERS })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })
  }
}

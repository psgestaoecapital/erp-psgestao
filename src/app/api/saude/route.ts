// GET /api/saude · monitor de queda (CEO 05/10). Rota pública, sem dado de cliente e sem segredo na resposta.
// Faz 1 consulta leve ao banco (HEAD de 1 linha em `companies` com a chave anon: a RLS devolve vazio, mas a
// requisição atravessa API + Postgres) com timeout de 5 s. 200 {ok,db_ms} · 503 {ok:false}. Cache desligado.

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 5000
const HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })

  const t0 = Date.now()
  try {
    const r = await fetch(`${url}/rest/v1/companies?select=id&limit=1`, {
      method: 'HEAD',
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })
    return NextResponse.json({ ok: true, db_ms: Date.now() - t0 }, { headers: HEADERS })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })
  }
}

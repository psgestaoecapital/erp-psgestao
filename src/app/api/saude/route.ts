// GET /api/saude — sonda de disponibilidade para monitor externo (CEO 05/10, queda do banco 18:07–18:28).
// Pública, sem dado sensível: 1 consulta leve ao banco (HEAD, limit 1, com a chave anon — a RLS devolve vazio, o que
// basta para provar que a API e o Postgres respondem) com timeout de 5 s. Cache desligado.
// 200 {"ok":true,"db_ms":N} | 503 {"ok":false}

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' }
const TIMEOUT_MS = 5000

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

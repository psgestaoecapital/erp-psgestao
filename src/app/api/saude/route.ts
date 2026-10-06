// /api/saude — verificação de queda para monitor externo (CEO 05/10). Pública, sem dado de cliente, sem segredo
// na resposta, sem cache. Faz 1 pedido leve ao PostgREST (HEAD, limit 1) com timeout de 5 s: qualquer resposta
// < 500 prova que a API e o banco responderam; 5xx, timeout ou falha de rede = 503.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TIMEOUT_MS = 5000
const SEM_CACHE = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.json({ ok: false }, { status: 503, headers: SEM_CACHE })
  const t0 = Date.now()
  try {
    const r = await fetch(`${url}/rest/v1/companies?select=id&limit=1`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (r.status >= 500) return NextResponse.json({ ok: false }, { status: 503, headers: SEM_CACHE })
    return NextResponse.json({ ok: true, db_ms: Date.now() - t0 }, { status: 200, headers: SEM_CACHE })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: SEM_CACHE })
  }
}

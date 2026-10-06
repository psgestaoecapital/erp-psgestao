import { NextResponse } from 'next/server'

// Saúde pública para monitor externo de queda (CEO 05/10). 1 consulta leve ao banco (PostgREST com a chave anon,
// sob RLS: devolve no máximo 1 id e NADA dele vai para a resposta), timeout de 5 s. Sem dado de cliente, sem segredo,
// sem cache. 200 {ok:true, db_ms} ou 503 {ok:false}.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })

  const t0 = Date.now()
  try {
    const r = await fetch(`${url}/rest/v1/companies?select=id&limit=1`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    // 5xx = banco/API fora. 2xx/4xx (ex.: RLS/permissão) = o banco respondeu.
    if (r.status >= 500) return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })
    return NextResponse.json({ ok: true, db_ms: Date.now() - t0 }, { status: 200, headers: HEADERS })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })
  }
}

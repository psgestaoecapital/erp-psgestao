// GET /api/saude — monitor de queda (CEO 05/10). Rota pública, sem dado de cliente e sem segredo na resposta:
// 1 consulta leve ao banco (PostgREST com a chave anon, limit 1) com timeout de 5 s.
// 200 {ok:true, db_ms} | 503 {ok:false}. Cache desligado.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const HEADERS = { 'Cache-Control': 'no-store, max-age=0', 'Content-Type': 'application/json' }

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return new Response(JSON.stringify({ ok: false }), { status: 503, headers: HEADERS })

  const t0 = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 5000)
  try {
    const r = await fetch(`${url}/rest/v1/companies?select=id&limit=1`, {
      method: 'GET',
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      cache: 'no-store',
      signal: ctl.signal,
    })
    // 2xx = banco respondeu (RLS pode devolver lista vazia para anon; isso é saudável).
    if (!r.ok) return new Response(JSON.stringify({ ok: false }), { status: 503, headers: HEADERS })
    return new Response(JSON.stringify({ ok: true, db_ms: Date.now() - t0 }), { status: 200, headers: HEADERS })
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers: HEADERS })
  } finally {
    clearTimeout(timer)
  }
}

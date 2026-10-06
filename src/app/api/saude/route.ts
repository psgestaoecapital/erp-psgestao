// GET /api/saude — sonda de queda para monitor externo (CEO 05/10). Pública, sem dado de cliente.
// Faz 1 consulta leve ao banco (PostgREST, chave anon, limit=1: a RLS devolve vazio para anônimo, mas o banco é
// de fato consultado) com timeout de 5 s. 200 {ok:true, db_ms} · 503 {ok:false}. Nada de segredo/detalhe na resposta.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const TIMEOUT_MS = 5000
const HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return Response.json({ ok: false }, { status: 503, headers: HEADERS })

  const t0 = Date.now()
  try {
    const r = await fetch(`${url}/rest/v1/companies?select=id&limit=1`, {
      method: 'GET',
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) return Response.json({ ok: false }, { status: 503, headers: HEADERS })
    return Response.json({ ok: true, db_ms: Date.now() - t0 }, { status: 200, headers: HEADERS })
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: HEADERS })
  }
}

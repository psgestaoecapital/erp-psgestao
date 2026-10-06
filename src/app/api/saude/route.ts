import { NextResponse } from 'next/server'

// Monitor de queda (CEO 05/10): rota pública, sem dado de cliente e sem segredo na resposta.
// 1 pedido leve ao PostgREST (HEAD numa tabela pequena, chave anon) com timeout de 5 s. Qualquer resposta
// < 500 prova que o banco respondeu (401/403 por RLS também); 5xx, erro de rede ou timeout = 503.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const CABECALHOS = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !chave) return NextResponse.json({ ok: false }, { status: 503, headers: CABECALHOS })

  const t0 = Date.now()
  try {
    const r = await fetch(`${url}/rest/v1/companies?select=id&limit=1`, {
      method: 'HEAD',
      headers: { apikey: chave, Authorization: `Bearer ${chave}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (r.status >= 500) return NextResponse.json({ ok: false }, { status: 503, headers: CABECALHOS })
    return NextResponse.json({ ok: true, db_ms: Date.now() - t0 }, { status: 200, headers: CABECALHOS })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: CABECALHOS })
  }
}

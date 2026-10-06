import { NextResponse } from 'next/server'

// Monitor de queda (CEO 05/10): rota pública, sem dado de cliente. 1 consulta leve ao banco com timeout de 5 s.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://horsymhsinqcimflrtjo.supabase.co'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  const t0 = Date.now()
  try {
    // HEAD numa tabela pequena; com a anon a RLS devolve zero linhas, mas o banco respondeu.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/companies?select=id&limit=1`, {
      method: 'HEAD',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })
    return NextResponse.json({ ok: true, db_ms: Date.now() - t0 }, { headers: HEADERS })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS })
  }
}

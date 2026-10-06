import { NextResponse } from 'next/server'
import { avaliarSaude, TIMEOUT_SAUDE_MS } from '@/lib/saude'

// Rota pública (monitor de queda). 1 HEAD leve no PostgREST com a chave anon, timeout de 5 s, sem cache.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const t0 = Date.now()
  let status: number | null = null
  try {
    if (url && anon) {
      const r = await fetch(`${url}/rest/v1/companies?select=id&limit=1`, {
        method: 'HEAD', headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_SAUDE_MS),
      })
      status = r.status
    }
  } catch { status = null }
  const res = avaliarSaude(status, Date.now() - t0)
  return NextResponse.json(res.corpo, { status: res.status, headers: { 'Cache-Control': 'no-store' } })
}

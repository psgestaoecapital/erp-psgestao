// src/app/api/saude/route.ts
//
// Monitor de queda (CEO 05/10): rota PÚBLICA, só leitura, sem dado de cliente nem segredo na resposta.
// 1 consulta leve ao banco (head, sem linhas) com timeout de 5 s.
//   200 {"ok":true,"db_ms":N}  ·  503 {"ok":false}

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SEM_CACHE = { 'Cache-Control': 'no-store, max-age=0' }
const TIMEOUT_MS = 5000

export async function GET() {
  const t0 = Date.now()
  try {
    const { error } = await supabaseAdmin
      .from('dominio_bi')
      .select('id', { head: true, count: 'planned' })
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
    if (error) throw error
    return NextResponse.json({ ok: true, db_ms: Date.now() - t0 }, { headers: SEM_CACHE })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: SEM_CACHE })
  }
}

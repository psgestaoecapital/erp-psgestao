// PS Gestão ERP — Compliance · Treinamentos NR
// GET /api/compliance/nr-certificado/:presencaId — signed URL (1h) do certificado

import { NextRequest, NextResponse } from 'next/server'
import { exigirLogin, exigirEmpresas } from '@/lib/auth/guardaApi'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'compliance'
const SIGNED_TTL_SECONDS = 3600

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type Ctx = { params: Promise<{ presencaId: string }> }

export const GET = exigirLogin(async (_req: NextRequest, u, ctx?: unknown) => {
  const { presencaId } = await (ctx as Ctx).params
  const sb = admin()
  const { data: pres, error } = await sb.from('nr_turma_presenca').select('certificado_url, company_id').eq('id', presencaId).maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!pres) return NextResponse.json({ ok: false, error: 'sem certificado' }, { status: 404 })
  // Empresa REAL da presença.
  const negado = await exigirEmpresas(u, [(pres as { company_id?: string }).company_id])
  if (negado) return negado
  if (!(pres as { certificado_url?: string | null }).certificado_url) {
    return NextResponse.json({ ok: false, error: 'sem certificado' }, { status: 404 })
  }
  const path = (pres as { certificado_url: string }).certificado_url
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL_SECONDS)
  return NextResponse.json({ ok: true, signed_url: signed?.signedUrl ?? null })
}) as unknown as (req: NextRequest, ctx: Ctx) => Promise<NextResponse>

// PS Gestão ERP — Compliance · Treinamentos NR
// GET /api/compliance/nr-certificado/:presencaId — signed URL (1h) do certificado

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'compliance'
const SIGNED_TTL_SECONDS = 3600

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type Ctx = { params: Promise<{ presencaId: string }> }

export const GET = withAuth(async (_req: NextRequest, _authCtx: unknown, ctx?: Ctx) => {
  const { presencaId } = await (ctx as Ctx).params
  const sb = admin()
  const { data: pres, error } = await sb.from('nr_turma_presenca').select('certificado_url').eq('id', presencaId).maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!pres || !(pres as { certificado_url?: string | null }).certificado_url) {
    return NextResponse.json({ ok: false, error: 'sem certificado' }, { status: 404 })
  }
  const path = (pres as { certificado_url: string }).certificado_url
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL_SECONDS)
  return NextResponse.json({ ok: true, signed_url: signed?.signedUrl ?? null })
}) as unknown as (req: NextRequest, ctx: Ctx) => Promise<NextResponse>

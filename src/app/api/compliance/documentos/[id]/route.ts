// PS Gestão ERP — Compliance Hub
// GET    /api/compliance/documentos/:id   — retorna metadata + signed URL (1h)
// DELETE /api/compliance/documentos/:id   — soft delete + remove do storage

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'compliance'
const SIGNED_TTL_SECONDS = 3600 // 1h

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth(async (_req: NextRequest, _authCtx: any, ctx?: Ctx) => {
  const { id } = await (ctx as Ctx).params
  const sb = admin()
  const { data: doc, error } = await sb
    .from('compliance_documentos')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!doc) return NextResponse.json({ ok: false, error: 'não encontrado' }, { status: 404 })

  let signedUrl: string | null = null
  const path: string = (doc as any).arquivo_url
  if (path) {
    const { data: signed } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_TTL_SECONDS)
    signedUrl = signed?.signedUrl ?? null
  }

  return NextResponse.json({
    ok: true,
    documento: doc,
    signed_url: signedUrl,
    expires_in: SIGNED_TTL_SECONDS,
  })
}) as any

export const DELETE = withAuth(async (_req: NextRequest, _authCtx: any, ctx?: Ctx) => {
  const { id } = await (ctx as Ctx).params
  const sb = admin()
  const { data: doc } = await sb
    .from('compliance_documentos')
    .select('arquivo_url')
    .eq('id', id)
    .maybeSingle()

  const { error } = await sb
    .from('compliance_documentos')
    .update({ ativo: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })

  const path = (doc as any)?.arquivo_url
  if (path) {
    await sb.storage.from(BUCKET).remove([path]).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}) as any

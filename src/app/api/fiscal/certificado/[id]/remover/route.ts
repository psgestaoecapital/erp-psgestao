import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const DELETE = withAuth(async (
  _req: NextRequest,
  { userId },
  routeCtx?: { params: Promise<{ id: string }> }
) => {
  try {
    const params = await routeCtx?.params
    const id = params?.id
    if (!id) return NextResponse.json({ ok: false, erro: 'id ausente' }, { status: 400 })

    const { error } = await supabaseAdmin
      .from('erp_certificados_a1')
      .update({
        status: 'removido',
        removido_em: new Date().toISOString(),
        removido_por: userId,
      })
      .eq('id', id)
      .eq('status', 'ativo')

    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro'
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 })
  }
})

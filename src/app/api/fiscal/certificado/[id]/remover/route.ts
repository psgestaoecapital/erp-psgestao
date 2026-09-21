import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'

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

    const { data: cert } = await supabaseAdmin
      .from('erp_certificados_a1')
      .select('id, company_id')
      .eq('id', id)
      .maybeSingle()
    if (!cert) return NextResponse.json({ ok: false, erro: 'Certificado nao encontrado' }, { status: 404 })

    const negado = await guardaEmpresaFiscal({ userId, companyId: cert.company_id, papelMinimo: 'gerente', log: { notaTipo: 'nfe', notaId: null, operacao: 'certificado_remover', endpoint: 'certificado/remover' } })
    if (negado) return negado

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

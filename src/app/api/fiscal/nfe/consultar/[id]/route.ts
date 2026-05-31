import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { isFiscalError } from '@/lib/fiscal/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withAuth(async (
  _req: NextRequest,
  _ctx,
  routeCtx?: { params: Promise<{ id: string }> }
) => {
  try {
    const params = await routeCtx?.params
    if (!params?.id) {
      return NextResponse.json({ ok: false, mensagem: 'ID obrigatorio' }, { status: 400 })
    }

    const { data: nota } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .select('id, company_id, provider_reference, chave, status, numero, xml_url, danfe_url, motivo_rejeicao')
      .eq('id', params.id)
      .maybeSingle()

    if (!nota) {
      return NextResponse.json({ ok: false, mensagem: 'NFe nao encontrada' }, { status: 404 })
    }

    if (nota.status === 'processando') {
      try {
        const svc = await createFiscalService(nota.company_id)
        const atual = await svc.consultarNFe(nota.provider_reference)

        if (atual.status !== 'processando') {
          await supabaseAdmin
            .from('erp_nfe_emitidas')
            .update({
              status: atual.status,
              chave: atual.chave ?? nota.chave,
              numero: atual.numero ?? nota.numero,
              xml_url: atual.xmlUrl,
              danfe_url: atual.danfeUrl,
              motivo_rejeicao: atual.motivoRejeicao,
              provider_raw: atual.providerRaw ?? null,
            })
            .eq('id', params.id)
        }

        return NextResponse.json({
          ok: atual.status === 'autorizada',
          status: atual.status,
          chave: atual.chave,
          numero: atual.numero,
          xmlUrl: atual.xmlUrl,
          danfeUrl: atual.danfeUrl,
          motivoRejeicao: atual.motivoRejeicao,
        })
      } catch (err) {
        if (isFiscalError(err)) return NextResponse.json(err.toJSON(), { status: 502 })
        throw err
      }
    }

    return NextResponse.json({
      ok: nota.status === 'autorizada',
      status: nota.status,
      chave: nota.chave,
      numero: nota.numero,
      xmlUrl: nota.xml_url,
      danfeUrl: nota.danfe_url,
      motivoRejeicao: nota.motivo_rejeicao,
    })
  } catch (err) {
    if (isFiscalError(err)) return NextResponse.json(err.toJSON(), { status: 502 })
    return NextResponse.json(
      { ok: false, mensagem: (err as Error)?.message ?? 'Erro' },
      { status: 500 }
    )
  }
})

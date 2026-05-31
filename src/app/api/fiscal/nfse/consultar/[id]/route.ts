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
    const id = params?.id
    if (!id) {
      return NextResponse.json({ ok: false, mensagem: 'id ausente' }, { status: 400 })
    }

    const { data: nota, error } = await supabaseAdmin
      .from('erp_nfse_emitidas')
      .select('id, company_id, provider_reference, status, numero, xml_url, pdf_url, motivo_rejeicao')
      .eq('id', id)
      .maybeSingle()

    if (error || !nota) {
      return NextResponse.json({ ok: false, mensagem: 'NFSe nao encontrada' }, { status: 404 })
    }

    if (nota.status === 'processando') {
      try {
        const svc = await createFiscalService(nota.company_id)
        const atual = await svc.consultarNFSe(nota.provider_reference)

        if (atual.status !== 'processando') {
          await supabaseAdmin
            .from('erp_nfse_emitidas')
            .update({
              status: atual.status,
              numero: atual.numero ?? nota.numero,
              codigo_verificacao: atual.codigoVerificacao,
              xml_url: atual.xmlUrl,
              pdf_url: atual.pdfUrl,
              motivo_rejeicao: atual.motivoRejeicao,
              provider_raw: atual.providerRaw ?? null,
            })
            .eq('id', id)
        }

        return NextResponse.json({
          ok: atual.status === 'autorizada',
          status: atual.status,
          numero: atual.numero,
          xmlUrl: atual.xmlUrl,
          pdfUrl: atual.pdfUrl,
          motivoRejeicao: atual.motivoRejeicao,
        })
      } catch (err) {
        if (isFiscalError(err)) {
          return NextResponse.json(err.toJSON(), { status: 502 })
        }
        throw err
      }
    }

    return NextResponse.json({
      ok: nota.status === 'autorizada',
      status: nota.status,
      numero: nota.numero,
      xmlUrl: nota.xml_url,
      pdfUrl: nota.pdf_url,
      motivoRejeicao: nota.motivo_rejeicao,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, mensagem: (err as Error)?.message ?? 'Erro' },
      { status: 500 }
    )
  }
})

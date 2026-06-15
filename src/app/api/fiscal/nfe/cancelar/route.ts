import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { isFiscalError } from '@/lib/fiscal/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface CancelarNFeBody {
  nfeId: string
  justificativa: string
  // Override de ambiente (homologacao)
  ambiente?: 'homologacao' | 'producao'
}

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = (await req.json()) as CancelarNFeBody

    if (!body.nfeId) {
      return NextResponse.json({ ok: false, mensagem: 'nfeId obrigatorio' }, { status: 400 })
    }
    const justificativa = (body.justificativa ?? '').trim()
    if (justificativa.length < 15) {
      return NextResponse.json(
        { ok: false, mensagem: 'Justificativa exige minimo 15 caracteres (regra SEFAZ)' },
        { status: 400 }
      )
    }

    // Busca a NFe pelo id pra pegar company_id + chave/referencia
    const { data: nfe, error: errNfe } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .select('id, company_id, chave, provider_reference, status')
      .eq('id', body.nfeId)
      .single()

    if (errNfe || !nfe) {
      return NextResponse.json(
        { ok: false, mensagem: `NFe nao encontrada: ${errNfe?.message ?? 'inexistente'}` },
        { status: 404 }
      )
    }
    if (nfe.status !== 'autorizada') {
      return NextResponse.json(
        { ok: false, mensagem: `NFe nao esta autorizada (status atual: ${nfe.status})` },
        { status: 400 }
      )
    }

    // Identificador para a Focus: prioriza chave (44 digitos), fallback pra provider_reference
    const referenciaFocus = nfe.chave?.trim() || nfe.provider_reference?.trim()
    if (!referenciaFocus) {
      return NextResponse.json(
        { ok: false, mensagem: 'NFe sem chave nem provider_reference · sem como identificar na Focus' },
        { status: 422 }
      )
    }

    const svc = await createFiscalService(nfe.company_id, { ambienteOverride: body.ambiente })
    const resposta = await svc.cancelarNFe(referenciaFocus, justificativa)

    if (resposta.status !== 'cancelada') {
      return NextResponse.json(
        {
          ok: false,
          mensagem: resposta.motivoRejeicao ?? `Focus retornou status ${resposta.status}`,
          providerRaw: resposta.providerRaw,
        },
        { status: 502 }
      )
    }

    // Provider aceitou · grava no banco via RPC
    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('fn_cancelar_nfe', {
      p_nfe_id: body.nfeId,
      p_justificativa: justificativa,
      p_operador_id: userId,
      p_provider_raw: resposta.providerRaw ?? null,
    })

    if (rpcErr) {
      return NextResponse.json(
        {
          ok: false,
          mensagem: `Cancelada na SEFAZ mas erro ao gravar: ${rpcErr.message}`,
          providerRaw: resposta.providerRaw,
        },
        { status: 500 }
      )
    }
    const r = (rpcResult ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) {
      return NextResponse.json(
        { ok: false, mensagem: r.erro ?? 'Falha ao gravar cancelamento', providerRaw: resposta.providerRaw },
        { status: 422 }
      )
    }

    return NextResponse.json({
      ok: true,
      nfeId: body.nfeId,
      status: 'cancelada',
      providerRaw: resposta.providerRaw,
    })
  } catch (err) {
    if (isFiscalError(err)) {
      return NextResponse.json(err.toJSON(), { status: 502 })
    }
    return NextResponse.json(
      { ok: false, mensagem: (err as Error)?.message ?? 'Erro interno' },
      { status: 500 }
    )
  }
})

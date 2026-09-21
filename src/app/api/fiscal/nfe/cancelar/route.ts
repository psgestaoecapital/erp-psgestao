import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { isFiscalError } from '@/lib/fiscal/errors'
import { registrarTentativaFiscal, pareceJaCancelada } from '@/lib/fiscal/tentativaLog'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface CancelarNFeBody {
  nfeId: string
  justificativa: string
  // Override de ambiente (homologacao)
  ambiente?: 'homologacao' | 'producao'
}

// Cancelamento de NF-e. TODA tentativa é registrada (erp_fiscal_tentativa) e a mensagem ao usuário
// carrega o motivo REAL devolvido pela SEFAZ — nada de falha silenciosa (bug R.R NFS-e 56, mesma doutrina).
export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = (await req.json()) as CancelarNFeBody

    if (!body.nfeId) {
      return NextResponse.json({ ok: false, mensagem: 'nfeId obrigatorio' }, { status: 400 })
    }
    const justificativa = (body.justificativa ?? '').trim()

    // Busca a NFe pelo id pra pegar company_id + chave/referencia
    const { data: nfe, error: errNfe } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .select('id, company_id, chave, provider, provider_reference, status')
      .eq('id', body.nfeId)
      .single()

    if (errNfe || !nfe) {
      return NextResponse.json(
        { ok: false, mensagem: `NFe nao encontrada: ${errNfe?.message ?? 'inexistente'}` },
        { status: 404 }
      )
    }

    if (justificativa.length < 15) {
      await registrarTentativaFiscal({
        companyId: nfe.company_id, notaTipo: 'nfe', notaId: nfe.id, operacao: 'cancelamento', provider: nfe.provider,
        endpoint: 'validacao', referencia: nfe.provider_reference ?? nfe.chave, httpStatus: 400,
        providerCodigo: 'JUSTIFICATIVA_CURTA', providerMensagem: 'Justificativa com menos de 15 caracteres.',
        resultado: 'erro', usuarioId: userId,
      })
      return NextResponse.json(
        { ok: false, mensagem: 'Justificativa obrigatória: mínimo de 15 caracteres (regra SEFAZ).' },
        { status: 400 }
      )
    }
    if (nfe.status !== 'autorizada') {
      return NextResponse.json(
        { ok: false, mensagem: `NF-e não está autorizada (status atual: ${nfe.status}).` },
        { status: 400 }
      )
    }

    const chaveDigitos = (nfe.chave ?? '').replace(/\D/g, '')
    const referenciaFocus = nfe.provider_reference?.trim() || (chaveDigitos.length === 44 ? chaveDigitos : '')
    if (!referenciaFocus) {
      await registrarTentativaFiscal({
        companyId: nfe.company_id, notaTipo: 'nfe', notaId: nfe.id, operacao: 'cancelamento', provider: nfe.provider,
        endpoint: 'validacao', httpStatus: 422, providerCodigo: 'SEM_REFERENCIA',
        providerMensagem: 'NF-e sem provider_reference nem chave válida.', resultado: 'erro', usuarioId: userId,
      })
      return NextResponse.json(
        { ok: false, mensagem: 'NF-e sem referência do provedor nem chave válida — não há como identificar na Focus.' },
        { status: 422 }
      )
    }

    const svc = await createFiscalService(nfe.company_id, { ambienteOverride: body.ambiente })
    let resposta
    try {
      resposta = await svc.cancelarNFe(referenciaFocus, justificativa)
    } catch (err) {
      const fe = isFiscalError(err) ? err : null
      const httpStatus = (fe?.details?.status as number | undefined) ?? null
      const motivo = fe?.message ?? (err as Error)?.message ?? 'Erro ao contatar o provedor.'
      const codigo = fe?.code ?? 'ERRO_PROVEDOR'

      if (pareceJaCancelada(motivo)) {
        await supabaseAdmin.rpc('fn_cancelar_nfe', { p_nfe_id: body.nfeId, p_justificativa: justificativa, p_operador_id: userId, p_provider_raw: null })
        await registrarTentativaFiscal({
          companyId: nfe.company_id, notaTipo: 'nfe', notaId: nfe.id, operacao: 'cancelamento', provider: nfe.provider,
          endpoint: 'cancelarNFe', referencia: referenciaFocus, httpStatus, providerCodigo: codigo, providerMensagem: motivo,
          resultado: 'ja_cancelada', usuarioId: userId,
        })
        return NextResponse.json({ ok: true, jaCancelada: true, sincronizada: true, nfeId: body.nfeId, status: 'cancelada' })
      }

      await registrarTentativaFiscal({
        companyId: nfe.company_id, notaTipo: 'nfe', notaId: nfe.id, operacao: 'cancelamento', provider: nfe.provider,
        endpoint: 'cancelarNFe', referencia: referenciaFocus, httpStatus, providerCodigo: codigo, providerMensagem: motivo,
        resultado: 'erro', usuarioId: userId,
      })
      const status4xx = httpStatus && httpStatus >= 400 && httpStatus < 500
      return NextResponse.json(
        { ok: false, mensagem: motivo, codigo, httpStatus }, { status: status4xx ? 422 : 502 }
      )
    }

    if (resposta.status !== 'cancelada') {
      const motivo = resposta.motivoRejeicao ?? `A SEFAZ não confirmou o cancelamento (status ${resposta.status}).`
      await registrarTentativaFiscal({
        companyId: nfe.company_id, notaTipo: 'nfe', notaId: nfe.id, operacao: 'cancelamento', provider: nfe.provider,
        endpoint: 'cancelarNFe', referencia: referenciaFocus, providerMensagem: motivo,
        resultado: resposta.status === 'rejeitada' ? 'rejeitada' : 'erro', usuarioId: userId,
      })
      return NextResponse.json({ ok: false, mensagem: motivo, status: resposta.status }, { status: 502 })
    }

    // Provider aceitou · grava no banco via RPC
    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('fn_cancelar_nfe', {
      p_nfe_id: body.nfeId,
      p_justificativa: justificativa,
      p_operador_id: userId,
      p_provider_raw: resposta.providerRaw ?? null,
    })

    if (rpcErr) {
      await registrarTentativaFiscal({
        companyId: nfe.company_id, notaTipo: 'nfe', notaId: nfe.id, operacao: 'cancelamento', provider: nfe.provider,
        endpoint: 'fn_cancelar_nfe', referencia: referenciaFocus, providerCodigo: 'ERRO_GRAVACAO', providerMensagem: rpcErr.message,
        resultado: 'erro', usuarioId: userId,
      })
      return NextResponse.json(
        { ok: false, mensagem: `Cancelada na SEFAZ mas erro ao gravar: ${rpcErr.message}` },
        { status: 500 }
      )
    }
    const r = (rpcResult ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) {
      await registrarTentativaFiscal({
        companyId: nfe.company_id, notaTipo: 'nfe', notaId: nfe.id, operacao: 'cancelamento', provider: nfe.provider,
        endpoint: 'fn_cancelar_nfe', referencia: referenciaFocus, providerCodigo: 'ERRO_GRAVACAO', providerMensagem: r.erro,
        resultado: 'erro', usuarioId: userId,
      })
      return NextResponse.json({ ok: false, mensagem: r.erro ?? 'Falha ao gravar cancelamento' }, { status: 422 })
    }

    await registrarTentativaFiscal({
      companyId: nfe.company_id, notaTipo: 'nfe', notaId: nfe.id, operacao: 'cancelamento', provider: nfe.provider,
      endpoint: 'cancelarNFe', referencia: referenciaFocus, httpStatus: 200, providerMensagem: 'Cancelamento confirmado.',
      resultado: 'ok', usuarioId: userId,
    })
    return NextResponse.json({ ok: true, nfeId: body.nfeId, status: 'cancelada' })
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

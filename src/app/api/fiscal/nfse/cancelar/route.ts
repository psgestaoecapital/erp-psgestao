import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { isFiscalError } from '@/lib/fiscal/errors'
import { registrarTentativaFiscal, mensagemCancelamentoAmigavel, pareceJaCancelada } from '@/lib/fiscal/tentativaLog'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface CancelarBody {
  notaId: string
  justificativa: string
}

// Cancelamento de NFS-e (André). Fluxo: Focus DELETE (via provider) → persistência
// atômica na RPC fn_nfse_cancelar. Só nota AUTORIZADA; justificativa obrigatória (>=15).
// TODA tentativa é registrada (erp_fiscal_tentativa) — nada de falha silenciosa (bug R.R nota 56).
export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = (await req.json()) as CancelarBody
    const notaId = String(body?.notaId ?? '').trim()
    const justificativa = String(body?.justificativa ?? '').trim()

    if (!notaId) {
      return NextResponse.json({ ok: false, mensagem: 'notaId obrigatório' }, { status: 400 })
    }

    const { data: nota, error: notaErr } = await supabaseAdmin
      .from('erp_nfse_emitidas')
      .select('id, company_id, provider, provider_reference, numero, status')
      .eq('id', notaId)
      .maybeSingle()

    if (notaErr) {
      return NextResponse.json({ ok: false, mensagem: notaErr.message }, { status: 500 })
    }
    if (!nota) {
      return NextResponse.json({ ok: false, mensagem: 'NFS-e não encontrada.' }, { status: 404 })
    }

    // Guarda de pertencimento: a empresa é a DA NOTA (nunca o corpo). Bloqueia acesso cruzado + loga.
    const negado = await guardaEmpresaFiscal({
      userId, companyId: nota.company_id, papelMinimo: 'membro',
      log: { notaTipo: 'nfse', notaId, operacao: 'cancelamento', endpoint: 'nfse/cancelar' },
    })
    if (negado) return negado

    // Justificativa curta: aponta o mínimo de 15 na própria tela (e registra a tentativa).
    if (justificativa.length < 15) {
      await registrarTentativaFiscal({
        companyId: nota.company_id, notaTipo: 'nfse', notaId, operacao: 'cancelamento', provider: nota.provider,
        endpoint: 'validacao', referencia: nota.provider_reference ?? nota.numero, httpStatus: 400,
        providerCodigo: 'JUSTIFICATIVA_CURTA', providerMensagem: 'Justificativa com menos de 15 caracteres.',
        resultado: 'erro', usuarioId: userId,
      })
      return NextResponse.json(
        { ok: false, mensagem: 'Justificativa obrigatória: mínimo de 15 caracteres.' },
        { status: 400 }
      )
    }

    if (nota.status === 'cancelada') {
      return NextResponse.json({ ok: true, jaCancelada: true, notaId })
    }
    if (nota.status !== 'autorizada') {
      return NextResponse.json(
        { ok: false, mensagem: `Só é possível cancelar uma NFS-e AUTORIZADA. Status atual: ${nota.status}.` },
        { status: 409 }
      )
    }

    const ref = String(nota.provider_reference || nota.numero || '').trim()
    if (!ref) {
      await registrarTentativaFiscal({
        companyId: nota.company_id, notaTipo: 'nfse', notaId, operacao: 'cancelamento', provider: nota.provider,
        endpoint: 'validacao', httpStatus: 422, providerCodigo: 'SEM_REFERENCIA',
        providerMensagem: 'NFS-e sem referência do provedor.', resultado: 'erro', usuarioId: userId,
      })
      return NextResponse.json(
        { ok: false, mensagem: 'NFS-e sem referência do provedor — cancele diretamente no portal do provedor.' },
        { status: 422 }
      )
    }

    // 1) Cancela no Focus — CADA desfecho é registrado (sucesso, rejeição, erro de rede, já cancelada).
    const svc = await createFiscalService(nota.company_id)
    let resposta
    try {
      resposta = await svc.cancelarNFSe(ref, justificativa)
    } catch (err) {
      const fe = isFiscalError(err) ? err : null
      const httpStatus = (fe?.details?.status as number | undefined) ?? null
      const motivo = fe?.message ?? (err as Error)?.message ?? 'Erro ao contatar o provedor.'
      const codigo = fe?.code ?? 'ERRO_PROVEDOR'

      // Focus/prefeitura disse que a nota JÁ está cancelada → sincroniza o status local.
      if (pareceJaCancelada(motivo)) {
        await supabaseAdmin.rpc('fn_nfse_cancelar', { p_nota_id: notaId, p_justificativa: justificativa, p_user_id: userId })
        await registrarTentativaFiscal({
          companyId: nota.company_id, notaTipo: 'nfse', notaId, operacao: 'cancelamento', provider: nota.provider,
          endpoint: 'cancelarNFSe', referencia: ref, httpStatus, providerCodigo: codigo, providerMensagem: motivo,
          resultado: 'ja_cancelada', usuarioId: userId,
        })
        return NextResponse.json({ ok: true, jaCancelada: true, sincronizada: true, notaId, status: 'cancelada' })
      }

      await registrarTentativaFiscal({
        companyId: nota.company_id, notaTipo: 'nfse', notaId, operacao: 'cancelamento', provider: nota.provider,
        endpoint: 'cancelarNFSe', referencia: ref, httpStatus, providerCodigo: codigo, providerMensagem: motivo,
        resultado: 'erro', usuarioId: userId,
      })
      const status4xx = httpStatus && httpStatus >= 400 && httpStatus < 500
      return NextResponse.json(
        { ok: false, mensagem: mensagemCancelamentoAmigavel(motivo), motivo, codigo, httpStatus },
        { status: status4xx ? 422 : 502 }
      )
    }

    if (resposta.status !== 'cancelada' && resposta.status !== 'processando') {
      const motivo = resposta.motivoRejeicao || 'O provedor não confirmou o cancelamento.'
      await registrarTentativaFiscal({
        companyId: nota.company_id, notaTipo: 'nfse', notaId, operacao: 'cancelamento', provider: nota.provider,
        endpoint: 'cancelarNFSe', referencia: ref, providerMensagem: motivo,
        resultado: resposta.status === 'rejeitada' ? 'rejeitada' : 'erro', usuarioId: userId,
      })
      return NextResponse.json(
        { ok: false, mensagem: mensagemCancelamentoAmigavel(motivo), motivo, status: resposta.status },
        { status: 502 }
      )
    }

    // 2) Persiste (atômico) só depois do OK do Focus.
    const { data: persist, error: rpcErr } = await supabaseAdmin.rpc('fn_nfse_cancelar', {
      p_nota_id: notaId,
      p_justificativa: justificativa,
      p_user_id: userId,
    })
    if (rpcErr) {
      await registrarTentativaFiscal({
        companyId: nota.company_id, notaTipo: 'nfse', notaId, operacao: 'cancelamento', provider: nota.provider,
        endpoint: 'fn_nfse_cancelar', referencia: ref, providerCodigo: 'ERRO_GRAVACAO', providerMensagem: rpcErr.message,
        resultado: 'erro', usuarioId: userId,
      })
      return NextResponse.json(
        {
          ok: false,
          mensagem:
            'NFS-e cancelada no provedor, mas houve erro ao gravar no banco · contate suporte. Ref: ' + ref,
          rpcError: rpcErr.message,
        },
        { status: 500 }
      )
    }

    const p = (persist ?? {}) as { ok?: boolean; erro?: string }
    if (p.ok === false) {
      await registrarTentativaFiscal({
        companyId: nota.company_id, notaTipo: 'nfse', notaId, operacao: 'cancelamento', provider: nota.provider,
        endpoint: 'fn_nfse_cancelar', referencia: ref, providerCodigo: 'ERRO_GRAVACAO', providerMensagem: p.erro,
        resultado: 'erro', usuarioId: userId,
      })
      return NextResponse.json({ ok: false, mensagem: p.erro ?? 'Falha ao registrar cancelamento.' }, { status: 409 })
    }

    await registrarTentativaFiscal({
      companyId: nota.company_id, notaTipo: 'nfse', notaId, operacao: 'cancelamento', provider: nota.provider,
      endpoint: 'cancelarNFSe', referencia: ref, httpStatus: 200, providerMensagem: resposta.motivoRejeicao ?? 'Cancelamento confirmado.',
      resultado: resposta.status === 'processando' ? 'processando' : 'ok', usuarioId: userId,
    })
    return NextResponse.json({ ok: true, notaId, numero: nota.numero, status: 'cancelada' })
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

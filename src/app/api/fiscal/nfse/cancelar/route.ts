import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { isFiscalError } from '@/lib/fiscal/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface CancelarBody {
  notaId: string
  justificativa: string
}

// Cancelamento de NFS-e (André). Fluxo: Focus DELETE (via provider) → persistência
// atômica na RPC fn_nfse_cancelar. Só nota AUTORIZADA; justificativa obrigatória (>=15).
export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = (await req.json()) as CancelarBody
    const notaId = String(body?.notaId ?? '').trim()
    const justificativa = String(body?.justificativa ?? '').trim()

    if (!notaId) {
      return NextResponse.json({ ok: false, mensagem: 'notaId obrigatório' }, { status: 400 })
    }
    if (justificativa.length < 15) {
      return NextResponse.json(
        { ok: false, mensagem: 'Justificativa obrigatória (mínimo 15 caracteres).' },
        { status: 400 }
      )
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
    if (nota.status === 'cancelada') {
      return NextResponse.json({ ok: true, jaCancelada: true, notaId })
    }
    if (nota.status !== 'autorizada') {
      return NextResponse.json(
        { ok: false, mensagem: `Só é possível cancelar uma NFS-e AUTORIZADA. Status atual: ${nota.status}.` },
        { status: 409 }
      )
    }

    // 1) Cancela no Focus. A referência é o provider_reference (fallback: numero).
    const ref = String(nota.provider_reference || nota.numero || '').trim()
    if (!ref) {
      return NextResponse.json(
        { ok: false, mensagem: 'NFS-e sem referência do provedor — cancele diretamente no portal do provedor.' },
        { status: 422 }
      )
    }

    const svc = await createFiscalService(nota.company_id)
    const resposta = await svc.cancelarNFSe(ref, justificativa)

    if (resposta.status !== 'cancelada' && resposta.status !== 'processando') {
      return NextResponse.json(
        {
          ok: false,
          mensagem: resposta.motivoRejeicao || 'O provedor não confirmou o cancelamento. Tente novamente em instantes.',
          status: resposta.status,
        },
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
      return NextResponse.json({ ok: false, mensagem: p.erro ?? 'Falha ao registrar cancelamento.' }, { status: 409 })
    }

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

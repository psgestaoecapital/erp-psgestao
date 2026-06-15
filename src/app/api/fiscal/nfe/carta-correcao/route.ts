import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { isFiscalError } from '@/lib/fiscal/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface CartaCorrecaoBody {
  nfeId: string
  correcao: string
  ambiente?: 'homologacao' | 'producao'
}

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = (await req.json()) as CartaCorrecaoBody

    if (!body.nfeId) {
      return NextResponse.json({ ok: false, mensagem: 'nfeId obrigatorio' }, { status: 400 })
    }
    const correcao = (body.correcao ?? '').trim()
    if (correcao.length < 15) {
      return NextResponse.json(
        { ok: false, mensagem: 'Correcao exige minimo 15 caracteres (regra SEFAZ)' },
        { status: 400 }
      )
    }
    if (correcao.length > 1000) {
      return NextResponse.json(
        { ok: false, mensagem: 'Correcao excede 1000 caracteres (regra SEFAZ)' },
        { status: 400 }
      )
    }

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

    const referenciaFocus = nfe.chave?.trim() || nfe.provider_reference?.trim()
    if (!referenciaFocus) {
      return NextResponse.json(
        { ok: false, mensagem: 'NFe sem chave nem provider_reference · sem como identificar na Focus' },
        { status: 422 }
      )
    }

    // 1. Cria o evento em 'processando' (valida sequencia <=20, status='autorizada')
    const { data: evResp, error: evErr } = await supabaseAdmin.rpc('fn_emitir_carta_correcao', {
      p_nfe_id: body.nfeId,
      p_correcao: correcao,
      p_operador_id: userId,
    })
    if (evErr) {
      return NextResponse.json(
        { ok: false, mensagem: `Erro ao registrar evento: ${evErr.message}` },
        { status: 500 }
      )
    }
    const r = (evResp ?? {}) as { ok?: boolean; erro?: string; evento_id?: string; sequencia?: number }
    if (r.ok === false) {
      return NextResponse.json({ ok: false, mensagem: r.erro ?? 'Falha ao registrar evento' }, { status: 422 })
    }
    const eventoId = r.evento_id as string
    const sequencia = r.sequencia as number

    // 2. Chama Focus
    let resposta: { status: 'registrado' | 'rejeitado' | 'processando'; protocolo?: string; motivoRejeicao?: string; providerRaw: unknown }
    try {
      const svc = await createFiscalService(nfe.company_id, { ambienteOverride: body.ambiente })
      resposta = await svc.cartaCorrecaoNFe(referenciaFocus, correcao)
    } catch (focusErr) {
      // Atualiza evento como rejeitado pra nao ficar travado em 'processando'
      const msg = (focusErr as Error)?.message ?? 'Erro ao chamar Focus'
      await supabaseAdmin.rpc('fn_registrar_resultado_evento_nfe', {
        p_evento_id: eventoId,
        p_status: 'rejeitado',
        p_motivo_rejeicao: msg,
        p_provider_raw: null,
      })
      if (isFiscalError(focusErr)) {
        return NextResponse.json(focusErr.toJSON(), { status: 502 })
      }
      return NextResponse.json({ ok: false, mensagem: msg }, { status: 502 })
    }

    // 3. Grava o resultado final
    await supabaseAdmin.rpc('fn_registrar_resultado_evento_nfe', {
      p_evento_id: eventoId,
      p_status: resposta.status,
      p_protocolo: resposta.protocolo ?? null,
      p_motivo_rejeicao: resposta.motivoRejeicao ?? null,
      p_provider_raw: resposta.providerRaw ?? null,
    })

    return NextResponse.json({
      ok: resposta.status === 'registrado',
      eventoId,
      sequencia,
      status: resposta.status,
      protocolo: resposta.protocolo,
      motivoRejeicao: resposta.motivoRejeicao,
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

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { buildNFeRequest, type NFeBuilderItemInput } from '@/lib/fiscal/nfe-builder'
import { validateNFeRequest } from '@/lib/fiscal/nfe-validator'
import { isFiscalError } from '@/lib/fiscal/errors'

// NFC-e (modelo 65 · consumidor final / balcão). Opção A: sai de um PEDIDO (reusa a
// fn_faturar que baixa estoque + gera financeiro). Régua fiscal: NASCE EM HOMOLOGAÇÃO
// (só sobe pra produção após 1 teste autorizar). Não toca o fluxo NF-e(55)/NFSe existente.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface EmitirNFCeBody {
  companyId: string
  pedidoId?: string
  cpfConsumidor?: string            // opcional (consumidor "sem identificação")
  formaPagamento?: string           // dinheiro | credito | debito | pix (default dinheiro)
  ambiente?: 'homologacao' | 'producao'
  manual?: {
    itens: NFeBuilderItemInput[]
    naturezaOperacao?: string
  }
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json()) as EmitirNFCeBody

    if (!body.companyId) {
      return NextResponse.json({ ok: false, mensagem: 'companyId obrigatorio' }, { status: 400 })
    }
    if (body.companyId === 'consolidado' || body.companyId.startsWith('group_')) {
      return NextResponse.json({ ok: false, mensagem: 'NFC-e exige selecao de 1 empresa especifica' }, { status: 400 })
    }
    if (!body.pedidoId && !body.manual) {
      return NextResponse.json({ ok: false, mensagem: 'Informe pedidoId ou itens (manual)' }, { status: 400 })
    }

    const nfceReq = await buildNFeRequest({
      companyId: body.companyId,
      pedidoId: body.pedidoId,
      manual: body.manual
        ? {
            // consumidor final: sem CNPJ/IE/endereço; CPF opcional
            destinatario: { razaoSocial: 'Consumidor final', cpf: body.cpfConsumidor },
            itens: body.manual.itens,
            naturezaOperacao: body.manual.naturezaOperacao ?? 'Venda ao consumidor',
            finalidade: 'normal',
          }
        : undefined,
    })

    // consumidor + forma de pagamento (NFC-e exige)
    if (body.cpfConsumidor) nfceReq.destinatario.cpf = body.cpfConsumidor.replace(/\D/g, '')
    const totalNota = nfceReq.itens.reduce((acc, i) => acc + i.valorTotal, 0)
    nfceReq.pagamento = { formaPagamento: body.formaPagamento ?? 'dinheiro', valor: totalNota }

    validateNFeRequest(nfceReq)

    // Régua: NFC-e nasce em homologação (só produção se explicitamente pedido)
    const svc = await createFiscalService(body.companyId, { ambienteOverride: body.ambiente ?? 'homologacao' })
    const resposta = await svc.emitirNFCe(nfceReq)

    const dadosRegistro = {
      chave: resposta.chave,
      numero: resposta.numero,
      serie: nfceReq.serie,
      protocolo: resposta.protocolo,
      natureza_operacao: nfceReq.naturezaOperacao,
      finalidade: nfceReq.finalidade,
      valor_total: totalNota,
      valor_produtos: totalNota,
      emitente_cnpj: nfceReq.emitente.cnpj,
      emitente_razao_social: nfceReq.emitente.razaoSocial,
      emitente_inscricao_estadual: nfceReq.emitente.inscricaoEstadual,
      destinatario_cpf: nfceReq.destinatario.cpf,
      destinatario_razao_social: nfceReq.destinatario.razaoSocial,
      status: resposta.status,
      motivo_rejeicao: resposta.motivoRejeicao,
      xml_url: resposta.xmlUrl,
      danfe_url: resposta.danfeUrl,
    }

    const { data: registroId, error: rpcErr } = await supabaseAdmin.rpc('fn_registrar_nfe_emitida', {
      p_company_id: body.companyId,
      p_erp_receber_id: null,
      p_provider_reference: resposta.providerReference,
      p_ambiente: svc.ambiente,
      p_dados: dadosRegistro,
      p_itens: nfceReq.itens,
      p_provider_raw: resposta.providerRaw ?? null,
    })

    if (rpcErr) {
      return NextResponse.json(
        { ok: false, mensagem: `NFC-e emitida mas erro registrar: ${rpcErr.message}`, providerReference: resposta.providerReference },
        { status: 500 }
      )
    }

    // marca o registro como NFC-e (modelo 65) — distingue da NF-e(55)
    if (registroId) {
      await supabaseAdmin.from('erp_nfe_emitidas').update({ modelo: '65' }).eq('id', registroId)
    }

    return NextResponse.json({
      ok: resposta.ok,
      nfceId: registroId,
      modelo: '65',
      status: resposta.status,
      numero: resposta.numero,
      chave: resposta.chave,
      xmlUrl: resposta.xmlUrl,
      danfeUrl: resposta.danfeUrl,
      motivoRejeicao: resposta.motivoRejeicao,
      providerReference: resposta.providerReference,
      ambiente: svc.ambiente,
    })
  } catch (err) {
    if (isFiscalError(err)) {
      return NextResponse.json(err.toJSON(), { status: 502 })
    }
    return NextResponse.json(
      { ok: false, mensagem: err instanceof Error ? err.message : 'Erro ao emitir NFC-e' },
      { status: 500 }
    )
  }
})

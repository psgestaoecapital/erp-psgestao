import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { buildNFeRequest, type NFeBuilderItemInput } from '@/lib/fiscal/nfe-builder'
import { validateNFeRequest } from '@/lib/fiscal/nfe-validator'
import { isFiscalError } from '@/lib/fiscal/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface EmitirNFeBody {
  companyId: string
  erpReceberId?: string
  // FEAT-NFE-PRODUTO-2-CARD-PEDIDO-v1 · terceiro modo de emissao (a partir do pedido)
  pedidoId?: string
  // Override de ambiente · SO desce pra homologacao (anti-engano em service.ts)
  ambiente?: 'homologacao' | 'producao'
  manual?: {
    destinatario: {
      razaoSocial: string
      cnpj?: string
      cpf?: string
      email?: string
    }
    itens: NFeBuilderItemInput[]
    naturezaOperacao?: string
    finalidade?: 'normal' | 'complementar' | 'ajuste' | 'devolucao'
  }
  overrides?: {
    itens: NFeBuilderItemInput[]
    naturezaOperacao?: string
    finalidade?: 'normal' | 'complementar' | 'ajuste' | 'devolucao'
  }
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json()) as EmitirNFeBody

    if (!body.companyId) {
      return NextResponse.json({ ok: false, mensagem: 'companyId obrigatorio' }, { status: 400 })
    }
    if (body.companyId === 'consolidado' || body.companyId.startsWith('group_')) {
      return NextResponse.json(
        { ok: false, mensagem: 'NFe exige selecao de 1 empresa especifica' },
        { status: 400 }
      )
    }

    const nfeReq = await buildNFeRequest({
      companyId: body.companyId,
      erpReceberId: body.erpReceberId,
      pedidoId: body.pedidoId,
      manual: body.manual,
      overrides: body.overrides,
    })

    validateNFeRequest(nfeReq)

    const svc = await createFiscalService(body.companyId, { ambienteOverride: body.ambiente })
    const resposta = await svc.emitirNFe(nfeReq)

    const valorProdutos = nfeReq.itens.reduce((acc, i) => acc + i.valorTotal, 0)

    const dadosRegistro = {
      chave: resposta.chave,
      numero: resposta.numero,
      serie: nfeReq.serie,
      protocolo: resposta.protocolo,
      natureza_operacao: nfeReq.naturezaOperacao,
      finalidade: nfeReq.finalidade,
      valor_total: valorProdutos,
      valor_produtos: valorProdutos,
      emitente_cnpj: nfeReq.emitente.cnpj,
      emitente_razao_social: nfeReq.emitente.razaoSocial,
      emitente_inscricao_estadual: nfeReq.emitente.inscricaoEstadual,
      destinatario_cnpj: nfeReq.destinatario.cnpj,
      destinatario_cpf: nfeReq.destinatario.cpf,
      destinatario_razao_social: nfeReq.destinatario.razaoSocial,
      destinatario_email: nfeReq.destinatario.email,
      destinatario_endereco: nfeReq.destinatario.endereco,
      status: resposta.status,
      motivo_rejeicao: resposta.motivoRejeicao,
      xml_url: resposta.xmlUrl,
      danfe_url: resposta.danfeUrl,
    }

    const { data: registroId, error: rpcErr } = await supabaseAdmin.rpc(
      'fn_registrar_nfe_emitida',
      {
        p_company_id: body.companyId,
        p_erp_receber_id: body.erpReceberId ?? null,
        p_provider_reference: resposta.providerReference,
        p_ambiente: svc.ambiente,
        p_dados: dadosRegistro,
        p_itens: nfeReq.itens,
        p_provider_raw: resposta.providerRaw ?? null,
      }
    )

    if (rpcErr) {
      return NextResponse.json(
        {
          ok: false,
          mensagem: `NFe emitida mas erro registrar: ${rpcErr.message}`,
          providerReference: resposta.providerReference,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: resposta.ok,
      nfeId: registroId,
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
      { ok: false, mensagem: (err as Error)?.message ?? 'Erro interno' },
      { status: 500 }
    )
  }
})

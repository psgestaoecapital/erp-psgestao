import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { buildNFeRequest, type NFeBuilderItemInput } from '@/lib/fiscal/nfe-builder'
import { validateNFeRequest } from '@/lib/fiscal/nfe-validator'
import { isFiscalError } from '@/lib/fiscal/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RemessaBody {
  companyId: string
  destinatarioId: string
  destinatarioTabela: 'erp_clientes' | 'erp_fornecedores'
  tipoId?: string  // erp_fiscal_remessa_tipos.id (informativo)
  cfop: string     // CFOP final (vem do tipo mas editavel)
  naturezaOperacao: string
  itens: Array<{ produtoId: string; quantidade: number; valorUnitarioOverride?: number }>
  ambiente?: 'homologacao' | 'producao'
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json()) as RemessaBody

    if (!body.companyId) {
      return NextResponse.json({ ok: false, mensagem: 'companyId obrigatorio' }, { status: 400 })
    }
    if (body.companyId === 'consolidado' || body.companyId.startsWith('group_')) {
      return NextResponse.json(
        { ok: false, mensagem: 'NFe exige selecao de 1 empresa especifica' },
        { status: 400 }
      )
    }
    if (!body.destinatarioId || !body.destinatarioTabela) {
      return NextResponse.json({ ok: false, mensagem: 'destinatarioId e destinatarioTabela obrigatorios' }, { status: 400 })
    }
    if (!['erp_clientes', 'erp_fornecedores'].includes(body.destinatarioTabela)) {
      return NextResponse.json({ ok: false, mensagem: 'destinatarioTabela invalida' }, { status: 400 })
    }
    if (!body.cfop || !body.naturezaOperacao) {
      return NextResponse.json({ ok: false, mensagem: 'cfop e naturezaOperacao obrigatorios' }, { status: 400 })
    }
    if (!Array.isArray(body.itens) || body.itens.length === 0) {
      return NextResponse.json({ ok: false, mensagem: 'Informe pelo menos 1 item' }, { status: 400 })
    }

    // Busca o destinatario (cliente ou fornecedor)
    const cols = 'id, razao_social, nome_fantasia, cnpj_cpf, cpf_cnpj, email, logradouro, numero, complemento, bairro, cidade, uf, cep'

    const { data: dest, error: errDest } = await supabaseAdmin
      .from(body.destinatarioTabela)
      .select(cols)
      .eq('id', body.destinatarioId)
      .eq('company_id', body.companyId)
      .maybeSingle()

    if (errDest || !dest) {
      return NextResponse.json(
        { ok: false, mensagem: `Destinatario nao encontrado: ${errDest?.message ?? 'inexistente'}` },
        { status: 404 }
      )
    }

    const destAny = dest as Record<string, unknown>
    const doc = String(destAny.cnpj_cpf ?? destAny.cpf_cnpj ?? '').replace(/\D/g, '')
    const ehCnpj = doc.length === 14

    const itensBuilder: NFeBuilderItemInput[] = body.itens.map((it) => ({
      produtoId: it.produtoId,
      quantidade: Number(it.quantidade),
      valorUnitarioOverride: it.valorUnitarioOverride !== undefined ? Number(it.valorUnitarioOverride) : undefined,
      cfopOverride: body.cfop.trim(),
    }))

    const enderecoBuilder = destAny.logradouro
      ? {
          logradouro: String(destAny.logradouro ?? ''),
          numero: String(destAny.numero ?? 'S/N'),
          complemento: destAny.complemento ? String(destAny.complemento) : undefined,
          bairro: String(destAny.bairro ?? ''),
          cidade: String(destAny.cidade ?? ''),
          uf: String(destAny.uf ?? ''),
          cep: String(destAny.cep ?? '').replace(/\D/g, ''),
        }
      : undefined

    const nfeReq = await buildNFeRequest({
      companyId: body.companyId,
      manual: {
        destinatario: {
          razaoSocial: String(destAny.razao_social ?? destAny.nome_fantasia ?? 'Destinatario'),
          cnpj: ehCnpj ? doc : undefined,
          cpf: !ehCnpj ? doc : undefined,
          email: destAny.email ? String(destAny.email) : undefined,
          endereco: enderecoBuilder,
        },
        itens: itensBuilder,
        naturezaOperacao: body.naturezaOperacao,
        finalidade: 'normal',
      },
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
        p_erp_receber_id: null,
        p_provider_reference: resposta.providerReference,
        p_ambiente: svc.ambiente,
        p_dados: dadosRegistro,
        p_itens: nfeReq.itens,
        p_provider_raw: resposta.providerRaw ?? null,
      }
    )

    if (rpcErr) {
      return NextResponse.json(
        { ok: false, mensagem: `NFe emitida mas erro registrar: ${rpcErr.message}`, providerReference: resposta.providerReference },
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
      cfop: body.cfop,
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

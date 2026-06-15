import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { buildNFeRequest, type NFeBuilderItemInput } from '@/lib/fiscal/nfe-builder'
import { validateNFeRequest } from '@/lib/fiscal/nfe-validator'
import { isFiscalError } from '@/lib/fiscal/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface DevolucaoBody {
  companyId: string
  fornecedorId: string
  chaveCompra: string
  itens: NFeBuilderItemInput[]
  naturezaOperacao?: string
  ambiente?: 'homologacao' | 'producao'
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json()) as DevolucaoBody

    if (!body.companyId) {
      return NextResponse.json({ ok: false, mensagem: 'companyId obrigatorio' }, { status: 400 })
    }
    if (body.companyId === 'consolidado' || body.companyId.startsWith('group_')) {
      return NextResponse.json(
        { ok: false, mensagem: 'NFe exige selecao de 1 empresa especifica' },
        { status: 400 }
      )
    }

    const chaveCompra = (body.chaveCompra ?? '').replace(/\D/g, '')
    if (chaveCompra.length !== 44) {
      return NextResponse.json(
        { ok: false, mensagem: 'Chave da NFe de compra precisa ter 44 digitos' },
        { status: 400 }
      )
    }
    if (!body.fornecedorId) {
      return NextResponse.json({ ok: false, mensagem: 'fornecedorId obrigatorio' }, { status: 400 })
    }
    if (!Array.isArray(body.itens) || body.itens.length === 0) {
      return NextResponse.json(
        { ok: false, mensagem: 'Informe pelo menos 1 item para devolver' },
        { status: 400 }
      )
    }

    // Busca o fornecedor (vira destinatario da NF-e de devolucao)
    const { data: forn, error: errForn } = await supabaseAdmin
      .from('erp_fornecedores')
      .select('id, razao_social, nome_fantasia, cnpj_cpf, cpf_cnpj, email, logradouro, numero, complemento, bairro, cidade, uf, cep')
      .eq('id', body.fornecedorId)
      .eq('company_id', body.companyId)
      .maybeSingle()

    if (errForn || !forn) {
      return NextResponse.json(
        { ok: false, mensagem: `Fornecedor nao encontrado: ${errForn?.message ?? 'inexistente'}` },
        { status: 404 }
      )
    }

    const docForn = String(forn.cnpj_cpf ?? forn.cpf_cnpj ?? '').replace(/\D/g, '')
    const ehCnpj = docForn.length === 14

    const nfeReq = await buildNFeRequest({
      companyId: body.companyId,
      manual: {
        destinatario: {
          razaoSocial: forn.razao_social ?? forn.nome_fantasia ?? 'Fornecedor',
          cnpj: ehCnpj ? docForn : undefined,
          cpf: !ehCnpj ? docForn : undefined,
          email: forn.email ?? undefined,
          endereco: forn.logradouro
            ? {
                logradouro: forn.logradouro,
                numero: String(forn.numero ?? 'S/N'),
                complemento: forn.complemento ?? undefined,
                bairro: forn.bairro ?? '',
                cidade: forn.cidade ?? '',
                uf: forn.uf ?? '',
                cep: String(forn.cep ?? '').replace(/\D/g, ''),
              }
            : undefined,
        },
        itens: body.itens,
        naturezaOperacao: body.naturezaOperacao ?? 'Devolução de compra',
        finalidade: 'devolucao',
        chaveReferenciada: chaveCompra,
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
        {
          ok: false,
          mensagem: `NFe emitida mas erro registrar: ${rpcErr.message}`,
          providerReference: resposta.providerReference,
        },
        { status: 500 }
      )
    }

    // Vincula chave_referenciada (devolucao)
    if (registroId) {
      await supabaseAdmin
        .from('erp_nfe_emitidas')
        .update({ chave_referenciada: chaveCompra })
        .eq('id', registroId)
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
      chaveReferenciada: chaveCompra,
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

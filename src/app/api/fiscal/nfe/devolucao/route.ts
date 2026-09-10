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
  // devolucao-icms-espelho: CSOSN da devolucao (editavel na tela, default = config da empresa).
  // Aplicado a cada item que tem ICMS a devolver (base/valor espelhados da entrada).
  csosnIcms?: string
  // Lei Kandir: o FRETE entra na base do ICMS. A devolucao precisa declarar frete/seguro/outras/desconto
  // para o total (vNF) bater com a base do ICMS (ex.: produtos 370 + frete 55 = total 425 = base ICMS).
  frete?: number
  seguro?: number
  outrasDespesas?: number
  desconto?: number
  modalidadeFrete?: number
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
      .select('id, razao_social, nome_fantasia, cnpj_cpf, cpf_cnpj, ie, email, logradouro, numero, complemento, bairro, cidade, uf, cep')
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

    // IE do destinatario (contribuinte). SEFAZ rejeita a devolucao sem ela ("IE do destinatario
    // nao informada"). Fonte 1: cadastro do fornecedor. Fonte 2 (fallback, auto-cura): a IE do
    // emitente na propria NF-e de compra referenciada — o XML de entrada guardou emitente_ie.
    let ieDest = String(forn.ie ?? '').replace(/\D/g, '')
    if (!ieDest) {
      const { data: notaCompra } = await supabaseAdmin
        .from('erp_nfe_recebidas')
        .select('emitente_ie')
        .eq('company_id', body.companyId)
        .eq('chave_acesso', chaveCompra)
        .maybeSingle()
      ieDest = String(notaCompra?.emitente_ie ?? '').replace(/\D/g, '')
    }

    // CSOSN da devolucao: editavel na tela (body.csosnIcms) -> config da empresa -> 900. Injetado em
    // cada item que traz ICMS a devolver (base/valor espelhados da entrada). CSOSN 900 permite informar
    // o ICMS no Simples; hardcoded viraria erro fiscal, entao e configuravel (RD do CEO 09/09).
    const { data: cfgDevol } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .select('csosn_devolucao')
      .eq('company_id', body.companyId)
      .eq('provider', 'focusnfe')
      .eq('ativo', true)
      .maybeSingle()
    const csosnDevol = (body.csosnIcms || (cfgDevol as { csosn_devolucao?: string } | null)?.csosn_devolucao || '900').trim()
    const itensComCsosn: NFeBuilderItemInput[] = body.itens.map((it) =>
      it.icmsOverride
        ? { ...it, icmsOverride: { ...it.icmsOverride, csosn: it.icmsOverride.csosn ?? csosnDevol } }
        : it,
    )

    const nfeReq = await buildNFeRequest({
      companyId: body.companyId,
      manual: {
        destinatario: {
          razaoSocial: forn.razao_social ?? forn.nome_fantasia ?? 'Fornecedor',
          cnpj: ehCnpj ? docForn : undefined,
          cpf: !ehCnpj ? docForn : undefined,
          inscricaoEstadual: ieDest || undefined,
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
        itens: itensComCsosn,
        naturezaOperacao: body.naturezaOperacao ?? 'Devolução de compra',
        finalidade: 'devolucao',
        chaveReferenciada: chaveCompra,
        totais: {
          frete: body.frete, seguro: body.seguro, outrasDespesas: body.outrasDespesas,
          desconto: body.desconto, modalidadeFrete: body.modalidadeFrete,
        },
      },
    })

    validateNFeRequest(nfeReq)

    const svc = await createFiscalService(body.companyId, { ambienteOverride: body.ambiente })
    const resposta = await svc.emitirNFe(nfeReq)

    const valorProdutos = nfeReq.itens.reduce((acc, i) => acc + i.valorTotal, 0)
    // total da nota = produtos + frete + seguro + outras − desconto (tem que bater com a base do ICMS)
    const frete = Number(body.frete ?? 0), seguro = Number(body.seguro ?? 0)
    const outras = Number(body.outrasDespesas ?? 0), descontoNota = Number(body.desconto ?? 0)
    const valorTotalNota = Number((valorProdutos + frete + seguro + outras - descontoNota).toFixed(2))
    // ICMS/IPI totais da nota = soma do que cada item traz (espelho da entrada na devolucao). Sem gravar
    // isso, a tela de NF-e emitidas mostrava "ICMS: —" mesmo com base/aliquota digitadas (o item ia com
    // icms.valor, mas o total valor_icms/valor_ipi ficava nulo). fn_registrar_nfe_emitida ja le do p_dados.
    const valorIcms = Number(nfeReq.itens.reduce((acc, i) => acc + Number(i.icms?.valor ?? 0), 0).toFixed(2))
    const valorIpi = Number(nfeReq.itens.reduce((acc, i) => acc + Number(i.ipi?.valor ?? 0), 0).toFixed(2))
    const dadosRegistro = {
      chave: resposta.chave,
      numero: resposta.numero,
      serie: nfeReq.serie,
      protocolo: resposta.protocolo,
      natureza_operacao: nfeReq.naturezaOperacao,
      finalidade: nfeReq.finalidade,
      valor_total: valorTotalNota,
      valor_produtos: valorProdutos,
      valor_icms: valorIcms,
      valor_ipi: valorIpi,
      valor_frete: frete,
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

    // Estorno de estoque: devolução de COMPRA devolve a peça pro fornecedor → estoque SAI.
    // Só se a NF foi autorizada. Idempotente (guarda por ref_id na RPC). Não quebra o retorno da NF.
    let estoqueEstornado = false
    if (registroId && resposta.ok) {
      try {
        const { data: est } = await supabaseAdmin.rpc('fn_nfe_devolucao_estornar_estoque', {
          p_company_id: body.companyId,
          p_nfe_emitida_id: registroId,
          p_itens: body.itens.map((it) => ({ produto_id: it.produtoId, quantidade: it.quantidade, custo: it.valorUnitarioOverride ?? 0 })),
          p_direcao: 'compra',
        })
        estoqueEstornado = (est as { ok?: boolean })?.ok === true
      } catch { estoqueEstornado = false }
    }

    // Mensagem sempre presente — a Focus e ASSINCRONA: no POST costuma voltar 'processando'
    // (ok:false, sem motivo ainda), e a rejeicao/autorizacao real chega depois pelo webhook.
    // Sem isto a tela mostrava so "Falha ao emitir devolucao" e engolia o motivo (o erro existia
    // e ninguem via). Agora o motivo/estado vai explicito; o front consulta o resultado final.
    const mensagem =
      resposta.status === 'processando'
        ? 'NF-e enviada a SEFAZ. Processando a autorizacao — o resultado aparece em instantes.'
        : resposta.status === 'rejeitada' || resposta.status === 'denegada'
          ? (resposta.motivoRejeicao ?? 'Rejeitada pela SEFAZ (sem motivo informado)')
          : resposta.motivoRejeicao ?? undefined

    return NextResponse.json({
      ok: resposta.ok,
      nfeId: registroId,
      estoqueEstornado,
      status: resposta.status,
      mensagem,
      processando: resposta.status === 'processando',
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

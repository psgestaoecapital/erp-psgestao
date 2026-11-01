import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { buildNFeRequest, type NFeBuilderItemInput } from '@/lib/fiscal/nfe-builder'
import { validateNFeRequest } from '@/lib/fiscal/nfe-validator'
import { isFiscalError } from '@/lib/fiscal/errors'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'
import { registrarFalhaEmissaoNFe, registrarTentativaEmissaoNFe, type ContextoEmissaoNFe } from '@/lib/fiscal/nfeRecusa'
import { validarNFeAvulsa, ufDestino, soDigitos, type CfopSaida, type FinalidadeNFe } from '@/lib/fiscal/nfeAvulsa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RemessaBody {
  companyId: string
  destinatarioId: string
  destinatarioTabela: 'erp_clientes' | 'erp_fornecedores'
  tipoId?: string  // erp_fiscal_remessa_tipos.id (informativo)
  cfop: string     // CFOP final (vem do tipo mas editavel)
  naturezaOperacao: string
  itens: Array<{ produtoId: string; quantidade: number; valorUnitarioOverride?: number; cfop?: string }>
  ambiente?: 'homologacao' | 'producao'
  // #3861 · NF-e avulsa: finalidade + chave referenciada, ICMS da operação (CSOSN/CST), informações complementares, frete
  finalidade?: FinalidadeNFe
  chaveReferenciada?: string
  icmsCodigo?: string
  observacoes?: string
  modalidadeFrete?: number
  valorFrete?: number
  // #3861 · "Corrigir e reenviar": id da nota recusada (erp_nfe_emitidas) — a nova herda o vínculo com pedido/título
  reenvioDe?: string
}

const FINALIDADES: FinalidadeNFe[] = ['normal', 'complementar', 'ajuste', 'devolucao']
const MODALIDADES_FRETE = [0, 1, 2, 3, 4, 9]

export const POST = withAuth(async (req: NextRequest, { userId }) => {
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

    const finalidade: FinalidadeNFe = body.finalidade ?? 'normal'
    if (!FINALIDADES.includes(finalidade)) {
      return NextResponse.json({ ok: false, mensagem: 'finalidade invalida' }, { status: 400 })
    }
    const modalidadeFrete = body.modalidadeFrete ?? 9
    const valorFrete = Number(body.valorFrete ?? 0)
    if (!MODALIDADES_FRETE.includes(modalidadeFrete) || !(valorFrete >= 0)) {
      return NextResponse.json({ ok: false, mensagem: 'frete invalido' }, { status: 400 })
    }
    if (modalidadeFrete === 9 && valorFrete > 0) {
      return NextResponse.json({ ok: false, mensagem: 'Frete com valor exige a modalidade (CIF, FOB ou terceiros).' }, { status: 400 })
    }

    const negado = await guardaEmpresaFiscal({ userId, companyId: body.companyId, papelMinimo: 'membro', log: { notaTipo: 'nfe', operacao: 'remessa', endpoint: 'nfe/remessa' } })
    if (negado) return negado

    // #3861 · reenvio de nota recusada (qualquer origem): só nota da MESMA empresa e que não saiu (nem autorizada nem
    // em processamento). A nova nota herda o pedido / título a receber da recusada, para a venda continuar vinculada.
    let vinculoReenvio: { pedido_id: string | null; erp_receber_id: string | null } | null = null
    if (body.reenvioDe) {
      const { data: orig } = await supabaseAdmin
        .from('erp_nfe_emitidas')
        .select('id, status, pedido_id, erp_receber_id')
        .eq('id', body.reenvioDe)
        .eq('company_id', body.companyId)
        .maybeSingle()
      if (!orig) {
        return NextResponse.json({ ok: false, mensagem: 'Nota a reenviar não encontrada nesta empresa.' }, { status: 404 })
      }
      if (orig.status === 'autorizada' || orig.status === 'processando') {
        return NextResponse.json({
          ok: false,
          mensagem: orig.status === 'autorizada'
            ? 'Esta nota já foi autorizada: não há o que reenviar.'
            : 'Esta nota ainda está aguardando a SEFAZ: espere a resposta antes de reenviar.',
        }, { status: 409 })
      }
      vinculoReenvio = { pedido_id: orig.pedido_id ?? null, erp_receber_id: orig.erp_receber_id ?? null }
    }

    // Busca o destinatario (cliente ou fornecedor)
    const cols = 'id, razao_social, nome_fantasia, cnpj_cpf, cpf_cnpj, ie, contribuinte_icms, email, logradouro, numero, complemento, bairro, cidade, uf, cep'

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

    // #3861 · CFOP pela UF (5 dentro · 6 outra UF, com aviso · 7 exterior), finalidade/chave e ICMS da operação —
    // a mesma regra que a tela mostra antes de emitir (src/lib/fiscal/nfeAvulsa.ts)
    const [{ data: emp }, { data: catalogo }] = await Promise.all([
      supabaseAdmin.from('companies').select('uf_fiscal, regime_tributario').eq('id', body.companyId).maybeSingle(),
      supabaseAdmin.from('erp_fiscal_cfop_saida').select('cfop, descricao, natureza_sugerida, exige_referenciada').eq('ativo', true),
    ])
    const empAny = (emp ?? {}) as { uf_fiscal?: string | null; regime_tributario?: string | null }
    const simples = String(empAny.regime_tributario ?? '').toLowerCase().includes('simples')
    const avulsa = validarNFeAvulsa({
      cfop: body.cfop,
      itensCfop: body.itens.map((it) => it.cfop),
      ufEmitente: ufDestino(empAny.uf_fiscal),
      ufDestino: ufDestino(destAny.uf),
      finalidade,
      chaveReferenciada: body.chaveReferenciada,
      icmsCodigo: body.icmsCodigo,
      simples,
      catalogo: (catalogo ?? []) as CfopSaida[],
      destinatario: { doc, ie: destAny.ie as string | null, contribuinteIcms: destAny.contribuinte_icms as string | null },
    })
    if (avulsa.erros.length > 0) {
      return NextResponse.json({ ok: false, mensagem: avulsa.erros.join(' · '), erros: avulsa.erros, avisos: avulsa.avisos }, { status: 400 })
    }
    // #3861 · não reenviar enquanto a anterior para o mesmo destinatário ainda espera a SEFAZ (evita nota duplicada)
    const { data: pendente } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .select('id, numero')
      .eq('company_id', body.companyId)
      .eq(ehCnpj ? 'destinatario_cnpj' : 'destinatario_cpf', doc)
      .eq('status', 'processando')
      .gte('criado_em', new Date(Date.now() - 30 * 60_000).toISOString())
      .limit(1)
      .maybeSingle()
    if (pendente) {
      return NextResponse.json({
        ok: false,
        erro: 'nota_em_processamento',
        nfeId: pendente.id,
        mensagem: 'Já existe uma NF-e para este destinatário aguardando a SEFAZ. Espere a resposta em Notas emitidas antes de enviar outra.',
      }, { status: 409 })
    }

    const icmsCodigo = soDigitos(body.icmsCodigo)
    // ICMS escolhido para a operação (remessa não destaca imposto): sem base, alíquota nem valor
    const icmsOverride = icmsCodigo ? { csosn: icmsCodigo, base: 0, aliquota: 0, valor: 0 } : undefined

    const itensBuilder: NFeBuilderItemInput[] = body.itens.map((it, i) => ({
      produtoId: it.produtoId,
      quantidade: Number(it.quantidade),
      valorUnitarioOverride: it.valorUnitarioOverride !== undefined ? Number(it.valorUnitarioOverride) : undefined,
      cfopOverride: avulsa.itensCfop[i] ?? avulsa.cfop,
      ...(icmsOverride ? { icmsOverride } : {}),
    }))
    const chaveRef = soDigitos(body.chaveReferenciada)

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
          // #3861: IE + indicador do cadastro (cliente ou fornecedor) — sem isso a SEFAZ recusava "IE não informada"
          inscricaoEstadual: avulsa.ie?.inscricaoEstadual,
          indicadorIE: avulsa.ie?.indicadorIE,
        },
        itens: itensBuilder,
        naturezaOperacao: body.naturezaOperacao,
        finalidade,
        ...(chaveRef ? { chaveReferenciada: chaveRef } : {}),
        ...(body.observacoes?.trim() ? { observacoes: body.observacoes.trim().slice(0, 2000) } : {}),
        totais: { modalidadeFrete, ...(valorFrete > 0 ? { frete: valorFrete } : {}) },
      },
    })

    // OS-0179 (RD-71, mesmo caminho da nfe/emitir): toda falha da emissão deixa rastro — tentativa; recusa
    // síncrona da Focus → nota 'rejeitada' com payload_enviado.
    const ctxEmissao: ContextoEmissaoNFe = {
      companyId: body.companyId, userId, notaTipo: 'nfe', operacao: 'remessa', endpoint: 'nfe/remessa', nfeReq: nfeReq,
    }
    try {
      validateNFeRequest(nfeReq)
    } catch (e) {
      await registrarFalhaEmissaoNFe(ctxEmissao, e)
      throw e
    }

    const svc = await createFiscalService(body.companyId, { ambienteOverride: body.ambiente })
    let resposta
    try {
      resposta = await svc.emitirNFe(nfeReq)
    } catch (e) {
      await registrarFalhaEmissaoNFe(ctxEmissao, e, svc.ambiente)
      throw e
    }

    const valorProdutos = nfeReq.itens.reduce((acc, i) => acc + i.valorTotal, 0)
    const dadosRegistro = {
      chave: resposta.chave,
      numero: resposta.numero,
      serie: nfeReq.serie,
      protocolo: resposta.protocolo,
      natureza_operacao: nfeReq.naturezaOperacao,
      finalidade: nfeReq.finalidade,
      valor_total: valorProdutos + valorFrete,
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

    await registrarTentativaEmissaoNFe(ctxEmissao, resposta, (registroId as string | null) ?? null)

    // #3861 · payload EXATO enviado à Focus (sem cert/token), também na nota rejeitada — mesmo caminho da nfe/emitir.
    // Sem isso as duas recusas da HUTSONTURBO ficaram sem payload_enviado para auditar.
    if (!rpcErr && registroId && resposta.payloadEnviado != null) {
      await supabaseAdmin
        .from('erp_nfe_emitidas')
        .update({ payload_enviado: resposta.payloadEnviado })
        .eq('id', registroId as string)
    }

    // Reenvio: só o VÍNCULO com o pedido/título da nota recusada, gravado à parte (mesmo caminho do pedido_id na
    // nfe/emitir). A avulsa não gera nem altera título — por isso não passa p_erp_receber_id à RPC.
    if (!rpcErr && registroId && (vinculoReenvio?.pedido_id || vinculoReenvio?.erp_receber_id)) {
      await supabaseAdmin
        .from('erp_nfe_emitidas')
        .update({
          ...(vinculoReenvio.pedido_id ? { pedido_id: vinculoReenvio.pedido_id } : {}),
          ...(vinculoReenvio.erp_receber_id ? { erp_receber_id: vinculoReenvio.erp_receber_id } : {}),
        })
        .eq('id', registroId as string)
        .eq('company_id', body.companyId)
    }

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
      cfop: avulsa.cfop,
      avisos: avulsa.avisos,
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

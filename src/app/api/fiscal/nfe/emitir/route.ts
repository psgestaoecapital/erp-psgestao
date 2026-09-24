import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { buildNFeRequest, type NFeBuilderItemInput } from '@/lib/fiscal/nfe-builder'
import { validateNFeRequest } from '@/lib/fiscal/nfe-validator'
import { isFiscalError } from '@/lib/fiscal/errors'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'
import { guardarXmlNota } from '@/lib/fiscal/guardarXmlNota'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface EmitirNFeBody {
  companyId: string
  erpReceberId?: string
  // FEAT-NFE-PRODUTO-2-CARD-PEDIDO-v1 · terceiro modo de emissao (a partir do pedido)
  pedidoId?: string
  // chamado #20 Fase 3 · NF-e de peça a partir da OS: vincula a nota à OS e guarda a justificativa
  // de divergência de valor NO registro (recuperável depois — §8.1 detalhe #1 do CEO).
  osId?: string
  justificativaDivergencia?: string
  valorEsperadoOs?: number
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
  // indFinal escolhido na venda (modal/pedido). undefined → o builder deriva do indIEDest.
  consumidorFinal?: boolean
}

export const POST = withAuth(async (req: NextRequest, { userId }) => {
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

    const negado = await guardaEmpresaFiscal({ userId, companyId: body.companyId, papelMinimo: 'membro', log: { notaTipo: 'nfe', operacao: 'emissao', endpoint: 'nfe/emitir' } })
    if (negado) return negado

    const nfeReq = await buildNFeRequest({
      companyId: body.companyId,
      erpReceberId: body.erpReceberId,
      pedidoId: body.pedidoId,
      manual: body.manual,
      overrides: body.overrides,
      consumidorFinal: body.consumidorFinal,
    })

    validateNFeRequest(nfeReq)

    const valorProdutos = nfeReq.itens.reduce((acc, i) => acc + i.valorTotal, 0)

    // Lei 12.741/2012 (Transparência Fiscal) · #70 — "valor aproximado dos tributos" nas Informações
    // Complementares (tag infCpl → campo Focus informacoes_adicionais_contribuinte, mapeado no emitirNFe).
    // FONTE LEGAL: Lei 12.741/2012 art. 1º caput — exigido nos documentos "emitidos por ocasião da VENDA
    // AO CONSUMIDOR" (regul. Decreto 8.264/2014). Operação entre contribuintes para REVENDA (B2B) NÃO é
    // venda ao consumidor → o bloco não entra. REGRA NO CÓDIGO (não no acaso): só compõe quando o
    // destinatário é consumidor final. Sinal disponível: indicador de IE do destinatário — contribuinte
    // com IE (indIEDest=1, ex.: CIDIMAR/revenda) não é consumidor final; não-contribuinte/isento (9/2) e
    // NFC-e são. (Refinamento futuro: indFinal explícito; hoje o indIEDest já exclui a revenda B2B.)
    // Empresa do Simples: percentual único (percentual_total_tributos_sn) × valor da nota. Só quando
    // lei12741_ativo=true (rollout por empresa). CONCATENA com observação existente — não sobrescreve.
    {
      const { data: cfg12741 } = await supabaseAdmin
        .from('erp_fiscal_provider_config')
        .select('lei12741_ativo, percentual_total_tributos_sn, lei12741_observacao_template')
        .eq('company_id', body.companyId).eq('provider', 'focusnfe').eq('ativo', true).maybeSingle()
      // consumidor final: agora é decisão explícita do request (o builder já resolveu — default pelo
      // indIEDest, com override do operador na venda). O bloco Lei 12.741 só entra a consumidor final.
      const ehConsumidorFinal = nfeReq.consumidorFinal === true
      const pctTrib = Number(cfg12741?.percentual_total_tributos_sn ?? 0)
      if (cfg12741?.lei12741_ativo === true && ehConsumidorFinal && Number.isFinite(pctTrib) && pctTrib > 0 && valorProdutos > 0) {
        const valorAprox = Math.round((pctTrib / 100) * valorProdutos * 100) / 100
        const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const template = (typeof cfg12741?.lei12741_observacao_template === 'string' && cfg12741.lei12741_observacao_template.trim())
          ? cfg12741.lei12741_observacao_template.trim()
          : 'Valor aproximado dos tributos: R$ {valor} ({percentual}%) — Fonte: Simples Nacional, Lei 12.741/2012'
        const bloco = template.replace(/\{valor\}/g, fmt(valorAprox)).replace(/\{percentual\}/g, fmt(pctTrib))
        nfeReq.observacoes = [bloco, nfeReq.observacoes].map((s) => (s ?? '').trim()).filter(Boolean).join(' | ')
      }
    }

    const svc = await createFiscalService(body.companyId, { ambienteOverride: body.ambiente })
    const resposta = await svc.emitirNFe(nfeReq)
    // ICMS/IPI totais = soma do que cada item traz. Sem isso, a tela de NF-e emitidas mostrava
    // "ICMS: —" nas notas NORMAIS (mesma lacuna que o #1361 fechou só na devolução). A RPC
    // fn_registrar_nfe_emitida já lê valor_icms/valor_ipi do p_dados.
    const valorIcms = Number(nfeReq.itens.reduce((acc, i) => acc + Number(i.icms?.valor ?? 0), 0).toFixed(2))
    const valorIpi = Number(nfeReq.itens.reduce((acc, i) => acc + Number(i.ipi?.valor ?? 0), 0).toFixed(2))

    const dadosRegistro = {
      chave: resposta.chave,
      numero: resposta.numero,
      serie: nfeReq.serie,
      protocolo: resposta.protocolo,
      natureza_operacao: nfeReq.naturezaOperacao,
      finalidade: nfeReq.finalidade,
      valor_total: valorProdutos,
      valor_produtos: valorProdutos,
      valor_icms: valorIcms,
      valor_ipi: valorIpi,
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

    // Persiste o payload EXATO enviado à Focus (sem cert/token — vão no header) para depurar
    // rejeições sem reconstruir no escuro (espelho do que a NFS-e já faz). fn_registrar_nfe_emitida
    // não tem param p_payload_enviado → grava via UPDATE separado. Vale também para nota REJEITADA
    // (a rota registra a nota mesmo rejeitada), que é justamente o caso a depurar (ex.: 938 do ST).
    if (registroId && resposta.payloadEnviado != null) {
      await supabaseAdmin
        .from('erp_nfe_emitidas')
        .update({ payload_enviado: resposta.payloadEnviado })
        .eq('id', registroId)
    }

    // Guarda o XML autorizado (o RESULTADO) — só quando já autorizada; se 'processando', o XML sai depois
    // (backfill/consulta). Best-effort: guardarXmlNota nunca lança. Também grava o vTotTrib (Lei 12.741).
    if (registroId && resposta.status === 'autorizada') {
      await guardarXmlNota(registroId)
    }

    // FIX-NFE-ICMS-ORIGEM-v1 · vinculo pedido_id (anti-duplicata)
    // fn_registrar_nfe_emitida nao tem param p_pedido_id · grava via UPDATE
    // separado pra que o NFeCard consiga achar a nota (.eq('pedido_id', ...))
    if (registroId && body.pedidoId) {
      await supabaseAdmin
        .from('erp_nfe_emitidas')
        .update({ pedido_id: body.pedidoId })
        .eq('id', registroId)
    }

    // chamado #20 Fase 3 · vincula a nota à OS e persiste a justificativa da divergência de valor
    // (§8.1) no registro — recuperável meses depois ("por que a NF saiu menor que a OS?").
    if (registroId && body.osId) {
      await supabaseAdmin
        .from('erp_nfe_emitidas')
        .update({
          os_id: body.osId,
          justificativa_divergencia: body.justificativaDivergencia?.trim() || null,
          valor_esperado_os: body.valorEsperadoOs ?? null,
        })
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

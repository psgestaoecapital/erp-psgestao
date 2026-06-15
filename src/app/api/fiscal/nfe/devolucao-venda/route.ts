import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { buildNFeRequest, type NFeBuilderItemInput } from '@/lib/fiscal/nfe-builder'
import { validateNFeRequest } from '@/lib/fiscal/nfe-validator'
import { isFiscalError } from '@/lib/fiscal/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface DevolVendaBody {
  nfeVendaId: string
  // [{ produtoId, quantidade }] · quantidades a devolver (<= vendidas)
  itens: Array<{ produtoId: string; quantidade: number; cfopOverride?: string }>
  naturezaOperacao?: string
  ambiente?: 'homologacao' | 'producao'
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json()) as DevolVendaBody

    if (!body.nfeVendaId) {
      return NextResponse.json({ ok: false, mensagem: 'nfeVendaId obrigatorio' }, { status: 400 })
    }
    if (!Array.isArray(body.itens) || body.itens.length === 0) {
      return NextResponse.json(
        { ok: false, mensagem: 'Informe pelo menos 1 item para devolver' },
        { status: 400 }
      )
    }

    // Busca a NFe de venda original
    const { data: nfeVenda, error: errVenda } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .select('id, company_id, chave, status, finalidade, itens, destinatario_razao_social, destinatario_cnpj, destinatario_cpf, destinatario_email, destinatario_endereco')
      .eq('id', body.nfeVendaId)
      .single()

    if (errVenda || !nfeVenda) {
      return NextResponse.json(
        { ok: false, mensagem: `NFe de venda nao encontrada: ${errVenda?.message ?? 'inexistente'}` },
        { status: 404 }
      )
    }
    if (nfeVenda.status !== 'autorizada') {
      return NextResponse.json(
        { ok: false, mensagem: `NFe de venda nao esta autorizada (status: ${nfeVenda.status})` },
        { status: 400 }
      )
    }
    if (!nfeVenda.chave || nfeVenda.chave.replace(/\D/g, '').length !== 44) {
      return NextResponse.json(
        { ok: false, mensagem: 'NFe de venda sem chave de 44 digitos' },
        { status: 422 }
      )
    }

    // Valida quantidades nao excedem o vendido
    const itensVenda = Array.isArray(nfeVenda.itens) ? nfeVenda.itens as Array<Record<string, unknown>> : []
    for (const itDev of body.itens) {
      if (!itDev.produtoId || !(itDev.quantidade > 0)) {
        return NextResponse.json(
          { ok: false, mensagem: 'Item invalido (produtoId/quantidade)' },
          { status: 400 }
        )
      }
      // Tenta achar codigo do produto na nfe original
      const { data: prod } = await supabaseAdmin
        .from('erp_produtos')
        .select('id, codigo')
        .eq('id', itDev.produtoId)
        .eq('company_id', nfeVenda.company_id)
        .maybeSingle()
      if (!prod) {
        return NextResponse.json(
          { ok: false, mensagem: `Produto ${itDev.produtoId} nao encontrado na empresa` },
          { status: 404 }
        )
      }
      const itemOriginal = itensVenda.find(
        (i) => i.codigo === prod.codigo || i.produto_id === itDev.produtoId
      )
      if (itemOriginal) {
        const qtdOriginal = Number(itemOriginal.quantidade ?? 0)
        if (itDev.quantidade > qtdOriginal + 0.001) {
          return NextResponse.json(
            { ok: false, mensagem: `Quantidade a devolver (${itDev.quantidade}) excede a vendida (${qtdOriginal}) no produto ${prod.codigo ?? prod.id}` },
            { status: 400 }
          )
        }
      }
      // Se nao bateu codigo, deixa o builder validar
    }

    const chaveVenda = nfeVenda.chave.replace(/\D/g, '')

    // Monta NFe manual de devolucao com destinatario = cliente original
    const itensBuilder: NFeBuilderItemInput[] = body.itens.map((it) => ({
      produtoId: it.produtoId,
      quantidade: Number(it.quantidade),
      // tenta puxar valor unitario do item original via codigo
      valorUnitarioOverride: (() => {
        const orig = itensVenda.find((i) => i.codigo)
        const v = orig?.valorUnitario ?? orig?.valor_unitario
        return typeof v === 'number' ? v : undefined
      })(),
      // TODO PARAMETRO_CONFIRMAR_COM_CONTADOR: CFOP devolucao entrada 1202/2202
      cfopOverride: it.cfopOverride ?? '1202',
    }))

    const docDest = String(nfeVenda.destinatario_cnpj ?? nfeVenda.destinatario_cpf ?? '').replace(/\D/g, '')
    const ehCnpj = docDest.length === 14

    const enderecoRaw = nfeVenda.destinatario_endereco as Record<string, unknown> | null
    const enderecoBuilder = enderecoRaw && typeof enderecoRaw === 'object'
      ? {
          logradouro: String(enderecoRaw.logradouro ?? ''),
          numero: String(enderecoRaw.numero ?? 'S/N'),
          complemento: enderecoRaw.complemento ? String(enderecoRaw.complemento) : undefined,
          bairro: String(enderecoRaw.bairro ?? ''),
          cidade: String(enderecoRaw.cidade ?? ''),
          uf: String(enderecoRaw.uf ?? ''),
          cep: String(enderecoRaw.cep ?? '').replace(/\D/g, ''),
        }
      : undefined

    const nfeReq = await buildNFeRequest({
      companyId: nfeVenda.company_id,
      manual: {
        destinatario: {
          razaoSocial: String(nfeVenda.destinatario_razao_social ?? 'Cliente'),
          cnpj: ehCnpj ? docDest : undefined,
          cpf: !ehCnpj ? docDest : undefined,
          email: nfeVenda.destinatario_email ?? undefined,
          endereco: enderecoBuilder,
        },
        itens: itensBuilder,
        naturezaOperacao: body.naturezaOperacao ?? 'Devolução de venda',
        finalidade: 'devolucao',
        chaveReferenciada: chaveVenda,
      },
    })

    validateNFeRequest(nfeReq)

    const svc = await createFiscalService(nfeVenda.company_id, { ambienteOverride: body.ambiente })
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
        p_company_id: nfeVenda.company_id,
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

    if (registroId) {
      await supabaseAdmin
        .from('erp_nfe_emitidas')
        .update({ chave_referenciada: chaveVenda })
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
      chaveReferenciada: chaveVenda,
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

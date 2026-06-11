import type { NFeRequest, NFeProdutoItem } from './types'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { FiscalError } from './errors'

export interface NFeBuilderItemInput {
  produtoId: string
  quantidade: number
  valorUnitarioOverride?: number
  descontoUnitario?: number
}

export interface NFeBuilderInput {
  companyId: string
  erpReceberId?: string
  // FEAT-NFE-PRODUTO-2-CARD-PEDIDO-v1 · terceiro modo: monta a partir do pedido
  pedidoId?: string
  manual?: {
    destinatario: {
      razaoSocial: string
      cnpj?: string
      cpf?: string
      email?: string
      endereco?: NFeRequest['destinatario']['endereco']
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

export async function buildNFeRequest(input: NFeBuilderInput): Promise<NFeRequest> {
  const { data: emp, error: empErr } = await supabaseAdmin
    .from('companies')
    .select('cnpj, razao_social, inscricao_estadual, inscricao_municipal')
    .eq('id', input.companyId)
    .maybeSingle()
  if (empErr || !emp) {
    throw new FiscalError('PAYLOAD_INVALIDO', 'Empresa emitente nao encontrada')
  }
  if (!emp.inscricao_estadual) {
    throw new FiscalError(
      'PAYLOAD_INVALIDO',
      'Inscricao Estadual obrigatoria pra NFe · cadastre em Configuracoes da empresa'
    )
  }

  let destinatario: NFeRequest['destinatario']
  let itensInput: NFeBuilderItemInput[] = []
  let naturezaOp = 'Venda de mercadoria'
  let finalidade: 'normal' | 'complementar' | 'ajuste' | 'devolucao' = 'normal'

  if (input.pedidoId) {
    // FEAT-NFE-PRODUTO-2-CARD-PEDIDO-v1
    // fn_pedido_nfe_dados consolida destinatario + itens · builder mantem
    // erp_produtos como single source of truth pra fiscal (NCM/CSOSN/CFOP/...)
    const { data: dados, error: rpcErr } = await supabaseAdmin.rpc('fn_pedido_nfe_dados', {
      p_pedido_id: input.pedidoId,
    })
    if (rpcErr) throw new FiscalError('PAYLOAD_INVALIDO', `Falha ao montar NF-e do pedido: ${rpcErr.message}`)
    const d = (dados ?? {}) as {
      erro?: string
      tem_produto?: boolean
      destinatario?: {
        tipo?: string; documento?: string; nome?: string; email?: string
        logradouro?: string; numero?: string; bairro?: string
        municipio?: string; uf?: string; cep?: string
      }
      itens?: Array<{ produto_id: string; quantidade: number; valor_unitario: number }>
    }
    if (d.erro) throw new FiscalError('PAYLOAD_INVALIDO', d.erro)
    if (!d.tem_produto) throw new FiscalError('PAYLOAD_INVALIDO', 'Pedido sem itens de produto para NF-e')
    const dest = d.destinatario ?? {}
    destinatario = {
      razaoSocial: dest.nome ?? '',
      ...(dest.tipo === 'cnpj' ? { cnpj: dest.documento } : { cpf: dest.documento }),
      email: dest.email,
      endereco: {
        logradouro: dest.logradouro ?? '',
        numero: dest.numero,
        bairro: dest.bairro ?? '',
        cidade: dest.municipio ?? '',
        uf: dest.uf ?? '',
        cep: dest.cep ?? '',
      },
    }
    itensInput = (d.itens ?? []).map((it) => ({
      produtoId: it.produto_id,
      quantidade: Number(it.quantidade),
      valorUnitarioOverride: Number(it.valor_unitario),
    }))
    naturezaOp = 'Venda de mercadoria'
    finalidade = 'normal'
  } else if (input.erpReceberId) {
    const { data: rec } = await supabaseAdmin
      .from('erp_receber')
      .select('id, cliente_id, cliente_nome, descricao, valor')
      .eq('id', input.erpReceberId)
      .eq('company_id', input.companyId)
      .maybeSingle()
    if (!rec) throw new FiscalError('PAYLOAD_INVALIDO', 'Lancamento nao encontrado')
    if (!rec.cliente_id) {
      throw new FiscalError(
        'PAYLOAD_INVALIDO',
        'A Receber sem cliente vinculado · NFe exige cliente cadastrado'
      )
    }
    const { data: cli } = await supabaseAdmin
      .from('erp_clientes')
      .select('razao_social, cnpj_cpf, cpf_cnpj, email, logradouro, numero, bairro, cidade, uf, cep')
      .eq('id', rec.cliente_id)
      .maybeSingle()
    if (!cli) throw new FiscalError('PAYLOAD_INVALIDO', 'Cliente nao encontrado')

    const docLimpo = (cli.cnpj_cpf ?? cli.cpf_cnpj ?? '').replace(/\D/g, '')
    destinatario = {
      cnpj: docLimpo.length === 14 ? docLimpo : undefined,
      cpf: docLimpo.length === 11 ? docLimpo : undefined,
      razaoSocial: cli.razao_social,
      email: cli.email ?? undefined,
      endereco: cli.logradouro
        ? {
            logradouro: cli.logradouro,
            numero: cli.numero ?? undefined,
            bairro: cli.bairro ?? '',
            cidade: cli.cidade ?? '',
            uf: cli.uf ?? '',
            cep: (cli.cep ?? '').replace(/\D/g, ''),
          }
        : undefined,
    }
    itensInput = input.overrides?.itens ?? []
    if (itensInput.length === 0) {
      throw new FiscalError(
        'PAYLOAD_INVALIDO',
        'NFe exige selecao de produtos · use o modal pra escolher itens do catalogo'
      )
    }
    naturezaOp = input.overrides?.naturezaOperacao ?? 'Venda de mercadoria'
    finalidade = input.overrides?.finalidade ?? 'normal'
  } else if (input.manual) {
    destinatario = input.manual.destinatario
    itensInput = input.manual.itens
    naturezaOp = input.manual.naturezaOperacao ?? 'Venda de mercadoria'
    finalidade = input.manual.finalidade ?? 'normal'
  } else {
    throw new FiscalError(
      'PAYLOAD_INVALIDO',
      'Forneca pedidoId OU erpReceberId+overrides.itens OU manual.itens'
    )
  }

  const produtoIds = itensInput.map((i) => i.produtoId)
  const { data: produtos } = await supabaseAdmin
    .from('erp_produtos')
    .select(
      'id, codigo, nome, descricao, ncm, cfop_venda, cest, origem, cst_icms, cst_pis, cst_cofins, aliquota_icms, aliquota_ipi, aliquota_pis, aliquota_cofins, unidade, preco_venda'
    )
    .in('id', produtoIds)
    .eq('company_id', input.companyId)

  if (!produtos || produtos.length !== produtoIds.length) {
    throw new FiscalError(
      'PAYLOAD_INVALIDO',
      `Encontrei ${produtos?.length ?? 0} produtos · esperado ${produtoIds.length}`
    )
  }

  const itensNFe: NFeProdutoItem[] = itensInput.map((it) => {
    const prod = produtos.find((p) => p.id === it.produtoId)
    if (!prod) throw new FiscalError('PAYLOAD_INVALIDO', `Produto ${it.produtoId} nao encontrado`)

    const valorUnit = it.valorUnitarioOverride ?? Number(prod.preco_venda ?? 0)
    const desconto = it.descontoUnitario ?? 0
    const valorTotal = (valorUnit - desconto) * it.quantidade

    return {
      codigo: prod.codigo ?? prod.id,
      descricao: prod.descricao || prod.nome,
      ncm: prod.ncm ?? '',
      cfop: prod.cfop_venda ?? '5102',
      unidade: prod.unidade ?? 'UN',
      quantidade: it.quantidade,
      valorUnitario: valorUnit,
      valorTotal,
      cest: prod.cest ?? undefined,
      origem: prod.origem ?? '0',
      icms: { cst: prod.cst_icms ?? undefined, aliquota: prod.aliquota_icms ?? undefined },
      ipi: { cst: '99', aliquota: prod.aliquota_ipi ?? undefined },
      pis: { cst: prod.cst_pis ?? undefined, aliquota: prod.aliquota_pis ?? undefined },
      cofins: { cst: prod.cst_cofins ?? undefined, aliquota: prod.aliquota_cofins ?? undefined },
    }
  })

  const { data: cfg } = await supabaseAdmin
    .from('erp_fiscal_provider_config')
    .select('serie_nfe_padrao')
    .eq('company_id', input.companyId)
    .eq('provider', 'focusnfe')
    .eq('ativo', true)
    .maybeSingle()

  return {
    serie: cfg?.serie_nfe_padrao ?? '1',
    naturezaOperacao: naturezaOp,
    finalidade,
    emitente: {
      cnpj: String(emp.cnpj ?? '').replace(/\D/g, ''),
      razaoSocial: emp.razao_social,
      inscricaoEstadual: emp.inscricao_estadual,
    },
    destinatario,
    itens: itensNFe,
  }
}

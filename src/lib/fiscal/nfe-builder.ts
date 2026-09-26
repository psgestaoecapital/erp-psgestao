import type { NFeRequest, NFeProdutoItem } from './types'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { FiscalError } from './errors'

// UFs válidas (27). Fora desta lista não é UF nacional confiável (exterior, texto sujo) → não deriva CFOP.
const UFS_BR = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI',
  'RJ','RN','RS','RO','RR','SC','SP','SE','TO',
])

// Emitente estrangeiro: pais preenchido e diferente de Brasil. Estrangeira não emite NF-e modelo 55 (não
// tem UF fiscal nacional) — a guarda de uf_fiscal a isenta, e o CFOP não é derivado.
function emitenteEstrangeiro(pais?: string | null): boolean {
  const p = (pais ?? '').trim()
  return p !== '' && !/^(brasil|brazil|br)$/i.test(p)
}

// Deriva o 1º dígito do CFOP de saída pela relação UF emitente ↔ UF destinatário:
//  mesma UF → 5 (interna) · UFs diferentes (ambas nacionais) → 6 (interestadual). A família (3 últimos
// dígitos: 102, 202, 405…) é preservada; só o escopo geográfico muda. Só toca CFOP de saída 5xxx/6xxx e
// só quando AS DUAS UFs são nacionais confiáveis — senão devolve o CFOP do cadastro sem inventar
// (exterior 7xxx, entradas 1/2/3, ou UF ausente ficam intactos). Corrige o bug estrutural: o CFOP vinha
// fixo do cadastro (cfop_venda/cfopOverride) e venda/devolução p/ fora da UF do emitente rejeitava
// "CFOP de operacao interna e idDest <> 1" (KGF-SC → fornecedor PR, 10/09; ninguém viu pq as vendas eram locais).
function ajustarCfopEscopo(cfop: string, ufEmitente?: string, ufDestino?: string): string {
  const c = (cfop ?? '').replace(/\D/g, '')
  if (c.length !== 4) return cfop
  if (c[0] !== '5' && c[0] !== '6') return cfop
  const ud = (ufDestino ?? '').trim().toUpperCase()
  if (!ufEmitente || !ud || !UFS_BR.has(ud)) return cfop // sem UF confiável / exterior: não deriva
  const alvo = ufEmitente === ud ? '5' : '6'
  return alvo === c[0] ? cfop : alvo + c.slice(1)
}

export interface NFeBuilderItemInput {
  produtoId: string
  quantidade: number
  valorUnitarioOverride?: number
  descontoUnitario?: number
  // fiscal-devolucao-compra-v1: CFOP override por item (devolucao usa 5202/6202)
  cfopOverride?: string
  // devolucao-icms-espelho: ICMS por item espelhando a nota de compra original (devolve o credito).
  // csosn = codigo do Simples (config csosn_devolucao, default 900); base/aliquota/valor da entrada.
  // Quando presente, tem prioridade sobre o default do regime.
  icmsOverride?: { csosn?: string; base?: number; aliquota?: number; valor?: number; modBc?: string }
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
      // IE do destinatario (contribuinte ICMS · ex.: fornecedor na devolucao de compra)
      inscricaoEstadual?: string
      // indIEDest declarado: 1=contribuinte · 2=isento · 9=nao contribuinte (ver types.ts)
      indicadorIE?: 1 | 2 | 9
      email?: string
      endereco?: NFeRequest['destinatario']['endereco']
    }
    itens: NFeBuilderItemInput[]
    naturezaOperacao?: string
    finalidade?: 'normal' | 'complementar' | 'ajuste' | 'devolucao'
    // fiscal-devolucao-compra-v1: chave 44 digitos da NFe original
    chaveReferenciada?: string
    // #94: observações/dados adicionais (ex.: "Devolução da NF-e nº X, chave Y") → outras_informacoes na DANFE
    observacoes?: string
    // frete/seguro/outras/desconto + modalidade (compõem o total e a base do ICMS — Lei Kandir)
    totais?: NFeRequest['totais']
  }
  overrides?: {
    itens: NFeBuilderItemInput[]
    naturezaOperacao?: string
    finalidade?: 'normal' | 'complementar' | 'ajuste' | 'devolucao'
  }
  // indFinal escolhido NA VENDA (não no cadastro): a mesma empresa compra p/ revenda numa nota e p/
  // consumo em outra. Quando undefined, o builder deriva do indIEDest (contribuinte c/ IE = revenda).
  consumidorFinal?: boolean
}

export async function buildNFeRequest(input: NFeBuilderInput): Promise<NFeRequest> {
  const { data: emp, error: empErr } = await supabaseAdmin
    .from('companies')
    .select('cnpj, razao_social, inscricao_estadual, inscricao_municipal, regime_tributario, uf_fiscal, pais')
    .eq('id', input.companyId)
    .maybeSingle()
  if (empErr || !emp) {
    throw new FiscalError('PAYLOAD_INVALIDO', 'Empresa emitente nao encontrada')
  }
  // ehSimples: emitente do Simples Nacional usa CSOSN no ICMS (nao CST). Quando o produto nao
  // tem os campos fiscais preenchidos, caimos no default do REGIME (nao no do produto ou da nota
  // original — a nota original e do fornecedor, regime normal/CST, que um emitente Simples NAO
  // pode usar). Sem isto o grupo <imposto> nao sai e a SEFAZ rejeita com 620 "Expected is (imposto)".
  const ehSimples = String((emp as { regime_tributario?: string }).regime_tributario ?? '')
    .toLowerCase().includes('simples')
  // UF do emitente (p/ derivar o escopo do CFOP interna×interestadual) = companies.uf_fiscal, FONTE DE
  // VERDADE (não mais o texto livre cidade_estado — que quebrava em silêncio e o que quebra é o CFOP da
  // nota, #1768). O parser de texto saiu da decisão fiscal.
  const ufEmitBruta = String((emp as { uf_fiscal?: string }).uf_fiscal ?? '').trim().toUpperCase()
  const ufEmitente = UFS_BR.has(ufEmitBruta) ? ufEmitBruta : undefined
  const ehEstrangeira = emitenteEstrangeiro((emp as { pais?: string }).pais)
  // Guarda fail-closed: empresa brasileira sem uf_fiscal cadastrada NÃO emite NF-e — bloqueia antes da
  // Sefaz (no padrão do 232/938). Sem a UF, o CFOP interna×interestadual não tem como sair correto.
  if (!ehEstrangeira && !ufEmitente) {
    throw new FiscalError(
      'PAYLOAD_INVALIDO',
      'UF fiscal do emitente não cadastrada · defina a UF da empresa (companies.uf_fiscal) antes de emitir NF-e'
    )
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
        // #125: IE + indicador do destinatário (fn_pedido_nfe_dados agora os fornece).
        inscricao_estadual?: string | null; indicador_ie?: 1 | 2 | 9 | null
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
      // #125: sem estes campos a Sefaz rejeita 232 "IE do destinatário não informada".
      // indicadorIE undefined → o provider deriva de ter IE (contribuinte com IE → 1).
      inscricaoEstadual: dest.inscricao_estadual || undefined,
      indicadorIE: (dest.indicador_ie ?? undefined) as 1 | 2 | 9 | undefined,
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
      // #131 (KGF): o caminho do FINANCEIRO precisa ler ie + contribuinte_icms igual ao do PEDIDO
      // (#125/#1739). Sem isso o destinatário saía sem IE/indicador → provider derivava "9"/NULL →
      // Sefaz 232 mesmo com o cadastro correto (contribuinte com IE).
      .select('razao_social, cnpj_cpf, cpf_cnpj, email, logradouro, numero, bairro, cidade, uf, cep, ie, contribuinte_icms')
      .eq('id', rec.cliente_id)
      .maybeSingle()
    if (!cli) throw new FiscalError('PAYLOAD_INVALIDO', 'Cliente nao encontrado')

    const docLimpo = (cli.cnpj_cpf ?? cli.cpf_cnpj ?? '').replace(/\D/g, '')
    // Mesmo mapeamento de fn_pedido_nfe_dados: contribuinte→1, isento→2, nao_contribuinte→9, senão indefinido.
    const ieLimpa = (cli.ie ?? '').replace(/\D/g, '')
    const indIE = ((): 1 | 2 | 9 | undefined => {
      switch ((cli.contribuinte_icms ?? '').toLowerCase()) {
        case 'contribuinte': return 1
        case 'isento': return 2
        case 'nao_contribuinte': return 9
        default: return undefined
      }
    })()
    destinatario = {
      cnpj: docLimpo.length === 14 ? docLimpo : undefined,
      cpf: docLimpo.length === 11 ? docLimpo : undefined,
      razaoSocial: cli.razao_social,
      // #131: sem estes campos a Sefaz rejeita 232 "IE do destinatário não informada".
      inscricaoEstadual: ieLimpa || undefined,
      indicadorIE: indIE,
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
    // #131 (KGF) · 3º caminho: o modo manual (botão da OS, NFeCard, devolução, devolução-venda, remessa)
    // chegava só com nome + CNPJ/CPF. Sem IE/indicador o builder derivava indIEDest = 9 e a Sefaz rejeitava
    // "IE do destinatário não informada" mesmo com o cadastro certo. #1739 (pedido) e #1800 (financeiro)
    // não cobriam este ramo. Enriquece pelo cadastro do cliente da EMPRESA, com o mesmo mapeamento do
    // ramo financeiro / fn_pedido_nfe_dados (contribuinte→1, isento→2, nao_contribuinte→9).
    if (!destinatario.inscricaoEstadual && destinatario.indicadorIE == null) {
      const doc = (destinatario.cnpj ?? destinatario.cpf ?? '').replace(/\D/g, '')
      if (doc.length === 11 || doc.length === 14) {
        const { data: cli } = await supabaseAdmin
          .from('erp_clientes')
          .select('ie, contribuinte_icms')
          .eq('company_id', input.companyId)
          .eq('cnpj_cpf', doc)          // cnpj_cpf é a coluna em dígitos; cpf_cnpj é a formatada
          .limit(1)
          .maybeSingle()
        if (cli) {
          const ieLimpa = (cli.ie ?? '').replace(/\D/g, '')
          const indIE = ((): 1 | 2 | 9 | undefined => {
            switch ((cli.contribuinte_icms ?? '').toLowerCase()) {
              case 'contribuinte': return 1
              case 'isento': return 2
              case 'nao_contribuinte': return 9
              default: return undefined
            }
          })()
          destinatario = { ...destinatario, inscricaoEstadual: ieLimpa || undefined, indicadorIE: indIE }
        }
      }
    }
    itensInput = input.manual.itens
    naturezaOp = input.manual.naturezaOperacao ?? 'Venda de mercadoria'
    finalidade = input.manual.finalidade ?? 'normal'
  } else {
    throw new FiscalError(
      'PAYLOAD_INVALIDO',
      'Forneca pedidoId OU erpReceberId+overrides.itens OU manual.itens'
    )
  }

  // #jordana 26/09 · OS-2026-0179: o mesmo produto pode aparecer em 2+ itens (2 linhas de OLEO 80). A busca por id
  // devolve distintos; comparar com a lista COM repetição recusava a nota ("encontrei 10 · esperado 11").
  const produtoIds = Array.from(new Set(itensInput.map((i) => i.produtoId)))
  const { data: produtos } = await supabaseAdmin
    .from('erp_produtos')
    .select(
      'id, codigo, nome, descricao, ncm, ex_ipi, cfop_venda, cest, origem, cst_icms, cst_pis, cst_cofins, aliquota_icms, aliquota_ipi, aliquota_pis, aliquota_cofins, unidade, preco_venda, vbcst_ret, pst, vicms_substituto, vicms_st_ret, combustivel_codigo_anp, combustivel_descricao_anp'
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

    // CST 60 / 500 (ICMS cobrado anteriormente por ST): o item precisa do grupo ST retido, senão
    // a SEFAZ rejeita (938). Os campos do produto são POR UNIDADE; os VALORES escalam pela quantidade,
    // a alíquota (pst) NÃO (é percentual). Só monta quando o produto tem os valores — sem eles, o
    // nfe-validator barra antes da SEFAZ com mensagem clara (guarda no padrão do 232).
    const cstIcmsProd = prod.cst_icms ?? (ehSimples ? '102' : undefined)
    const ehStRetido = cstIcmsProd === '500' || cstIcmsProd === '60'
    const stRet = ehStRetido
      ? {
          vBcstRet: prod.vbcst_ret != null ? Number(prod.vbcst_ret) * it.quantidade : undefined,
          pst: prod.pst != null ? Number(prod.pst) : undefined,
          vIcmsSubstituto: prod.vicms_substituto != null ? Number(prod.vicms_substituto) * it.quantidade : undefined,
          vIcmsStRet: prod.vicms_st_ret != null ? Number(prod.vicms_st_ret) * it.quantidade : undefined,
        }
      : undefined

    // Grupo comb (NT 2016/002): item cujo NCM é de combustível/lubrificante (começa com 2710) exige
    // cProdANP + descANP (do cadastro do produto) e UFCons (UF do destinatário na emissão). Sem eles a
    // SEFAZ rejeita o grupo comb; o nfe-validator barra antes, no padrão do 232/938. Só monta quando é 2710.
    const ncmDigits = (prod.ncm ?? '').replace(/\D/g, '')
    const ehCombustivel = ncmDigits.startsWith('2710')
    const comb = ehCombustivel
      ? {
          cProdANP: prod.combustivel_codigo_anp != null ? Number(prod.combustivel_codigo_anp) : undefined,
          descANP: prod.combustivel_descricao_anp || undefined,
          // UFCons = UF do consumo (destinatário). "EX" quando exterior (sem UF nacional).
          ufCons: destinatario.endereco?.uf ? destinatario.endereco.uf.toUpperCase() : undefined,
        }
      : undefined

    return {
      codigo: prod.codigo ?? prod.id,
      descricao: prod.descricao || prod.nome,
      ncm: prod.ncm ?? '',
      cfop: ajustarCfopEscopo(it.cfopOverride ?? prod.cfop_venda ?? '5102', ufEmitente, destinatario.endereco?.uf),
      unidade: prod.unidade ?? 'UN',
      quantidade: it.quantidade,
      valorUnitario: valorUnit,
      valorTotal,
      cest: prod.cest ?? undefined,
      origem: prod.origem ?? '0',
      // EX da TIPI (IBPT Lei 12.741): entra na chave da tabela IBPT (NCM,EX,UF,versão). Vazio → '0'.
      exTipi: (String(prod.ex_ipi ?? '').trim() || '0'),
      // Grupo <imposto> SEMPRE presente (SEFAZ 620). Produto sem campo fiscal cai no default do
      // regime do EMITENTE. Simples: ICMS CSOSN 102 + PIS/COFINS CST 04 — a convencao dos proprios
      // produtos configurados do KGF (auditado). Produto ja configurado: usa o dele (sem mudanca).
      // devolucao-icms-espelho: se veio ICMS espelhado da nota original (it.icmsOverride), ele MANDA
      // (CSOSN configuravel + base/aliquota/valor da entrada -> devolve o credito). Senao, o default:
      // produto configurado, ou o do regime (Simples: CSOSN 102). base/valor so saem no espelho.
      icms: it.icmsOverride
        ? {
            cst: it.icmsOverride.csosn ?? prod.cst_icms ?? (ehSimples ? '900' : undefined),
            aliquota: it.icmsOverride.aliquota ?? prod.aliquota_icms ?? undefined,
            base: it.icmsOverride.base,
            valor: it.icmsOverride.valor,
            modBc: it.icmsOverride.modBc ?? '1',
          }
        : {
            cst: cstIcmsProd,
            aliquota: prod.aliquota_icms ?? undefined,
            ...(stRet ? { stRet } : {}),
          },
      ipi: undefined, // Simples Nacional / revenda: sem grupo IPI
      pis: {
        cst: prod.cst_pis ?? (ehSimples ? '04' : undefined),
        aliquota: prod.aliquota_pis ?? (ehSimples ? 0 : undefined),
      },
      cofins: {
        cst: prod.cst_cofins ?? (ehSimples ? '04' : undefined),
        aliquota: prod.aliquota_cofins ?? (ehSimples ? 0 : undefined),
      },
      ...(comb ? { comb } : {}),
    }
  })

  const { data: cfg } = await supabaseAdmin
    .from('erp_fiscal_provider_config')
    .select('serie_nfe_padrao')
    .eq('company_id', input.companyId)
    .eq('provider', 'focusnfe')
    .eq('ativo', true)
    .maybeSingle()

  // indFinal (consumidor final) — escolhido na venda; default derivado do indIEDest do destinatário
  // (contribuinte com IE = revenda B2B → false; não-contribuinte/isento → true). O operador pode
  // sobrescrever via input.consumidorFinal (pedido/OTC/modal de emissão).
  const indDestFinal = destinatario.indicadorIE ?? (destinatario.inscricaoEstadual ? 1 : 9)
  const consumidorFinal = input.consumidorFinal ?? (indDestFinal !== 1)

  return {
    serie: cfg?.serie_nfe_padrao ?? '1',
    naturezaOperacao: naturezaOp,
    finalidade,
    consumidorFinal,
    emitente: {
      cnpj: String(emp.cnpj ?? '').replace(/\D/g, ''),
      razaoSocial: emp.razao_social,
      inscricaoEstadual: emp.inscricao_estadual,
    },
    destinatario,
    itens: itensNFe,
    chaveReferenciada: input.manual?.chaveReferenciada,
    observacoes: input.manual?.observacoes,
    totais: input.manual?.totais,
  }
}

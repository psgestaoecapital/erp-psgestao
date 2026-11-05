// #5684 · NF-e da venda de VEÍCULO (Revenda). Caminho A (decisão do Rodrigo, 30/10): sai pelo MESMO emissor do GE
// (/api/fiscal/nfe/emitir → buildNFeRequest), ligada ao título que a venda já criou em erp_receber (fn_veic__receber)
// e gravando veic_venda.nfe_id. NÃO cria pedido, NÃO roda fn_faturar (duplicaria título e baixaria estoque).
// Este arquivo tem: (1) o carregador dos dados da venda (service role, depois da guarda de empresa da rota);
// (2) o cálculo PURO do item (ICMS CST 20 com redução de base, cBenef, IBS/CBS, bloco do veículo) — conferido por gate.
// Os nomes dos campos Focus estão em providers/focusnfe.ts (levantados na doc pública pelo Rodrigo, 04/11).
import { supabaseAdmin } from '../supabaseAdmin'
import { FiscalError } from './errors'
import type { NFeProdutoItem } from './types'

// Valores usados quando o perfil fiscal aprovado não traz o número (mensagem do Rodrigo 30/10 e 04/11).
export const ALIQUOTA_ICMS_VENDA_VEICULO_PADRAO = 12
export const PIS_PADRAO_PRESUMIDO = 0.65
export const COFINS_PADRAO_PRESUMIDO = 3
// Reforma tributária 2026: alíquotas de TESTE (CBS 0,9% · IBS UF 0,1%), sem recolhimento (doc Focus, 04/11).
export const CBS_ALIQUOTA_TESTE_2026 = 0.9
export const IBS_UF_ALIQUOTA_TESTE_2026 = 0.1
export const IBS_MUN_ALIQUOTA_TESTE_2026 = 0
export const NATUREZA_PADRAO_VENDA_VEICULO = 'Venda de veículo usado'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface PerfilVendaVeiculo {
  veicprodObrigatorioUsado: boolean
  ncmPadrao: string | null
  pisPct: number | null
  cofinsPct: number | null
  icmsSaidaPct: number | null
  operacao: {
    cfopDentroUf: string; cfopForaUf: string
    cstOuCsosn: string; cbenef: string | null
    reducaoBasePct: number | null
    ibsCbsCst: string | null; ibsCbsCClassTrib: string | null
    naturezaOperacao: string | null; infComplementar: string | null
  }
}

export interface DadosVendaVeiculo {
  vendaId: string
  nfeIdAtual: string | null
  nfeStatusAtual: string | null
  valorVenda: number
  numeroVenda: string | null
  clienteId: string
  receberId: string | null
  veiculo: {
    id: string; chassi: string; placa: string | null; renavam: string | null
    marca: string | null; modelo: string | null; versao: string | null
    anoFabricacao: number | null; anoModelo: number | null; cor: string | null
    combustivel: string | null; potenciaCv: number | null; cilindradas: number | null
    lugares: number | null; kmAtual: number | null; ncm: string | null
  }
  perfil: PerfilVendaVeiculo
}

export interface ItemVeiculoMontado {
  item: NFeProdutoItem
  observacoes: string
  naturezaOperacao: string
  ibsCbsTotais: { baseCalculo: number; cbsValor: number; ibsUfValor: number; ibsMunValor: number; ibsValor: number }
  /** O que não deu para validar aqui — a rota devolve para a tela mostrar (nunca silencioso). */
  avisos: string[]
}

/** CST do perfil pode vir com 3 dígitos ("020"); a Focus quer os 2 do regime normal ("20"). */
export function cstRegimeNormal(cst: string): string {
  const d = String(cst ?? '').replace(/\D/g, '')
  return d.length === 3 && d.startsWith('0') ? d.slice(1) : d
}

/** Combustível do cadastro → código da tabela da NF-e (tpComb). Sem correspondência exata → não envia (null). */
export function codigoCombustivel(txt: string | null | undefined): string | null {
  const t = String(txt ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
  if (!t) return null
  if (/flex|alcool\/gasolina|etanol\/gasolina|gasolina\/etanol|gasolina\/alcool/.test(t)) return '16'
  if (/diesel/.test(t)) return '03'
  if (/gasolina/.test(t)) return '02'
  if (/etanol|alcool/.test(t)) return '01'
  return null
}

export function infComplementarVeiculo(v: DadosVendaVeiculo['veiculo'], textoPerfil?: string | null): string {
  const partes = [
    `Veículo: ${[v.marca, v.modelo, v.versao].filter(Boolean).join(' ')}`.trim(),
    `Chassi: ${v.chassi}`,
    v.placa ? `Placa: ${v.placa}` : null,
    v.renavam ? `RENAVAM: ${v.renavam}` : null,
    v.cor ? `Cor: ${v.cor}` : null,
    v.anoFabricacao || v.anoModelo ? `Ano fab./mod.: ${v.anoFabricacao ?? '—'}/${v.anoModelo ?? '—'}` : null,
    v.combustivel ? `Combustível: ${v.combustivel}` : null,
    v.kmAtual != null ? `Km: ${v.kmAtual}` : null,
  ].filter(Boolean) as string[]
  const base = partes.join(' | ')
  const extra = (textoPerfil ?? '').trim()
  return extra ? `${base} | ${extra}` : base
}

/**
 * Item único da NF-e do veículo. ICMS = valor × (1 − redução) × alíquota (R$ 100.000, 95%, 12% → base 5.000, ICMS 600).
 * CFOP: 5102 dentro da UF do emitente, 6102 fora (do perfil aprovado). Sem NCM → recusa (nunca inventa).
 */
export function montarItemVeiculo(d: DadosVendaVeiculo, ufEmitente: string | undefined, ufDestino: string | undefined, ehSimples: boolean): ItemVeiculoMontado {
  const op = d.perfil.operacao
  const avisos: string[] = []
  const valor = round2(d.valorVenda)
  if (!(valor > 0)) throw new FiscalError('PAYLOAD_INVALIDO', 'Venda sem valor — informe o valor da venda antes de emitir a NF-e')
  if (ehSimples) throw new FiscalError('PAYLOAD_INVALIDO', 'Emissão da venda de veículo prevista para empresa de regime normal (Lucro Presumido) — confira o regime da empresa')

  const ncm = String(d.veiculo.ncm ?? d.perfil.ncmPadrao ?? '').replace(/\D/g, '')
  if (ncm.length !== 8) throw new FiscalError('PAYLOAD_INVALIDO', 'NCM do veículo não informado (nem NCM padrão no perfil fiscal aprovado) — preencha no cadastro do veículo')

  const interestadual = !!ufEmitente && !!ufDestino && ufEmitente !== ufDestino.toUpperCase()
  const cfop = (interestadual ? op.cfopForaUf : op.cfopDentroUf).trim()

  const cst = cstRegimeNormal(op.cstOuCsosn)
  const reducao = op.reducaoBasePct ?? 0
  const aliq = d.perfil.icmsSaidaPct ?? ALIQUOTA_ICMS_VENDA_VEICULO_PADRAO
  let icms: NFeProdutoItem['icms']
  if (cst === '20') {
    const base = round2(valor * (1 - reducao / 100))
    icms = { cst, aliquota: aliq, base, valor: round2(base * aliq / 100), modBc: '3', reducaoBase: reducao, ...(op.cbenef ? { cBenef: op.cbenef } : {}) }
  } else {
    // Qualquer outro CST do perfil: não calcula nada por conta própria (nem inventa base). A rota barra no validador.
    icms = { cst, aliquota: aliq, ...(op.cbenef ? { cBenef: op.cbenef } : {}) }
    avisos.push(`CST ${cst || '(vazio)'} do perfil não é o 20 (redução de base) — ICMS não calculado aqui; confira com o contador.`)
  }

  const cbsValor = round2(valor * CBS_ALIQUOTA_TESTE_2026 / 100)
  const ibsUfValor = round2(valor * IBS_UF_ALIQUOTA_TESTE_2026 / 100)
  const ibsMunValor = round2(valor * IBS_MUN_ALIQUOTA_TESTE_2026 / 100)
  const ibsValor = round2(ibsUfValor + ibsMunValor)
  const temIbsCbs = !!op.ibsCbsCst && !!op.ibsCbsCClassTrib
  if (!temIbsCbs) avisos.push('Perfil sem IBS/CBS (CST + cClassTrib) — a nota sai sem o grupo da reforma.')

  const nomeVeic = [d.veiculo.marca, d.veiculo.modelo, d.veiculo.versao].filter(Boolean).join(' ')
  const veiculo: NonNullable<NFeProdutoItem['veiculo']> = {
    tipoOperacao: '0', // 0 = outros (venda de usado, fora de concessionária); confirmar com a contabilidade
    chassi: d.veiculo.chassi,
    descricaoCor: d.veiculo.cor ?? undefined,
    potenciaMotor: d.veiculo.potenciaCv != null ? String(d.veiculo.potenciaCv) : undefined,
    cm3: d.veiculo.cilindradas != null ? String(d.veiculo.cilindradas) : undefined,
    tipoCombustivel: codigoCombustivel(d.veiculo.combustivel) ?? undefined,
    anoModelo: d.veiculo.anoModelo ?? undefined,
    anoFabricacao: d.veiculo.anoFabricacao ?? undefined,
    condicao: '1', // 1 = acabado
    lotacao: d.veiculo.lugares ?? undefined,
  }
  if (d.perfil.veicprodObrigatorioUsado) {
    avisos.push('Perfil exige o grupo veicProd para usado: enviado só com o que o cadastro tem (cor DENATRAN, tipo, espécie, marca/modelo, nº do motor e pesos NÃO existem no cadastro) — a Focus/SEFAZ pode rejeitar.')
  }

  const item: NFeProdutoItem = {
    codigo: d.veiculo.placa || d.veiculo.chassi,
    descricao: nomeVeic || 'Veículo',
    ncm, cfop, unidade: 'UN', quantidade: 1, valorUnitario: valor, valorTotal: valor,
    origem: '0',
    icms,
    pis: { cst: '01', aliquota: d.perfil.pisPct ?? PIS_PADRAO_PRESUMIDO },
    cofins: { cst: '01', aliquota: d.perfil.cofinsPct ?? COFINS_PADRAO_PRESUMIDO },
    ...(temIbsCbs ? {
      ibsCbs: {
        cst: op.ibsCbsCst as string, cClassTrib: op.ibsCbsCClassTrib as string, baseCalculo: valor,
        cbsAliquota: CBS_ALIQUOTA_TESTE_2026, cbsValor,
        ibsUfAliquota: IBS_UF_ALIQUOTA_TESTE_2026, ibsUfValor,
        ibsMunAliquota: IBS_MUN_ALIQUOTA_TESTE_2026, ibsMunValor, ibsValorTotal: ibsValor,
      },
    } : {}),
    // Sem o grupo quando o perfil não exige (usado): RENAVAM/placa/chassi/cor seguem nas Informações Complementares.
    ...(d.perfil.veicprodObrigatorioUsado ? { veiculo } : {}),
  }

  return {
    item,
    observacoes: infComplementarVeiculo(d.veiculo, op.infComplementar),
    naturezaOperacao: (op.naturezaOperacao ?? '').trim() || NATUREZA_PADRAO_VENDA_VEICULO,
    ibsCbsTotais: { baseCalculo: temIbsCbs ? valor : 0, cbsValor: temIbsCbs ? cbsValor : 0, ibsUfValor: temIbsCbs ? ibsUfValor : 0, ibsMunValor: temIbsCbs ? ibsMunValor : 0, ibsValor: temIbsCbs ? ibsValor : 0 },
    avisos,
  }
}

const num = (x: unknown): number | null => (x == null || x === '' ? null : Number(x))

/** Carrega venda + veículo + perfil aprovado (operação 'venda') + título do contas a receber. Service role: a rota já checou a empresa. */
export async function carregarVendaVeiculo(companyId: string, vendaId: string): Promise<DadosVendaVeiculo> {
  const { data: v } = await supabaseAdmin
    .from('veic_venda')
    .select('id, company_id, veiculo_id, numero, cliente_id, valor_venda, situacao, nfe_id, deleted_at')
    .eq('id', vendaId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!v) throw new FiscalError('PAYLOAD_INVALIDO', 'Venda não encontrada nesta empresa')
  if (v.situacao === 'cancelada' || v.situacao === 'devolvida') throw new FiscalError('PAYLOAD_INVALIDO', `Venda ${v.situacao} — não emite NF-e`)
  if (!v.cliente_id) throw new FiscalError('PAYLOAD_INVALIDO', 'Venda sem cliente cadastrado — vincule o cliente (cadastro de clientes do GE) antes de emitir a NF-e')

  const { data: ve } = await supabaseAdmin
    .from('veic_veiculo')
    .select('id, chassi, placa, renavam, marca, modelo, versao, ano_fabricacao, ano_modelo, cor, combustivel, potencia_cv, cilindradas, lugares, km_atual, ncm')
    .eq('id', v.veiculo_id).eq('company_id', companyId).maybeSingle()
  if (!ve) throw new FiscalError('PAYLOAD_INVALIDO', 'Veículo da venda não encontrado')

  const { data: perfil } = await supabaseAdmin
    .from('veic_perfil_fiscal')
    .select('id, veicprod_obrigatorio_usado, ncm_padrao, pis_pct, cofins_pct, icms_saida_pct')
    .eq('company_id', companyId).eq('status', 'aprovado').lte('vigente_desde', new Date().toISOString().slice(0, 10))
    .order('vigente_desde', { ascending: false }).order('versao', { ascending: false }).limit(1).maybeSingle()
  if (!perfil) throw new FiscalError('PAYLOAD_INVALIDO', 'Perfil fiscal da revenda não está aprovado — aprove o perfil fiscal antes de emitir a NF-e')
  const { data: op } = await supabaseAdmin
    .from('veic_perfil_fiscal_operacao')
    .select('cfop_dentro_uf, cfop_fora_uf, cst_ou_csosn, cbenef, reducao_base_icms_pct, ibs_cbs_cst, ibs_cbs_cclasstrib, natureza_operacao, inf_complementar_texto')
    .eq('perfil_id', perfil.id).eq('operacao', 'venda').maybeSingle()
  if (!op) throw new FiscalError('PAYLOAD_INVALIDO', "A operação 'venda' não está configurada no perfil fiscal aprovado — complete o perfil com o contador")

  // Título que a venda JÁ criou no contas a receber do GE (fn_veic__receber → veic_venda_recebimento.receber_id).
  const { data: recs } = await supabaseAdmin
    .from('veic_venda_recebimento').select('tipo, receber_id, valor').eq('venda_id', vendaId).not('receber_id', 'is', null)
  const lista = (recs ?? []) as { tipo: string; receber_id: string; valor: number }[]
  const receberId = (lista.find((r) => r.tipo === 'cliente') ?? lista[0])?.receber_id ?? null

  let nfeStatusAtual: string | null = null
  if (v.nfe_id) {
    const { data: n } = await supabaseAdmin.from('erp_nfe_emitidas').select('status').eq('id', v.nfe_id).maybeSingle()
    nfeStatusAtual = (n as { status?: string } | null)?.status ?? null
  }

  return {
    vendaId, nfeIdAtual: v.nfe_id ?? null, nfeStatusAtual,
    valorVenda: Number(v.valor_venda ?? 0), numeroVenda: v.numero ?? null,
    clienteId: v.cliente_id, receberId,
    veiculo: {
      id: ve.id, chassi: ve.chassi, placa: ve.placa, renavam: ve.renavam, marca: ve.marca, modelo: ve.modelo, versao: ve.versao,
      anoFabricacao: ve.ano_fabricacao, anoModelo: ve.ano_modelo, cor: ve.cor, combustivel: ve.combustivel,
      potenciaCv: num(ve.potencia_cv), cilindradas: num(ve.cilindradas), lugares: ve.lugares, kmAtual: num(ve.km_atual), ncm: ve.ncm,
    },
    perfil: {
      veicprodObrigatorioUsado: perfil.veicprod_obrigatorio_usado === true,
      ncmPadrao: perfil.ncm_padrao ?? null, pisPct: num(perfil.pis_pct), cofinsPct: num(perfil.cofins_pct), icmsSaidaPct: num(perfil.icms_saida_pct),
      operacao: {
        cfopDentroUf: op.cfop_dentro_uf, cfopForaUf: op.cfop_fora_uf, cstOuCsosn: op.cst_ou_csosn, cbenef: op.cbenef ?? null,
        reducaoBasePct: num(op.reducao_base_icms_pct), ibsCbsCst: op.ibs_cbs_cst ?? null, ibsCbsCClassTrib: op.ibs_cbs_cclasstrib ?? null,
        naturezaOperacao: op.natureza_operacao ?? null, infComplementar: op.inf_complementar_texto ?? null,
      },
    },
  }
}

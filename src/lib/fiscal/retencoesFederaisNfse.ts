// #286 · Retenções federais e PIS/COFINS da NFS-e Nacional — UMA conta só, usada pela tela (conferência antes de
// emitir) e pela rota (o que vai para a Focus, o que fica gravado na nota e o que o título usa). Nota e título nunca
// divergem porque os dois leem daqui.
//
// Fontes (RD-72), conferidas em 28/09 — duas batendo:
//  • Focus, NFS-e Nacional (campos.focusnfe.com.br/nfse_nacional/EmissaoDPSXml.html):
//      valor_cp → vRetCP "Valor monetário do CP (R$)" (Contribuição Previdenciária = INSS retido)
//      valor_irrf → vRetIRRF "Valor monetário (R$) do IRRF retido"
//      valor_csll → vRetCSLL "agrupa a soma dos impostos PIS, COFINS e CSLL retidos" (unificados na Reforma)
//      tipo_retencao_pis_cofins → tpRetPisCofins 0..9
//      situacao_tributaria_pis_cofins/base_calculo_pis_cofins/aliquota_pis/aliquota_cofins/valor_pis/valor_cofins
//        → apuração PRÓPRIA do prestador (vPis/vCofins)
//  • Receita, ANEXO_I-SEFIN_ADN-DPS_NFSe-SNNFSe-v1.01-20260209, aba "LEIAUTE DPS_NFS-e": linhas 314 (CST),
//    318/319 (vPis/vCofins próprios), 320 (tpRetPisCofins: "Indica quais contribuições retidas na fonte compõem
//    o campo vRetCSLL"), 321 (vRetCP), 322 (vRetIRRF), 323 (vRetCSLL).
//  Regras de rejeição cobertas (aba "RN DPS_NFS-e"): E0699 (vRetCP > 0 e < valor do serviço), E0700 (vRetIRRF
//  idem), E0720 (tpRetPisCofins = 0 proíbe vRetCSLL), E0694/E0696 (vPis/vCofins = base × alíquota).

export interface ServicoTributosFederais {
  retem_inss?: boolean | null; aliquota_inss?: number | null
  retem_ir?: boolean | null; aliquota_ir?: number | null
  retem_pis?: boolean | null; aliquota_pis?: number | null
  retem_cofins?: boolean | null; aliquota_cofins?: number | null
  retem_csll?: boolean | null; aliquota_csll?: number | null
  cst_pis_cofins?: string | null
}

export interface RetencoesFederaisNfse {
  valorCp: number          // INSS retido (vRetCP)
  valorIrrf: number        // IRRF retido (vRetIRRF)
  valorPisRet: number
  valorCofinsRet: number
  valorCsllRet: number
  valorRetCsllAgrupado: number   // vRetCSLL = PIS + COFINS + CSLL retidos
  tipoRetencaoPisCofins: number  // tpRetPisCofins 0..9
  totalRetido: number
  apuracaoPropria: { cst: string; base: number; aliqPis: number; aliqCofins: number; valorPis: number; valorCofins: number } | null
  erros: string[]          // impedem a emissão (a nota seria rejeitada)
  avisos: string[]         // a nota sai, mas sem o grupo indicado
}

import type { NFSeRequest } from './types'

const cent = (n: number) => Math.round(n * 100) / 100
const pct = (v: number | null | undefined) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)

// tpRetPisCofins (tabela oficial): 0 nenhum · 3 PIS/COFINS/CSLL · 4 PIS/COFINS · 5 só PIS · 6 só COFINS ·
// 7 COFINS/CSLL · 8 só CSLL · 9 PIS/CSLL. (1 e 2 são os códigos antigos sem a CSLL — não usamos.)
export function tipoRetencaoPisCofins(pis: boolean, cofins: boolean, csll: boolean): number {
  const k = `${pis ? 1 : 0}${cofins ? 1 : 0}${csll ? 1 : 0}`
  return ({ '000': 0, '111': 3, '110': 4, '100': 5, '010': 6, '011': 7, '001': 8, '101': 9 } as Record<string, number>)[k]
}

export function calcularRetencoesFederais(valorServico: number, s: ServicoTributosFederais | null | undefined): RetencoesFederaisNfse {
  const v = cent(Number(valorServico) || 0)
  const erros: string[] = []
  const avisos: string[] = []
  const sv = s ?? {}

  const valorCp = sv.retem_inss ? cent(v * pct(sv.aliquota_inss) / 100) : 0
  const valorIrrf = sv.retem_ir ? cent(v * pct(sv.aliquota_ir) / 100) : 0
  const retPis = !!sv.retem_pis && pct(sv.aliquota_pis) > 0
  const retCofins = !!sv.retem_cofins && pct(sv.aliquota_cofins) > 0
  const retCsll = !!sv.retem_csll && pct(sv.aliquota_csll) > 0
  const valorPisRet = retPis ? cent(v * pct(sv.aliquota_pis) / 100) : 0
  const valorCofinsRet = retCofins ? cent(v * pct(sv.aliquota_cofins) / 100) : 0
  const valorCsllRet = retCsll ? cent(v * pct(sv.aliquota_csll) / 100) : 0
  const tipo = tipoRetencaoPisCofins(retPis, retCofins, retCsll)
  // E0720: tipo 0 proíbe vRetCSLL — agrupado só existe quando algo é retido
  const valorRetCsllAgrupado = tipo === 0 ? 0 : cent(valorPisRet + valorCofinsRet + valorCsllRet)

  if (sv.retem_inss && valorCp <= 0) erros.push('O serviço marca retenção de INSS, mas sem alíquota — corrija em Cadastros › Serviços.')
  if (sv.retem_ir && valorIrrf <= 0) erros.push('O serviço marca retenção de IR, mas sem alíquota — corrija em Cadastros › Serviços.')
  if ((sv.retem_pis && !retPis) || (sv.retem_cofins && !retCofins) || (sv.retem_csll && !retCsll)) {
    erros.push('O serviço marca retenção de PIS/COFINS/CSLL, mas sem alíquota — corrija em Cadastros › Serviços.')
  }
  // E0699 / E0700: retenção tem de ser menor que o valor do serviço
  if (valorCp > 0 && valorCp >= v) erros.push('O INSS retido não pode ser igual ou maior que o valor do serviço.')
  if (valorIrrf > 0 && valorIrrf >= v) erros.push('O IR retido não pode ser igual ou maior que o valor do serviço.')

  // Grupo piscofins da DPS (linhas 314–323): tpRetPisCofins e vRetCSLL moram DENTRO dele, e o grupo exige o CST
  // (linha 314, 1-1). Então: retenção de PIS/COFINS/CSLL sem CST no cadastro NÃO pode ir — bloqueia (a nota
  // sairia de novo sem a retenção, que é justamente o #286). INSS e IR (vRetCP/vRetIRRF) não dependem do CST.
  const cst = String(sv.cst_pis_cofins ?? '').trim()
  const temCst = /^\d{2}$/.test(cst)
  if (tipo > 0 && !temCst) {
    erros.push('Falta o CST do PIS/COFINS no cadastro do serviço — ele é obrigatório para informar PIS/COFINS/CSLL retidos na nota.')
  }
  // Apuração PRÓPRIA de PIS/COFINS (vPis/vCofins = base × alíquota — E0694/E0696): só com CST. Sem CST o grupo
  // não vai — a nota sai com as retenções (INSS/IR) e com aviso (decisão do CEO 28/09).
  let apuracaoPropria: RetencoesFederaisNfse['apuracaoPropria'] = null
  const aliqPis = pct(sv.aliquota_pis)
  const aliqCofins = pct(sv.aliquota_cofins)
  if (aliqPis > 0 || aliqCofins > 0) {
    if (temCst) {
      apuracaoPropria = { cst, base: v, aliqPis, aliqCofins, valorPis: cent(v * aliqPis / 100), valorCofins: cent(v * aliqCofins / 100) }
    } else if (tipo === 0) {
      avisos.push('PIS/COFINS de apuração própria não vai nesta nota: falta o CST do PIS/COFINS no cadastro do serviço.')
    }
  }

  const totalRetido = cent(valorCp + valorIrrf + valorPisRet + valorCofinsRet + valorCsllRet)
  return { valorCp, valorIrrf, valorPisRet, valorCofinsRet, valorCsllRet, valorRetCsllAgrupado, tipoRetencaoPisCofins: tipo, totalRetido, apuracaoPropria, erros, avisos }
}

// IBS/CBS (grupo IBSCBS da DPS): CST, cClassTrib e cIndOp (6 dígitos, tabela do Anexo C — E0901) são obrigatórios.
// Sem cIndOp válido o grupo NÃO vai (a nota sai, com aviso) — nunca adivinhar o código.
export function codigoIndicadorOperacaoValido(c: string | null | undefined): boolean {
  return /^\d{6}$/.test(String(c ?? '').trim())
}

export type ReformaNfse = NonNullable<NFSeRequest['reforma']>
export interface ServicoIbsCbs { rt_cst?: string | null; rt_classificacao_tributaria?: string | null; rt_indicador_operacao?: string | null }

// IBS/CBS do CADASTRO DO SERVIÇO quando a empresa não configurou (a config da empresa manda). Usada pela rota e pela
// prova do #286 (gabarito NF 418) — a mesma regra nos dois lugares. finNFSe/indFinal/indDest: 0 quando a empresa não
// definiu (finNFSe 0 = NFS-e regular, único valor; 0/0 como na NF 418 autorizada).
export function reformaIbsCbsDoServico(empresa: ReformaNfse | undefined, sv: ServicoIbsCbs | null | undefined): { reforma: ReformaNfse | undefined; aviso: string | null } {
  if (empresa?.ibsCbsCst || !sv?.rt_cst || !sv.rt_classificacao_tributaria) return { reforma: empresa, aviso: null }
  if (!codigoIndicadorOperacaoValido(sv.rt_indicador_operacao)) {
    return { reforma: empresa, aviso: 'IBS/CBS não vai nesta nota: falta o código indicador da operação (cIndOp) no cadastro do serviço.' }
  }
  return {
    reforma: {
      finalidadeEmissao: empresa?.finalidadeEmissao ?? 0,
      consumidorFinal: empresa?.consumidorFinal ?? 0,
      indicadorDestinatario: empresa?.indicadorDestinatario ?? 0,
      ibsCbsCst: String(sv.rt_cst), ibsCbsClassifTrib: String(sv.rt_classificacao_tributaria),
      codigoIndicadorOperacao: String(sv.rt_indicador_operacao).trim(),
    },
    aviso: null,
  }
}

// ISS retido pelo tomador/intermediário (tpRetISSQN 2/3): valor × alíquota da nota, em centavos. Sem retenção (1) ou
// sem alíquota → 0. Mesma conta do Ambiente Nacional (XML da NF 421: vISSQN = vBC × pAliqAplic; vTotalRet inclui o ISS).
// A rota grava em valor_iss_retido e o "Gerar financeiro" nasce com ele (nota e título com o mesmo líquido).
export function issRetidoNfse(valorServico: number, tipoRetencaoIss: number | null | undefined, aliquotaIss: number | null | undefined): number {
  const tp = Number(tipoRetencaoIss) || 1
  const aliq = Number(aliquotaIss)
  if (!(tp === 2 || tp === 3) || !Number.isFinite(aliq) || aliq <= 0) return 0
  return cent((Number(valorServico) || 0) * aliq / 100)
}

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

// #339 (R.R, reaberto 01/10) · retenções AJUSTADAS NA NOTA. O cadastro do serviço é o ponto de partida, mas a
// retenção muda de tomador para tomador com o mesmo serviço (ex.: prestador do Simples faturando para outro CNPJ).
// O modal edita uma cópia por nota; a rota aplica a MESMA cópia sobre o cadastro e faz a mesma conta
// (calcularRetencoesFederais) — nota e título continuam batendo. O CST do PIS/COFINS segue do cadastro.
export interface RetencoesNota {
  iss_retido: boolean
  retem_inss: boolean; aliquota_inss: number
  retem_ir: boolean; aliquota_ir: number
  retem_pis: boolean; aliquota_pis: number
  retem_cofins: boolean; aliquota_cofins: number
  retem_csll: boolean; aliquota_csll: number
}
export const TRIBUTOS_RETENCAO = ['inss', 'ir', 'pis', 'cofins', 'csll'] as const
export type TributoRetencao = typeof TRIBUTOS_RETENCAO[number]

export function retencoesNotaDoCadastro(sv: (ServicoTributosFederais & { iss_retido?: boolean | null }) | null | undefined): RetencoesNota {
  const s = sv ?? {}
  return {
    iss_retido: !!s.iss_retido,
    retem_inss: !!s.retem_inss, aliquota_inss: pct(s.aliquota_inss),
    retem_ir: !!s.retem_ir, aliquota_ir: pct(s.aliquota_ir),
    retem_pis: !!s.retem_pis, aliquota_pis: pct(s.aliquota_pis),
    retem_cofins: !!s.retem_cofins, aliquota_cofins: pct(s.aliquota_cofins),
    retem_csll: !!s.retem_csll, aliquota_csll: pct(s.aliquota_csll),
  }
}

/** Retenção desmarcada na nota mantém a alíquota do cadastro (ela também serve à apuração própria do PIS/COFINS). */
export function aplicarRetencoesNota<T extends ServicoTributosFederais>(sv: T | null | undefined, nota: RetencoesNota): T & { iss_retido: boolean } {
  const base = (sv ?? {}) as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>), iss_retido: !!nota.iss_retido }
  for (const k of TRIBUTOS_RETENCAO) {
    const retem = !!nota[`retem_${k}`]
    out[`retem_${k}`] = retem
    if (retem) out[`aliquota_${k}`] = pct(nota[`aliquota_${k}`])
  }
  return out as unknown as T & { iss_retido: boolean }
}

export function retencoesNotaIguais(a: RetencoesNota, b: RetencoesNota): boolean {
  if (!!a.iss_retido !== !!b.iss_retido) return false
  return TRIBUTOS_RETENCAO.every((k) => !!a[`retem_${k}`] === !!b[`retem_${k}`]
    && (!a[`retem_${k}`] || pct(a[`aliquota_${k}`]) === pct(b[`aliquota_${k}`])))
}

/** Corpo vindo do cliente: só booleanos e alíquotas 0–100; qualquer outra coisa → null (a rota recusa). */
export function lerRetencoesNota(x: unknown): RetencoesNota | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  if (typeof o.iss_retido !== 'boolean') return null
  const r: Record<string, unknown> = { iss_retido: o.iss_retido }
  for (const k of TRIBUTOS_RETENCAO) {
    const retem = o[`retem_${k}`]; const aliq = Number(o[`aliquota_${k}`] ?? 0)
    if (typeof retem !== 'boolean' || !Number.isFinite(aliq) || aliq < 0 || aliq >= 100) return null
    r[`retem_${k}`] = retem; r[`aliquota_${k}`] = aliq
  }
  return r as unknown as RetencoesNota
}

/**
 * "Sugerir" (CEO 01/10): considera o regime de QUEM EMITE e o tipo do tomador.
 *  • Tomador pessoa física não retém nada (nem ISS).
 *  • Prestador do Simples Nacional, em regra, não sofre retenção de IR, PIS, COFINS e CSLL; o ISS, quando retido,
 *    vai pela alíquota efetiva do Simples da competência (a rota já usa essa alíquota). INSS e ISS seguem o cadastro.
 *  • Demais casos: o cadastro do serviço.
 */
export function sugerirRetencoesNota(p: {
  cadastro: (ServicoTributosFederais & { iss_retido?: boolean | null }) | null | undefined
  prestadorSimples: boolean
  tomadorPJ: boolean
}): { nota: RetencoesNota; motivo: string } {
  const cad = retencoesNotaDoCadastro(p.cadastro)
  if (!p.tomadorPJ) {
    return {
      nota: { ...cad, iss_retido: false, retem_inss: false, retem_ir: false, retem_pis: false, retem_cofins: false, retem_csll: false },
      motivo: 'Tomador pessoa física não retém impostos: nenhuma retenção nesta nota.',
    }
  }
  if (p.prestadorSimples) {
    return {
      nota: { ...cad, retem_ir: false, retem_pis: false, retem_cofins: false, retem_csll: false },
      motivo: 'Prestador do Simples Nacional: em regra sem retenção de IR, PIS, COFINS e CSLL. INSS e ISS retido seguem o cadastro do serviço; o ISS retido usa a alíquota efetiva do Simples do mês.',
    }
  }
  return { nota: cad, motivo: 'Retenções do cadastro do serviço.' }
}

// #339 (R.R) · trava de emissão, a mesma em TODAS as telas (a rota aplica; o modal mostra antes):
//  1) toda NFS-e sai de um serviço do cadastro — é dele que vêm as retenções federais e o ISS retido. Sem serviço,
//     a nota sairia sem nenhuma retenção, calada (o buraco do #286 por outro caminho).
//  2) o padrão MUNICIPAL ainda não leva as retenções do cadastro para a nota: serviço com retenção só emite pelo
//     padrão nacional. Hoje todas as empresas emissoras estão em município aderido; a trava cobre o dia em que não.
export const MSG_EXIGE_SERVICO_NFSE = 'Escolha o serviço cadastrado para emitir: as retenções (INSS, IR, PIS, COFINS, CSLL) e o ISS retido vêm do cadastro do serviço.'
export const MSG_RETENCAO_SO_NACIONAL = 'Este serviço tem retenção no cadastro, mas o município do prestador emite pelo padrão municipal, que ainda não leva as retenções para a nota. A emissão fica travada para a nota não sair sem elas — fale com o suporte PS.'
export function travaEmissaoNfse(p: {
  servicoId?: string | null
  padraoNacional: boolean
  servico?: (ServicoTributosFederais & { iss_retido?: boolean | null }) | null
  valor: number
}): string | null {
  if (!p.servicoId) return MSG_EXIGE_SERVICO_NFSE
  if (!p.padraoNacional && p.servico) {
    const r = calcularRetencoesFederais(p.valor, p.servico)
    if (r.totalRetido > 0 || !!p.servico.iss_retido) return MSG_RETENCAO_SO_NACIONAL
  }
  return null
}

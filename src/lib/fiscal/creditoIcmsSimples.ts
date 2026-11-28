// #2876 · Crédito de ICMS do Simples Nacional na NF-e (LC 123/2006 art. 23; CSOSN 101 com pCredSN/vCredICMSSN).
// Regras puras, usadas pelo nfe-builder e conferidas por gate. Opt-in POR EMPRESA: só vale quando a empresa do Simples
// optou por transferir o crédito (alíquota de crédito cadastrada na Configuração Fiscal, informada pelo contador).
// Sem opt-in, o CSOSN não muda; a frase do Simples (TEXTO_SIMPLES) sai em toda nota do Simples, com ou sem crédito
// (ajuste Jordana 20/10).
//
// Quando vale o crédito (todas ao mesmo tempo): emitente do Simples · OPTOU pelo crédito · alíquota do crédito da
// COMPETÊNCIA da nota > 0 · destinatário CONTRIBUINTE (indIEDest = 1) · NÃO é consumidor final · nota de finalidade
// normal (devolução tem regra própria). Item com CSOSN 101 ou 102 → sai 101 com o crédito. Fora dessas condições,
// um 101 do cadastro sai 102 (101 sem pCredSN é rejeitado pela SEFAZ, e o cliente pediu 102 para consumidor final).
//
// #11424 · A alíquota do crédito passou a ser MENSAL (por competência). `optouCredito` separa a ESCOLHA da empresa
// (flag, do provider_config) do VALOR do mês (`aliquota`, lido de erp_fiscal_aliquota_sn na competência da nota).
// Empresa que optou mas SEM crédito lançado na competência → emite 102 (sem usar valor de outro mês) e dispara o
// alerta de desatualização (faltaCreditoCompetenciaSN). `optouCredito` ausente = deriva da alíquota (compatível com
// o comportamento anterior à competência, quando o valor chapado valia como opt-in).

export const ALIQUOTA_CREDITO_SN_MAX = 5 // maior parcela de ICMS das faixas do Simples (Anexo I/II) fica abaixo disso

export type CondicaoCreditoSN = {
  ehSimples: boolean
  aliquota: number | null | undefined
  indIEDest: number | null | undefined
  consumidorFinal: boolean
  finalidade: string
  /** #11424 · a empresa optou por transferir o crédito (provider_config.aliquota_credito_icms_sn > 0). Ausente →
   * derivado da alíquota (compat). O VALOR do crédito é `aliquota` (da competência da nota), não este flag. */
  optouCredito?: boolean | null
}

export function aliquotaCreditoValida(a: number | null | undefined): a is number {
  return typeof a === 'number' && Number.isFinite(a) && a > 0 && a <= ALIQUOTA_CREDITO_SN_MAX
}

/** Empresa optou pelo crédito (Simples + opt-in): as frases do Simples entram nas Informações Complementares. */
export function empresaComCreditoSN(c: Pick<CondicaoCreditoSN, 'ehSimples' | 'aliquota' | 'optouCredito'>): boolean {
  const optou = c.optouCredito ?? aliquotaCreditoValida(c.aliquota) // compat: sem o flag, deriva da alíquota
  return c.ehSimples && optou
}

export function aplicaCreditoSN(c: CondicaoCreditoSN): boolean {
  // Exige a alíquota da COMPETÊNCIA válida, além do opt-in: empresa que optou mas sem crédito do mês → NÃO aplica (102).
  return empresaComCreditoSN(c) && aliquotaCreditoValida(c.aliquota) && c.indIEDest === 1 && c.consumidorFinal === false && c.finalidade === 'normal'
}

/** #11424 · A empresa optou pelo crédito e a nota CARREGARIA crédito (contribuinte, não consumidor final, normal), mas
 * NÃO há crédito lançado para a competência da nota → alerta de desatualização (a nota sai 102, sem crédito deste mês).
 * Usa o opt-in EXPLÍCITO (não derivado): só alerta empresa que de fato optou. Nota 102/empresa sem opt-in → nunca. */
export function faltaCreditoCompetenciaSN(c: CondicaoCreditoSN): boolean {
  return c.ehSimples && c.optouCredito === true && c.indIEDest === 1 && c.consumidorFinal === false
    && c.finalidade === 'normal' && !aliquotaCreditoValida(c.aliquota)
}

/** CSOSN final do item. Só mexe em 101/102 e só para empresa que optou; o resto sai como está no cadastro. */
export function csosnDoItem(csosn: string | undefined, c: CondicaoCreditoSN): string | undefined {
  if (!empresaComCreditoSN(c) || (csosn !== '101' && csosn !== '102')) return csosn
  return aplicaCreditoSN(c) ? '101' : '102'
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** vCredICMSSN = valor da operação do item × pCredSN. */
export function valorCreditoSN(valorItem: number, aliquota: number): number {
  return r2(Math.max(0, valorItem) * aliquota / 100)
}

const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const TEXTO_SIMPLES =
  'DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL; NÃO GERA DIREITO A CRÉDITO FISCAL DE IPI.'

export function textoCreditoSN(valor: number, aliquota: number): string {
  return `PERMITE O APROVEITAMENTO DO CRÉDITO DE ICMS NO VALOR DE R$ ${brl(valor)} CORRESPONDENTE À ALÍQUOTA DE ${brl(aliquota)}%, NOS TERMOS DO ART. 23 DA LEI COMPLEMENTAR Nº 123/2006.`
}

/** Junta as frases do Simples às observações da nota, sem duplicar se já estiverem lá. */
export function observacoesComSimples(obs: string | undefined, creditoTotal: number | null, aliquota: number): string {
  const partes = [(obs ?? '').trim()].filter(Boolean)
  const tem = (t: string) => partes.join(' ').toUpperCase().includes(t)
  if (!tem('OPTANTE PELO SIMPLES NACIONAL')) partes.push(TEXTO_SIMPLES)
  if (creditoTotal != null && creditoTotal > 0 && !tem('APROVEITAMENTO DO CRÉDITO DE ICMS')) partes.push(textoCreditoSN(creditoTotal, aliquota))
  return partes.join(' | ')
}

// #2876 · Crédito de ICMS do Simples Nacional na NF-e (LC 123/2006 art. 23; CSOSN 101 com pCredSN/vCredICMSSN).
// Regras puras, usadas pelo nfe-builder e conferidas por gate. Opt-in POR EMPRESA: só vale quando a empresa do Simples
// tem a alíquota do crédito cadastrada na Configuração Fiscal (informada pelo contador). Sem alíquota, o CSOSN não muda;
// a frase do Simples (TEXTO_SIMPLES) sai em toda nota do Simples, com ou sem alíquota (ajuste Jordana 20/10).
//
// Quando vale o crédito (todas ao mesmo tempo): emitente do Simples · alíquota cadastrada > 0 · destinatário
// CONTRIBUINTE (indIEDest = 1) · NÃO é consumidor final · nota de finalidade normal (devolução tem regra própria).
// Item com CSOSN 101 ou 102 → sai 101 com o crédito. Fora dessas condições, um 101 do cadastro sai 102 (101 sem
// pCredSN é rejeitado pela SEFAZ, e o cliente pediu 102 para consumidor final).

export const ALIQUOTA_CREDITO_SN_MAX = 5 // maior parcela de ICMS das faixas do Simples (Anexo I/II) fica abaixo disso

export type CondicaoCreditoSN = {
  ehSimples: boolean
  aliquota: number | null | undefined
  indIEDest: number | null | undefined
  consumidorFinal: boolean
  finalidade: string
}

export function aliquotaCreditoValida(a: number | null | undefined): a is number {
  return typeof a === 'number' && Number.isFinite(a) && a > 0 && a <= ALIQUOTA_CREDITO_SN_MAX
}

/** Empresa optou (Simples + alíquota cadastrada): as frases do Simples entram nas Informações Complementares. */
export function empresaComCreditoSN(c: Pick<CondicaoCreditoSN, 'ehSimples' | 'aliquota'>): boolean {
  return c.ehSimples && aliquotaCreditoValida(c.aliquota)
}

export function aplicaCreditoSN(c: CondicaoCreditoSN): boolean {
  return empresaComCreditoSN(c) && c.indIEDest === 1 && c.consumidorFinal === false && c.finalidade === 'normal'
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

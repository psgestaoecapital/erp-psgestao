// ═══════════════════════════════════════════════════════════════════════════
// Guarda de sanidade do ANO de competência — PDCA GE · DRE Consolidado (RD-38).
//
// Motivo (provado no dado): títulos reais entraram com `data_competencia` em ano
// impossível (ex.: '0002-08-11' no lugar de '2026-08-11'), por erro de digitação
// no seletor de ano do campo de data. Efeito ao usuário: a receita/despesa some do
// mês certo e fica "estacionada" num ano fantasma — o DRE daquele mês mente para
// menos, sem nenhum aviso. A aritmética da soma está certa; o defeito é LIXO DE
// DATA na fonte que a tela não defendia.
//
// Correção durável: barrar na ENTRADA (formulários de contas a receber/pagar), com
// mensagem em linguagem do usuário, para um ano fora da faixa sã nunca mais
// parquear dinheiro num período inexistente. Aditivo: só valida, não altera dado.
// ═══════════════════════════════════════════════════════════════════════════

/** Menor ano aceito para competência (antes disso é digitação errada, não operação viva). */
export const ANO_COMPETENCIA_MIN = 2000

/** Maior ano aceito = ano atual + folga, para lançamentos futuros legítimos. */
export const FOLGA_ANOS_FUTURO = 5

/** Teto do ano de competência relativo a `hoje`. */
export function anoCompetenciaMax(hoje: Date = new Date()): number {
  return hoje.getFullYear() + FOLGA_ANOS_FUTURO
}

/**
 * Valida o ANO de uma data de competência vinda de um `<input type="date">`
 * (formato "YYYY-MM-DD"). Competência é opcional, então vazio → sem erro.
 *
 * @returns mensagem em linguagem do usuário quando o ano está fora da faixa sã
 *          [ANO_COMPETENCIA_MIN, anoCompetenciaMax()]; `null` quando está OK ou
 *          quando a string não traz um ano avaliável (outras validações/HTML cuidam).
 */
export function validarAnoCompetencia(
  dataCompetencia: string | null | undefined,
  hoje: Date = new Date(),
): string | null {
  if (!dataCompetencia) return null
  const ano = Number(String(dataCompetencia).slice(0, 4))
  // Data malformada / sem ano (ex.: "") → não é papel desta guarda; deixa passar.
  if (!Number.isFinite(ano) || ano === 0) return null
  const max = anoCompetenciaMax(hoje)
  if (ano < ANO_COMPETENCIA_MIN || ano > max) {
    return `A competência tem um ano fora do comum (${ano}) — confira a data.`
  }
  return null
}

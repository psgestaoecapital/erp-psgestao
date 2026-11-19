// Guarda de faixa de competência (data_competencia) — barra na ENTRADA.
//
// PORQUÊ: um erro de digitação no ANO da competência (ex.: "0002", "0226",
// "20026") "estaciona" o título num ano fantasma. O DRE só olha anos sãos
// (o seletor vai de 2024 a ano_atual+1), então essa receita/despesa SOME do
// mês certo e o DRE passa a mentir para menos. Foi o caso real do cliente Gean
// (R$903,84 de ago/2026 presos no "ano 2"). A correção durável é NÃO deixar o
// ano absurdo entrar: aqui, na tela, com mensagem em linguagem do usuário; e,
// como rede de segurança para qualquer outra via (import/ETL), um CHECK no
// banco (chk_competencia_sana em erp_receber/erp_pagar).

// Piso fixo da competência. Nenhum lançamento são deste ERP é anterior a 2000.
// Espelha o limite inferior do CHECK no banco (DATE '2000-01-01').
export const COMPETENCIA_ANO_MIN = 2000

// Teto dinâmico: ano atual + 5. Cobre provisões/competências futuras legítimas
// sem deixar passar um "20026". (O CHECK no banco usa o teto fixo 2100, que é
// mais frouxo de propósito — a mensagem amigável e o limite apertado ficam aqui.)
export function competenciaAnoMax(hoje: Date = new Date()): number {
  return hoje.getFullYear() + 5
}

/**
 * Valida a competência (data ISO 'YYYY-MM-DD'). Retorna uma mensagem amigável
 * em pt-BR quando o ANO está fora da faixa sã [2000 .. ano_atual+5], ou `null`
 * quando está OK. Vazio/nulo é OK (o formulário aplica o default — vencimento
 * ou recebimento — antes de gravar; o chamador deve validar a competência
 * EFETIVA, isto é, `dataCompetencia || dataVencimento/recebimento`).
 */
export function validarCompetencia(iso: string | null | undefined, hoje: Date = new Date()): string | null {
  if (!iso) return null
  const m = /^(\d{1,6})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null // formato inesperado: não é o nosso erro de ano a tratar aqui
  const ano = parseInt(m[1], 10)
  const max = competenciaAnoMax(hoje)
  if (ano < COMPETENCIA_ANO_MIN || ano > max) {
    return `A competência tem um ano fora do comum (${m[1]}) — confira a data (esperado entre ${COMPETENCIA_ANO_MIN} e ${max}).`
  }
  return null
}

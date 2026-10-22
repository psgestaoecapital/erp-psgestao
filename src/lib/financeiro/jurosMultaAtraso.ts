// Chamado #2254 · Renegociação: juros de mora e multa do título vencido, calculados com a taxa do banco emissor
// (erp_banco_provider_config.juros_pct / multa_pct / dias_juros / dias_multa). Puro — sem rede, usado pela tela e pelo gate.
//   multa = valor × multa_pct% (uma vez)        · juros = valor × juros_pct% ao mês ÷ 30 × dias de atraso
// Carência (dias_multa / dias_juros): o encargo só vale a partir desse dia de atraso; nulo = a partir do 1º dia.
// Taxa nula NUNCA vira taxa padrão em silêncio: devolve 0 e `semTaxa` para a tela avisar.

export type TaxaAtraso = { juros_pct: number | null; multa_pct: number | null; dias_juros: number | null; dias_multa: number | null }
export type EncargoAtraso = { dias: number; juros: number; multa: number }

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

// dias corridos entre duas datas ISO (yyyy-mm-dd), em UTC (sem efeito de fuso/horário de verão). Nunca negativo.
export function diasDeAtraso(vencimentoISO: string, hojeISO: string): number {
  const p = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) }
  return Math.max(0, Math.round((p(hojeISO) - p(vencimentoISO)) / 86_400_000))
}

export function semTaxaCadastrada(t: TaxaAtraso | null): boolean {
  return !t || (t.juros_pct == null && t.multa_pct == null)
}

export function encargosDoTitulo(valor: number, vencimentoISO: string, hojeISO: string, t: TaxaAtraso | null): EncargoAtraso {
  const dias = diasDeAtraso(vencimentoISO, hojeISO)
  if (dias <= 0 || !t) return { dias, juros: 0, multa: 0 }
  const v = Number(valor) || 0
  const multa = t.multa_pct != null && dias >= Math.max(1, t.dias_multa ?? 1) ? round2(v * Number(t.multa_pct) / 100) : 0
  const juros = t.juros_pct != null && dias >= Math.max(1, t.dias_juros ?? 1) ? round2(v * Number(t.juros_pct) / 100 / 30 * dias) : 0
  return { dias, juros, multa }
}

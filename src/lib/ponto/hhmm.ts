// hhmmParaDecimal — converte "HH:MM" (jornada de ponto) em horas decimais.
// Aceita > 24h ("36:37" = 36.62) e negativo ("-01:30" = -1.5).
//
// FONTE UNICA (extraido de iopoint.ts no PR do Painel de Jornada): usado tanto
// pelo adapter IO Point no ingest (worked_time -> total_horas) quanto pelo
// drill-down do BI de ponto (PontoView -> 37 campos por colaborador). O
// equivalente SQL vive em fn_hhmm_decimal (usado por fn_ponto_bi_agregado).
export function hhmmParaDecimal(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v !== 'string' || v.trim() === '') return 0
  if (v.includes(':')) {
    const partes = v.split(':').map((x) => Number(x) || 0)
    const h = partes[0] ?? 0
    const m = partes[1] ?? 0
    // sinal negativo em HH:MM (ex "-01:30") aplica ao conjunto
    const sinal = v.trim().startsWith('-') ? -1 : 1
    return sinal * (Math.abs(h) + m / 60)
  }
  return Number(v) || 0
}

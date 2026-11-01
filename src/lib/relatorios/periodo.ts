// #3281 etapa 4 — meses (aproximados) entre duas datas AAAA-MM-DD; usado no destaque do botão "Gerar em segundo plano"
// quando o período é longo (é aí que gerar na hora faz esperar).
export function mesesNoPeriodo(ini: string, fim: string): number {
  const a = new Date(`${ini}T00:00:00Z`).getTime()
  const b = new Date(`${fim}T00:00:00Z`).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0
  return (b - a) / (1000 * 60 * 60 * 24 * 30.44)
}

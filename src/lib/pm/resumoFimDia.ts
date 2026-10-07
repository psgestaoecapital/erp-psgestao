// PM-T (4d) · resumo de fim do dia: jobs em que a pessoa agiu hoje (comentário) e não apontou horas (regra pura, sem rede).
export const HORA_RESUMO = 16
export type AcaoDia = { job_id: string }
export type LinhaDia = { job_id: string | null }

export const horaSP = (agora: Date) => Number(agora.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" }))
export const horaDoResumo = (agora: Date = new Date()) => horaSP(agora) >= HORA_RESUMO

// Sugestões = jobs com ação hoje que ainda não têm nenhuma linha de horas hoje (sem repetir o job).
export function sugestoesDoDia(acoes: AcaoDia[], horas: LinhaDia[]): string[] {
  const comHoras = new Set(horas.map((h) => h.job_id).filter(Boolean))
  return [...new Set(acoes.map((a) => a.job_id))].filter((j) => !comHoras.has(j))
}

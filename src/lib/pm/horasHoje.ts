// PM-T (4b) · "horas de hoje" no Meu dia: soma o apontado do dia + o cronômetro aberto (regra pura, sem rede).
export const META_DIA_HORAS = 8
export type LinhaHoras = { horas: number | null; inicio_em: string | null; fim_em: string | null }

// Linha fechada conta as horas gravadas; linha aberta (fim_em vazio) conta o tempo corrido até agora.
export function horasDeHoje(linhas: LinhaHoras[], agora: Date = new Date()): number {
  const total = linhas.reduce((s, l) => {
    if (!l.fim_em && l.inicio_em) return s + Math.max(0, (agora.getTime() - new Date(l.inicio_em).getTime()) / 3_600_000)
    return s + Number(l.horas ?? 0)
  }, 0)
  return Number(total.toFixed(2))
}
export const percentualDoDia = (h: number, meta = META_DIA_HORAS) => Math.min(100, Math.round((h / meta) * 100))

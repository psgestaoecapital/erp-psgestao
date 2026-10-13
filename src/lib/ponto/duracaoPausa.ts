// #272 (Frioeste · SST) · Duração de uma pausa, em segundos — a MESMA regra de fn_nr36_duracao_seg (banco), usada na
// classificação e na apuração. O relatório traz a duração com segundos (19:25 = 1165 s) e os horários só com minutos
// (07:42 → 08:02); recalcular pelos horários dava 20 min exatos e escondia o desvio.
//   fim confirmado na Conferência → fim confirmado − início (a hora confirmada manda)
//   fim do relatório              → duração do arquivo; sem ela, fim − início
export type PausaDuracao = { inicio: string; fim: string | null; fim_confirmado?: string | null; duracao_seg?: number | null }

const seg = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 1000

export function duracaoPausaSeg(p: PausaDuracao): number | null {
  if (p.fim_confirmado) return seg(p.inicio, p.fim_confirmado)
  if (p.fim) return p.duracao_seg ?? seg(p.inicio, p.fim)
  return null
}

export function pausaInsuficiente(p: PausaDuracao, pausaMinMin = 20): boolean | null {
  const s = duracaoPausaSeg(p)
  return s == null ? null : s / 60 < pausaMinMin
}

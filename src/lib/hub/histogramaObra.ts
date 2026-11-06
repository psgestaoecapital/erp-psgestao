// HB3 (fatia 11) · Histograma de mão de obra e pluviometria do cronograma da obra.
// Agrupa por semana (segunda a domingo) as horas apontadas na obra e os dias do diário (RDO): dias com chuva e dias em
// que não deu para trabalhar. Vários RDOs no mesmo dia (uma OS cada) contam como um dia só. Equipe média = horas da
// semana ÷ (8 h × 5 dias úteis). A janela vai da primeira à última data entre o cronograma, os apontamentos e os RDOs.
export type ApontamentoHist = { data: string; horas: number }
export type RdoHist = { data: string; clima: string | null; praticavel: boolean | null }
export type SemanaHist = { semana: string; horas: number; equipe: number; diasRdo: number; diasChuva: number; diasParados: number }
export type Histograma = { semanas: SemanaHist[]; totalHoras: number; picoHoras: number; diasChuva: number; diasParados: number; diasRdo: number }

const DIA = 86400000
const ms = (d: string) => new Date(d + 'T00:00:00Z').getTime()
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
// segunda-feira da semana da data
export const segunda = (d: string) => { const t = ms(d); return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DIA) }
const CHUVA = new Set(['chuva', 'chuva_forte'])
const MAX_SEMANAS = 104 // dois anos: protege a tela de uma data digitada errado

export function histogramaObra(apont: ApontamentoHist[], rdos: RdoHist[], janela?: { ini: string; fim: string } | null): Histograma | null {
  const datas = [...apont.map((a) => a.data), ...rdos.map((r) => r.data), ...(janela ? [janela.ini, janela.fim] : [])].filter(Boolean)
  if (apont.length === 0 && rdos.length === 0) return null
  const ini = segunda(datas.reduce((a, b) => (a < b ? a : b)))
  const fim = segunda(datas.reduce((a, b) => (a > b ? a : b)))
  const total = Math.round((ms(fim) - ms(ini)) / (7 * DIA)) + 1
  const n = Math.min(MAX_SEMANAS, total)
  const base = total > MAX_SEMANAS ? iso(ms(fim) - (MAX_SEMANAS - 1) * 7 * DIA) : ini // fica com as semanas mais recentes
  const semanas: SemanaHist[] = Array.from({ length: n }, (_, i) => ({ semana: iso(ms(base) + i * 7 * DIA), horas: 0, equipe: 0, diasRdo: 0, diasChuva: 0, diasParados: 0 }))
  const idx = new Map(semanas.map((s, i) => [s.semana, i]))

  for (const a of apont) {
    const i = idx.get(segunda(a.data)); if (i === undefined) continue
    semanas[i].horas += Number(a.horas) || 0
  }
  // um dia do diário: chuva se algum RDO do dia marcou chuva; parado se algum marcou que não deu para trabalhar
  const dias = new Map<string, { chuva: boolean; parado: boolean }>()
  for (const r of rdos) {
    const d = dias.get(r.data) ?? { chuva: false, parado: false }
    if (r.clima && CHUVA.has(r.clima)) d.chuva = true
    if (r.praticavel === false) d.parado = true
    dias.set(r.data, d)
  }
  for (const [data, d] of dias) {
    const i = idx.get(segunda(data)); if (i === undefined) continue
    semanas[i].diasRdo++; if (d.chuva) semanas[i].diasChuva++; if (d.parado) semanas[i].diasParados++
  }
  for (const s of semanas) { s.horas = Math.round(s.horas * 100) / 100; s.equipe = Math.round((s.horas / 40) * 10) / 10 }

  return {
    semanas,
    totalHoras: Math.round(semanas.reduce((t, s) => t + s.horas, 0) * 100) / 100,
    picoHoras: semanas.reduce((m, s) => Math.max(m, s.horas), 0),
    diasChuva: semanas.reduce((t, s) => t + s.diasChuva, 0),
    diasParados: semanas.reduce((t, s) => t + s.diasParados, 0),
    diasRdo: semanas.reduce((t, s) => t + s.diasRdo, 0),
  }
}

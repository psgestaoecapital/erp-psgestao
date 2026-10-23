// HB3 (fatia 6) · Curva S do cronograma da obra: avanço físico planejado acumulado × avanço realizado hoje.
// Peso de cada tarefa = duração em dias. Planejado usa a linha de base quando a tarefa tem; senão, as datas atuais.
export type TarefaCurva = { inicio: string; fim: string; percentual: number; inicio_base?: string | null; fim_base?: string | null }
export type PontoCurva = { data: string; planejado: number }
export type CurvaS = { pontos: PontoCurva[]; planejadoHoje: number; realizado: number; desvio: number; inicio: string; fim: string }

const DIA = 86400000
const ms = (d: string) => new Date(d + 'T00:00:00Z').getTime()
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const dur = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DIA) + 1

/** Fração (0..1) da tarefa que deveria estar pronta no fim do dia `d`, distribuída linearmente entre início e fim. */
export function fracaoPlanejada(ini: string, fim: string, d: string): number {
  const f = (ms(d) - ms(ini) + DIA) / (dur(ini, fim) * DIA)
  return Math.min(1, Math.max(0, f))
}

/** Planejado acumulado (0..100) no dia `d`. */
export function planejadoEm(tarefas: TarefaCurva[], d: string): number {
  let peso = 0, feito = 0
  for (const t of tarefas) {
    const ini = t.inicio_base ?? t.inicio, fim = t.fim_base ?? t.fim
    const p = dur(ini, fim)
    peso += p; feito += p * fracaoPlanejada(ini, fim, d)
  }
  return peso > 0 ? (feito / peso) * 100 : 0
}

/** Realizado (0..100): avanço de cada tarefa ponderado pela duração (a mesma conta do "Avanço geral" da tela). */
export function realizadoGeral(tarefas: TarefaCurva[]): number {
  let peso = 0, feito = 0
  for (const t of tarefas) { const p = dur(t.inicio, t.fim); peso += p; feito += (p * Number(t.percentual)) / 100 }
  return peso > 0 ? (feito / peso) * 100 : 0
}

/** Série semanal da curva planejada (do primeiro início ao último fim) + comparação com o realizado em `hoje`. */
export function curvaS(tarefas: TarefaCurva[], hoje: string): CurvaS | null {
  if (tarefas.length === 0) return null
  const datas = tarefas.flatMap((t) => [t.inicio_base ?? t.inicio, t.fim_base ?? t.fim, t.inicio, t.fim])
  const inicio = datas.reduce((a, b) => (a < b ? a : b)), fim = datas.reduce((a, b) => (a > b ? a : b))
  const pontos: PontoCurva[] = []
  for (let t = ms(inicio); t < ms(fim); t += 7 * DIA) pontos.push({ data: iso(t), planejado: planejadoEm(tarefas, iso(t)) })
  pontos.push({ data: fim, planejado: planejadoEm(tarefas, fim) })
  const planejadoHoje = planejadoEm(tarefas, hoje < inicio ? inicio : hoje > fim ? fim : hoje)
  const realizado = realizadoGeral(tarefas)
  return { pontos, planejadoHoje, realizado, desvio: realizado - planejadoHoje, inicio, fim }
}

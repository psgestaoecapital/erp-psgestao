// HB3 (fatia 6) · Curva S do cronograma da obra: avanço físico planejado acumulado × avanço realizado hoje.
// Peso de cada tarefa = duração em dias. Planejado usa a linha de base quando a tarefa tem; senão, as datas atuais.
// Fatia 12: com linha de base fixada, cada ponto traz também o planejado pelas datas ATUAIS (reprogramado), para a tela
// desenhar as duas curvas e mostrar quanto o cronograma escorregou da base.
export type TarefaCurva = { inicio: string; fim: string; percentual: number; inicio_base?: string | null; fim_base?: string | null }
export type PontoCurva = { data: string; planejado: number; atual: number }
export type CurvaS = { pontos: PontoCurva[]; planejadoHoje: number; realizado: number; desvio: number; inicio: string; fim: string; temBase: boolean }

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

/** Planejado acumulado (0..100) no dia `d` pelas datas atuais, ignorando a linha de base (cronograma reprogramado). */
export function planejadoAtualEm(tarefas: TarefaCurva[], d: string): number {
  return planejadoEm(tarefas.map((t) => ({ inicio: t.inicio, fim: t.fim, percentual: t.percentual })), d)
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
  const ponto = (d: string): PontoCurva => ({ data: d, planejado: planejadoEm(tarefas, d), atual: planejadoAtualEm(tarefas, d) })
  for (let t = ms(inicio); t < ms(fim); t += 7 * DIA) pontos.push(ponto(iso(t)))
  pontos.push(ponto(fim))
  const planejadoHoje = planejadoEm(tarefas, hoje < inicio ? inicio : hoje > fim ? fim : hoje)
  const realizado = realizadoGeral(tarefas)
  const temBase = tarefas.some((t) => !!t.inicio_base && !!t.fim_base)
  return { pontos, planejadoHoje, realizado, desvio: realizado - planejadoHoje, inicio, fim, temBase }
}

// Fatia 12 · linha REALIZADA: o % de cada tarefa ao longo do tempo (projetos_obra_tarefa_avanco, um ponto por dia).
export type TarefaHist = TarefaCurva & { id: string }
export type AvancoHist = { tarefa_id: string; data: string; percentual: number }
export type PontoRealizado = { data: string; realizado: number }

/**
 * Realizado acumulado (0..100) nos dias da curva planejada até `hoje`, mais o ponto de hoje (= realizadoGeral).
 * Em cada dia, a tarefa vale o último % registrado até ali; antes de começar, 0. A linha só começa no primeiro dia em
 * que TODAS as tarefas são conhecidas (tarefa já começada e sem registro até ali = desconhecida: não chuta zero).
 */
export function curvaRealizada(tarefas: TarefaHist[], hist: AvancoHist[], pontos: PontoCurva[], hoje: string): PontoRealizado[] {
  if (tarefas.length === 0) return []
  const porTarefa = new Map<string, AvancoHist[]>()
  for (const h of hist) { const l = porTarefa.get(h.tarefa_id) ?? []; l.push(h); porTarefa.set(h.tarefa_id, l) }
  for (const l of porTarefa.values()) l.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))
  const em = (d: string): number | null => {
    let peso = 0, feito = 0
    for (const t of tarefas) {
      const l = porTarefa.get(t.id) ?? []
      let v: number | null = null
      for (const h of l) { if (h.data <= d) v = Number(h.percentual); else break }
      if (v === null) { if (d < t.inicio) v = 0; else return null }
      const p = dur(t.inicio, t.fim); peso += p; feito += (p * v) / 100
    }
    return peso > 0 ? (feito / peso) * 100 : 0
  }
  const out: PontoRealizado[] = []
  for (const p of pontos) {
    if (p.data >= hoje) break
    const r = em(p.data)
    if (r === null) { if (out.length > 0) out.length = 0; continue }
    out.push({ data: p.data, realizado: r })
  }
  out.push({ data: hoje, realizado: realizadoGeral(tarefas) })
  return out
}

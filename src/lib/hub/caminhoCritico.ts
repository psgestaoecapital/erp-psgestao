// HB3 (fatia 8) · Caminho crítico do cronograma da obra: folga de cada tarefa com as datas atuais e as dependências.
// Dependência = término-início com defasagem: a sucessora pode começar no dia seguinte ao fim da predecessora + defasagem.
// Folga = quantos dias a tarefa pode terminar mais tarde sem empurrar o fim da obra. Folga ≤ 0 = tarefa crítica.
export type TarefaCpm = { id: string; inicio: string; fim: string }
export type DepCpm = { tarefa_id: string; predecessora_id: string; defasagem_dias: number }
export type CaminhoCritico = { folga: Map<string, number>; criticas: Set<string>; fimObra: string | null }

const DIA = 86400000
const ms = (d: string) => new Date(d + 'T00:00:00Z').getTime()
const entre = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DIA)

export function caminhoCritico(tarefas: TarefaCpm[], deps: DepCpm[]): CaminhoCritico {
  const folga = new Map<string, number>(), criticas = new Set<string>()
  if (tarefas.length === 0) return { folga, criticas, fimObra: null }
  const porId = new Map(tarefas.map((t) => [t.id, t]))
  const fimObra = tarefas.reduce((a, t) => (t.fim > a ? t.fim : a), tarefas[0].fim)
  const sucessoras = new Map<string, DepCpm[]>()
  for (const d of deps) {
    if (!porId.has(d.tarefa_id) || !porId.has(d.predecessora_id)) continue
    sucessoras.set(d.predecessora_id, [...(sucessoras.get(d.predecessora_id) ?? []), d])
  }
  // fim mais tarde (em dias a partir do fim da obra; 0 = no fim da obra, negativo = antes)
  const fimTarde = new Map<string, number>(), visitando = new Set<string>()
  const calc = (id: string): number => {
    const ja = fimTarde.get(id); if (ja !== undefined) return ja
    if (visitando.has(id)) return 0 // ciclo (o banco já impede): não trava a tela
    visitando.add(id)
    let lf = 0
    for (const d of sucessoras.get(id) ?? []) {
      const s = porId.get(d.tarefa_id)!
      const inicioTardeS = calc(s.id) - entre(s.inicio, s.fim) // dias até o fim da obra
      lf = Math.min(lf, inicioTardeS - 1 - (Number(d.defasagem_dias) || 0))
    }
    visitando.delete(id); fimTarde.set(id, lf)
    return lf
  }
  for (const t of tarefas) {
    const f = calc(t.id) - entre(fimObra, t.fim)
    folga.set(t.id, f)
    if (f <= 0) criticas.add(t.id)
  }
  return { folga, criticas, fimObra }
}

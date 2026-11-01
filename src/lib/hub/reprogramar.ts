// HB3 (fatia 13) · Reprogramar o cronograma pelas dependências: quando uma tarefa atrasa, muda de prazo ou entra
// tarefa nova (mudança de escopo), as sucessoras que ainda NÃO começaram passam a começar no dia seguinte ao fim da
// predecessora + defasagem, mantendo a duração. Só empurra para frente (nunca puxa para antes) e nunca mexe em tarefa
// já iniciada (avanço > 0): o que já aconteceu não se reescreve — o conflito dela continua marcado no Gantt.
export type TarefaReprog = { id: string; nome: string; inicio: string; fim: string; percentual: number }
export type DepReprog = { tarefa_id: string; predecessora_id: string; defasagem_dias: number }
export type Mudanca = { id: string; nome: string; de: { inicio: string; fim: string }; para: { inicio: string; fim: string }; dias: number }

const DIA = 86400000
const ms = (d: string) => new Date(d + 'T00:00:00Z').getTime()
const soma = (d: string, n: number) => new Date(ms(d) + n * DIA).toISOString().slice(0, 10)

export function reprogramar(tarefas: TarefaReprog[], deps: DepReprog[]): Mudanca[] {
  const porId = new Map(tarefas.map((t) => [t.id, t]))
  const preds = new Map<string, DepReprog[]>()
  for (const d of deps) {
    if (!porId.has(d.tarefa_id) || !porId.has(d.predecessora_id)) continue
    preds.set(d.tarefa_id, [...(preds.get(d.tarefa_id) ?? []), d])
  }
  // datas novas calculadas em ordem de dependência (predecessora antes da sucessora)
  const novo = new Map<string, { inicio: string; fim: string }>(), visitando = new Set<string>()
  const calc = (id: string): { inicio: string; fim: string } => {
    const ja = novo.get(id); if (ja) return ja
    const t = porId.get(id)!
    if (visitando.has(id)) return { inicio: t.inicio, fim: t.fim } // ciclo (o banco já impede): não trava
    visitando.add(id)
    let r = { inicio: t.inicio, fim: t.fim }
    if ((Number(t.percentual) || 0) <= 0) {
      let cedo = t.inicio
      for (const d of preds.get(id) ?? []) {
        const p = soma(calc(d.predecessora_id).fim, 1 + (Number(d.defasagem_dias) || 0))
        if (p > cedo) cedo = p
      }
      if (cedo > t.inicio) {
        const dur = Math.round((ms(t.fim) - ms(t.inicio)) / DIA)
        r = { inicio: cedo, fim: soma(cedo, dur) }
      }
    }
    visitando.delete(id); novo.set(id, r)
    return r
  }
  const mudancas: Mudanca[] = []
  for (const t of tarefas) {
    const r = calc(t.id)
    if (r.inicio !== t.inicio) mudancas.push({ id: t.id, nome: t.nome, de: { inicio: t.inicio, fim: t.fim }, para: r, dias: Math.round((ms(r.inicio) - ms(t.inicio)) / DIA) })
  }
  return mudancas
}

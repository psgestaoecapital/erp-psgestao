// HB4 · Avanço físico pelo diário de obra (RDO): a equipe informa no diário da OS quanto executou do serviço da OS
// (projetos_obra_rdo.quantidade_executada, na unidade do item do contrato). Cada OS liga uma tarefa do cronograma a um
// item do contrato, então o que foi executado no dia conta para aquela tarefa naquele item.
// Meta da tarefa no item = quantidade contratada × participação da tarefa no item (projetos_obra_tarefa_item); sem
// participação cadastrada, a tarefa responde pelo item inteiro. Fração do item = executado ÷ meta (no máximo 100%).
// Avanço da tarefa = média das frações ponderada pelo valor da meta (valor contratado × participação): itens de
// unidades diferentes (m², un, m) não se somam em quantidade, só em valor. Item com valor zero pesa pela participação.
// Item ligado à tarefa sem nada executado entra com 0%. Só sai tarefa com pelo menos um diário com quantidade.
export type TarefaAD = { id: string; percentual: number }
export type ItemAD = { id: string; quantidade_contratada: number; valor_contratado?: number | null }
export type VinculoAD = { tarefa_id: string; obra_item_id: string; participacao_pct: number }
export type OsAD = { id: string; tarefa_id: string | null; obra_item_id: string | null }
export type RdoQtdAD = { os_id: string; quantidade_executada: number | null }
export type AvancoDiario = { tarefa_id: string; pct: number; atual: number; diarios: number }

export function avancoPeloDiario(tarefas: TarefaAD[], itens: ItemAD[], vinculos: VinculoAD[], os: OsAD[], rdos: RdoQtdAD[]): AvancoDiario[] {
  const itemPor = new Map(itens.map((i) => [i.id, i]))
  const osPor = new Map(os.map((o) => [o.id, o]))
  // executado por tarefa+item e quantos diários com quantidade a tarefa tem
  const exec = new Map<string, number>(), diarios = new Map<string, number>()
  for (const r of rdos) {
    const q = Number(r.quantidade_executada)
    if (r.quantidade_executada == null || !Number.isFinite(q) || q <= 0) continue
    const o = osPor.get(r.os_id)
    if (!o?.tarefa_id || !o.obra_item_id || !itemPor.has(o.obra_item_id)) continue
    const k = `${o.tarefa_id}|${o.obra_item_id}`
    exec.set(k, (exec.get(k) ?? 0) + q)
    diarios.set(o.tarefa_id, (diarios.get(o.tarefa_id) ?? 0) + 1)
  }
  const out: AvancoDiario[] = []
  for (const t of tarefas) {
    const n = diarios.get(t.id) ?? 0
    if (n === 0) continue
    // itens da tarefa: os ligados no cronograma + os das OS com diário (participação 100% quando não ligados)
    const part = new Map<string, number>()
    for (const v of vinculos) if (v.tarefa_id === t.id && itemPor.has(v.obra_item_id)) part.set(v.obra_item_id, Number(v.participacao_pct))
    for (const k of exec.keys()) { const [tid, iid] = k.split('|'); if (tid === t.id && !part.has(iid)) part.set(iid, 100) }
    let soma = 0, peso = 0
    for (const [iid, p] of part) {
      const it = itemPor.get(iid)!
      const meta = Number(it.quantidade_contratada) * p / 100
      if (!(meta > 0)) continue
      const valor = Number(it.valor_contratado) * p / 100
      const w = valor > 0 ? valor : p
      soma += w * Math.min(1, (exec.get(`${t.id}|${iid}`) ?? 0) / meta)
      peso += w
    }
    if (peso <= 0) continue
    out.push({ tarefa_id: t.id, pct: Math.round((soma / peso) * 100), atual: Number(t.percentual) || 0, diarios: n })
  }
  return out
}

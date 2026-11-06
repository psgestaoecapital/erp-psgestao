// HB3 (fatia 9) · Próximas semanas do cronograma da obra (lookahead): o que a equipe precisa preparar agora.
// Pega as tarefas não concluídas que tocam a janela [hoje, hoje + dias − 1] e as que já deviam ter terminado.
// Situação: "atrasada" (fim antes de hoje e < 100%), "começa" (início dentro da janela), "termina" (fim dentro da
// janela, já começou), "em andamento" (atravessa a janela inteira). Ordem: atrasadas primeiro, depois por início.
export type TarefaLookahead = { id: string; nome: string; inicio: string; fim: string; percentual: number }
export type Situacao = 'atrasada' | 'comeca' | 'termina' | 'andamento'
export type ItemLookahead = { tarefa: TarefaLookahead; situacao: Situacao; diasAtraso: number }

const DIA = 86400000
const ms = (d: string) => new Date(d + 'T00:00:00Z').getTime()
const somaDias = (d: string, n: number) => new Date(ms(d) + n * DIA).toISOString().slice(0, 10)
const PESO: Record<Situacao, number> = { atrasada: 0, comeca: 1, termina: 1, andamento: 1 }

export function lookahead(tarefas: TarefaLookahead[], hoje: string, dias = 14): { ate: string; itens: ItemLookahead[] } {
  const ate = somaDias(hoje, Math.max(1, dias) - 1)
  const itens: ItemLookahead[] = []
  for (const t of tarefas) {
    if (Number(t.percentual) >= 100) continue
    if (t.fim < hoje) { itens.push({ tarefa: t, situacao: 'atrasada', diasAtraso: Math.round((ms(hoje) - ms(t.fim)) / DIA) }); continue }
    if (t.inicio > ate) continue
    const situacao: Situacao = t.inicio >= hoje ? 'comeca' : t.fim <= ate ? 'termina' : 'andamento'
    itens.push({ tarefa: t, situacao, diasAtraso: 0 })
  }
  itens.sort((a, b) => PESO[a.situacao] - PESO[b.situacao] || (a.tarefa.inicio < b.tarefa.inicio ? -1 : a.tarefa.inicio > b.tarefa.inicio ? 1 : 0))
  return { ate, itens }
}

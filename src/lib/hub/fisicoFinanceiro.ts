// HB3 (fatia 7) · Físico-financeiro do cronograma: custo previsto por tarefa distribuído linearmente no prazo (ou na linha de base)
// × custo apropriado (custo da tarefa × avanço). Tarefa sem custo previsto conta zero.
import { fracaoPlanejada } from './curvaS'

export type TarefaCusto = { inicio: string; fim: string; percentual: number; inicio_base?: string | null; fim_base?: string | null; custo_previsto?: number | string | null }
export type FisicoFinanceiro = { previsto: number; planejadoHoje: number; apropriado: number; desvio: number }

const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v) || 0)

export function fisicoFinanceiro(tarefas: TarefaCusto[], hoje: string): FisicoFinanceiro | null {
  const comCusto = tarefas.filter((t) => num(t.custo_previsto) > 0)
  if (comCusto.length === 0) return null
  let previsto = 0, planejadoHoje = 0, apropriado = 0
  for (const t of comCusto) {
    const c = num(t.custo_previsto)
    previsto += c
    planejadoHoje += c * fracaoPlanejada(t.inicio_base ?? t.inicio, t.fim_base ?? t.fim, hoje)
    apropriado += (c * Number(t.percentual)) / 100
  }
  return { previsto, planejadoHoje, apropriado, desvio: apropriado - planejadoHoje }
}

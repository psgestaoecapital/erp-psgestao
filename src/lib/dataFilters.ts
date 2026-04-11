/**
 * dataFilters.ts — PS Gestão · Filtros padrão unificados
 *
 * PROBLEMA CORRIGIDO: Dashboard, Consultor IA, V19 e BPO usavam
 * lógicas de filtro divergentes. Este módulo centraliza o padrão.
 *
 * REGRAS PADRÃO (aplicadas em TODOS os módulos):
 *  1. Excluir lançamentos com status 'cancelado'
 *  2. Excluir duplicatas (mesmo id duplicado ou flag is_duplicate)
 *  3. Excluir lançamentos do tipo 'emprestimo' / 'transferencia_interna'
 */

export interface Lancamento {
  id: string
  status?: string
  tipo?: string
  is_duplicate?: boolean
  [key: string]: unknown
}

/** Remove cancelados, duplicatas e empréstimos — padrão do dashboard */
export function applyStandardFilters(data: Lancamento[]): Lancamento[] {
  const seenIds = new Set<string>()

  return data.filter(item => {
    // 1. Excluir cancelados
    if (item.status === 'cancelado') return false

    // 2. Excluir duplicatas por flag
    if (item.is_duplicate === true) return false

    // 3. Excluir por tipo financeiro não operacional
    const tiposExcluidos = ['emprestimo', 'transferencia_interna', 'aporte_socio']
    if (item.tipo && tiposExcluidos.includes(item.tipo)) return false

    // 4. Dedup por id
    if (seenIds.has(item.id)) return false
    seenIds.add(item.id)

    return true
  })
}

/** Filtro BPO: igual ao padrão + exclui entradas sem categoria BPO */
export function applyBPOFilters(data: Lancamento[]): Lancamento[] {
  return applyStandardFilters(data).filter(item => {
    // BPO só processa lançamentos com categoria definida
    return item.categoria && String(item.categoria).trim() !== ''
  })
}

/** Filtro V19 / Consultor IA: igual ao padrão (deve ser idêntico ao dashboard) */
export function applyV19Filters(data: Lancamento[]): Lancamento[] {
  return applyStandardFilters(data)
}

/** Resumo para debug — conta excluídos por categoria */
export function filterSummary(original: Lancamento[], filtered: Lancamento[]) {
  return {
    total_original: original.length,
    total_filtrado: filtered.length,
    excluidos: original.length - filtered.length,
  }
}

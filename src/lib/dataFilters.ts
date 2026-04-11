/**
 * dataFilters.ts — PS Gestão v1.4
 * Filtros padrão unificados + filtro por linha de negócio
 */

export interface Lancamento {
  id: string
  status?: string
  tipo?: string
  is_duplicate?: boolean
  categoria?: string
  linha_negocio_id?: string
  rateio_percentual?: number
  valor?: number | string
  [key: string]: unknown
}

/** Remove cancelados, duplicatas e empréstimos — padrão do dashboard */
export function applyStandardFilters(data: Lancamento[]): Lancamento[] {
  const seen = new Set<string>()
  const excluded = ['emprestimo', 'transferencia_interna', 'aporte_socio']
  return data.filter(item => {
    if (item.status === 'cancelado') return false
    if (item.is_duplicate === true) return false
    if (item.tipo && excluded.includes(item.tipo)) return false
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

/** Filtro por linha de negócio específica */
export function applyLinhaFilter(data: Lancamento[], linhaId: string): Lancamento[] {
  return applyStandardFilters(data).filter(item => item.linha_negocio_id === linhaId)
}

/** Retorna lançamentos sem linha atribuída (útil para identificar não categorizados) */
export function applyNaoCategorizadoFilter(data: Lancamento[]): Lancamento[] {
  return applyStandardFilters(data).filter(item => !item.linha_negocio_id)
}

/** Aplica rateio percentual ao valor do lançamento */
export function aplicarRateio(lancamento: Lancamento): number {
  const valor = Number(lancamento.valor ?? 0)
  const rateio = Number(lancamento.rateio_percentual ?? 100) / 100
  return valor * rateio
}

/** Filtro BPO: igual ao padrão + exclui entradas sem categoria */
export function applyBPOFilters(data: Lancamento[]): Lancamento[] {
  return applyStandardFilters(data).filter(item =>
    item.categoria && String(item.categoria).trim() !== ''
  )
}

/** Filtro V19 / Consultor IA: igual ao padrão */
export function applyV19Filters(data: Lancamento[]): Lancamento[] {
  return applyStandardFilters(data)
}

/** Resumo de filtro para debug */
export function filterSummary(original: Lancamento[], filtered: Lancamento[]) {
  return {
    total_original: original.length,
    total_filtrado: filtered.length,
    excluidos: original.length - filtered.length,
    sem_linha: filtered.filter(l => !l.linha_negocio_id).length,
  }
}

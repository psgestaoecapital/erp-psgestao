/**
 * dataFilters.ts — PS Gestão · Filtros padrão unificados
 *
 * CORREÇÃO: Dashboard, Consultor IA, V19 e BPO agora usam
 * a mesma lógica de filtro centralizada aqui.
 *
 * Regras:
 *  1. Excluir status 'cancelado'
 *  2. Excluir flag is_duplicate = true
 *  3. Excluir tipos não operacionais (emprestimo, transferencia_interna, aporte_socio)
 *  4. Deduplicar por id
 */

export interface Lancamento {
  id: string
  status?: string
  tipo?: string
  is_duplicate?: boolean
  categoria?: string
  [key: string]: unknown
}

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

export function applyBPOFilters(data: Lancamento[]): Lancamento[] {
  return applyStandardFilters(data).filter(item =>
    item.categoria && String(item.categoria).trim() !== ''
  )
}

export function applyV19Filters(data: Lancamento[]): Lancamento[] {
  return applyStandardFilters(data)
}

export function filterSummary(original: Lancamento[], filtered: Lancamento[]) {
  return {
    total_original: original.length,
    total_filtrado: filtered.length,
    excluidos: original.length - filtered.length,
  }
}

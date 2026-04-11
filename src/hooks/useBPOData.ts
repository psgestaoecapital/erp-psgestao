import { useState, useEffect, useCallback } from 'react'
import { applyBPOFilters, filterSummary, type Lancamento } from '@/lib/dataFilters'

interface UseBPODataOptions {
  empresaId: string
  periodo?: string
  enabled?: boolean
}

interface BPODataState {
  data: Lancamento[]
  loading: boolean
  error: string | null
  summary: ReturnType<typeof filterSummary> | null
  refetch: () => void
}

/**
 * Hook unificado para dados do módulo BPO.
 * Aplica applyBPOFilters (mesmo padrão do dashboard) — corrige inconsistência anterior.
 */
export function useBPOData({ empresaId, periodo, enabled = true }: UseBPODataOptions): BPODataState {
  const [data, setData] = useState<Lancamento[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ReturnType<typeof filterSummary> | null>(null)

  const fetchData = useCallback(async () => {
    if (!empresaId || !enabled) return

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ empresa_id: empresaId })
      if (periodo) params.set('periodo', periodo)

      const res = await fetch(`/api/lancamentos?${params}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Erro ao carregar dados BPO')
      }

      const json = await res.json()
      const raw: Lancamento[] = json.data ?? []

      // Aplica filtro padrão BPO (idêntico ao dashboard)
      const filtered = applyBPOFilters(raw)
      setData(filtered)
      setSummary(filterSummary(raw, filtered))
    } catch (err: any) {
      setError(err.message)
      setData([])
    } finally {
      setLoading(false)
    }
  }, [empresaId, periodo, enabled])

  useEffect(() => { fetchData() }, [fetchData])

  return { data, loading, error, summary, refetch: fetchData }
}

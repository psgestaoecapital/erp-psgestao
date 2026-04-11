import { useState, useEffect, useCallback } from 'react'
import { applyBPOFilters, filterSummary, type Lancamento } from '@/lib/dataFilters'
import { supabase } from '@/lib/supabase'

interface UseBPODataOptions {
  empresaId: string
  periodo?: string
  enabled?: boolean
}

export function useBPOData({ empresaId, periodo, enabled = true }: UseBPODataOptions) {
  const [data, setData] = useState<Lancamento[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ReturnType<typeof filterSummary> | null>(null)

  const fetchData = useCallback(async () => {
    if (!empresaId || !enabled) return
    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sessão não encontrada')

      const params = new URLSearchParams({ empresa_id: empresaId })
      if (periodo) params.set('periodo', periodo)

      const res = await fetch(`/api/lancamentos?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Erro ao carregar dados BPO')
      }

      const json = await res.json()
      const raw: Lancamento[] = json.data ?? []
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

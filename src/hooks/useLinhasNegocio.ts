import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { LinhaNegocio, DREPorLinha, BenchmarkLinhas } from '@/types/linhas-negocio'

export function useLinhasNegocio(empresaId: string) {
  const [linhas, setLinhas] = useState<LinhaNegocio[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await window.fetch(`/api/linhas-negocio?empresa_id=${empresaId}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      })
      const json = await res.json()
      setLinhas(json.data ?? [])
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [empresaId])

  useEffect(() => { fetch() }, [fetch])
  return { linhas, loading, error, refetch: fetch }
}

export function useDREPorLinha(empresaId: string, periodo: string) {
  const [data, setData] = useState<DREPorLinha[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!empresaId || !periodo) return
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await window.fetch(
        `/api/linhas-negocio/dre?empresa_id=${empresaId}&periodo=${periodo}`,
        { headers: { Authorization: `Bearer ${session?.access_token}` } }
      )
      const json = await res.json()
      setData(json.data ?? [])
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [empresaId, periodo])

  useEffect(() => { fetch() }, [fetch])
  return { data, loading, error, refetch: fetch }
}

export function useBenchmark(empresaId: string, periodo: string) {
  const [data, setData] = useState<BenchmarkLinhas | null>(null)
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    if (!empresaId || !periodo) return
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await window.fetch(
        `/api/linhas-negocio/benchmark?empresa_id=${empresaId}&periodo=${periodo}`,
        { headers: { Authorization: `Bearer ${session?.access_token}` } }
      )
      const json = await res.json()
      setData(json.data)
    } catch {}
    finally { setLoading(false) }
  }, [empresaId, periodo])

  useEffect(() => { fetch() }, [fetch])
  return { data, loading, refetch: fetch }
}

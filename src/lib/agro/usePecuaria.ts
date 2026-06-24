'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Padrao das telas verticais: companyId via ps_empresa_sel + polling.
export function useEmpresaSelecionada(): { companyId: string | null } {
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setCompanyId(read())
    const t = setInterval(() => {
      const v = read()
      setCompanyId((p) => (p === v ? p : v))
    }, 800)
    return () => clearInterval(t)
  }, [])
  return { companyId }
}

export type Propriedade = { id: string; nome: string }

export function usePropriedade(companyId: string | null): { propriedade: Propriedade | null; loading: boolean } {
  const [propriedade, setPropriedade] = useState<Propriedade | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!companyId) { setPropriedade(null); setLoading(false); return }
    let alive = true
    setLoading(true)
    ;(async () => {
      const { data } = await supabase.from('erp_pec_propriedade')
        .select('id,nome').eq('company_id', companyId).eq('ativo', true).order('nome').limit(1)
      if (!alive) return
      const lst = (data ?? []) as Propriedade[]
      setPropriedade(lst[0] ?? null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [companyId])
  return { propriedade, loading }
}

export type PainelRebanho = {
  total_cabecas: number
  por_categoria: Array<{ categoria: string; qtd: number }>
  lotes_ativos: number
  areas: number
  propriedades: number
}

export function usePainelRebanho(companyId: string | null, propriedadeId: string | null, refresh: number) {
  const [data, setData] = useState<PainelRebanho | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!companyId || !propriedadeId) { setData(null); return }
    let alive = true
    setLoading(true)
    ;(async () => {
      const { data: r } = await supabase.rpc('fn_pec_painel_rebanho', {
        p_company_id: companyId, p_propriedade_id: propriedadeId,
      })
      if (!alive) return
      setData(r as PainelRebanho)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [companyId, propriedadeId, refresh])
  return { data, loading }
}

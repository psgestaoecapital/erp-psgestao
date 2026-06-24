'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Padrao das telas verticais: companyId via ps_empresa_sel + polling.
// FALLBACK PR#448: quando ps_empresa_sel e null/'consolidado'/'group_*'
// (caso classico de CLIENT_OWNER que nao usa seletor de empresa porque so
// tem 1), consulta user_companies e auto-seleciona se o usuario tem exatamente
// 1 empresa. Evita "Esta empresa nao tem propriedade" quando na verdade nem
// chegamos a buscar a propriedade (companyId estava null).
export function useEmpresaSelecionada(): { companyId: string | null } {
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const readLocal = (): string | null => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    const aplicar = (v: string | null) => {
      if (!alive) return
      setCompanyId((p) => (p === v ? p : v))
    }
    aplicar(readLocal())

    // Se localStorage nao deu, tenta user_companies (auto-select 1 empresa)
    ;(async () => {
      const local = readLocal()
      if (local) return
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('user_companies')
        .select('company_id')
        .eq('user_id', user.id)
        .limit(2)
      if (!alive) return
      if (data && data.length === 1) aplicar((data[0] as { company_id: string }).company_id)
    })()

    const t = setInterval(() => {
      const v = readLocal()
      if (v) aplicar(v) // so promove se voltou valor valido — preserva auto-seleted
    }, 800)
    return () => { alive = false; clearInterval(t) }
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
      // Colunas do schema real (auditado): id, nome existem em erp_pec_propriedade.
      const { data, error } = await supabase.from('erp_pec_propriedade')
        .select('id, nome').eq('company_id', companyId).eq('ativo', true).order('nome').limit(1)
      if (!alive) return
      if (error) {
        // eslint-disable-next-line no-console
        console.warn('[agro] usePropriedade query falhou', error.message, { companyId })
      }
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


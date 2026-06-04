'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface AreaVisivel {
  ordem: number
  area_slug: string
  nome_menu: string
  icone: string
  rota_raiz: string
  descricao_curta: string | null
  status_comercial: 'piloto' | 'em_producao' | 'backlog' | 'futuro' | string
  cor_destaque: string | null
  empresa_tem_acesso: boolean
  motivo_acesso: string | null
}

interface State {
  areas: AreaVisivel[]
  loading: boolean
  error: string | null
}

// Cache simples por companyId pra evitar refetch ao trocar de rota
const cache = new Map<string, AreaVisivel[]>()

export function useAreasVisiveis(companyId: string | null): State {
  const [state, setState] = useState<State>({
    areas: companyId ? cache.get(companyId) ?? [] : [],
    loading: !companyId || !cache.has(companyId),
    error: null,
  })

  useEffect(() => {
    let mounted = true

    async function carregar() {
      // companyId pode ser null (consolidado/grupo/sem empresa) · RPC aceita
      setState((s) => ({ ...s, loading: true, error: null }))
      const { data, error } = await supabase.rpc('fn_listar_areas_visiveis', {
        p_company_id: companyId,
      })
      if (!mounted) return
      if (error) {
        setState({ areas: [], loading: false, error: error.message })
        return
      }
      const areas = (data ?? []) as AreaVisivel[]
      if (companyId) cache.set(companyId, areas)
      setState({ areas, loading: false, error: null })
    }

    carregar()
    return () => {
      mounted = false
    }
  }, [companyId])

  return state
}

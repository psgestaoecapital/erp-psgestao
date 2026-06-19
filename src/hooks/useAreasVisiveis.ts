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

// seletor-fonte-unica-contratado · usa fn_empresa_areas_status como fonte
// unica de "Contratado" (mesma do admin). fn_listar_areas_visiveis seguia
// uma logica propria de match por plano_principal_id exato, que diverge
// quando a empresa tem tier != plano principal da area (ex.: FRIOESTE
// industrial_grande vs area.plano=industrial_pequena).
//
// Estrategia: chama as duas RPCs em paralelo; fn_listar_areas_visiveis
// fornece metadado visual (icone, rota_raiz, descricao_curta) e
// fn_empresa_areas_status sobrescreve `empresa_tem_acesso` com `habilitada`.
export function useAreasVisiveis(companyId: string | null): State {
  const [state, setState] = useState<State>({
    areas: companyId ? cache.get(companyId) ?? [] : [],
    loading: !companyId || !cache.has(companyId),
    error: null,
  })

  useEffect(() => {
    let mounted = true

    async function carregar() {
      setState((s) => ({ ...s, loading: true, error: null }))

      const [visiveisRes, statusRes] = await Promise.all([
        supabase.rpc('fn_listar_areas_visiveis', { p_company_id: companyId }),
        companyId
          ? supabase.rpc('fn_empresa_areas_status', { p_company_id: companyId })
          : Promise.resolve({ data: [], error: null }),
      ])

      if (!mounted) return

      if (visiveisRes.error) {
        setState({ areas: [], loading: false, error: visiveisRes.error.message })
        return
      }

      const base = (visiveisRes.data ?? []) as AreaVisivel[]
      const habilitadaPorSlug = new Map<string, boolean>()
      const statusData = (statusRes.data ?? []) as Array<{ area_slug: string; habilitada: boolean }>
      statusData.forEach((s) => habilitadaPorSlug.set(s.area_slug, !!s.habilitada))

      const areas: AreaVisivel[] = base.map((a) => {
        const habilitada = habilitadaPorSlug.get(a.area_slug)
        if (!companyId || habilitada === undefined) return a
        return {
          ...a,
          empresa_tem_acesso: habilitada,
          motivo_acesso: habilitada ? 'contratada' : a.motivo_acesso,
        }
      })

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

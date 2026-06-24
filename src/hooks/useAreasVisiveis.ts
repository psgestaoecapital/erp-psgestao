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
// principal de "Contratado" (mesma do admin). fn_listar_areas_visiveis seguia
// uma logica propria de match por plano_principal_id exato, que diverge
// quando a empresa tem tier != plano principal da area (ex.: FRIOESTE
// industrial_grande vs area.plano=industrial_pequena).
//
// PR #446: NUNCA fazemos downgrade. Se fn_listar_areas_visiveis (primaria)
// ja disse empresa_tem_acesso=true, mantemos true mesmo que
// fn_empresa_areas_status retorne false — caso classico: assinatura
// v15_agro ativa que a logica de habilitacao do status nao reconhece.
// Owned em qualquer das duas fontes = contratada.
//
// Estrategia: chama as duas RPCs em paralelo; fn_listar_areas_visiveis
// fornece metadado visual (icone, rota_raiz, descricao_curta) e
// fn_empresa_areas_status PODE PROMOVER (false->true), nunca rebaixar.
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

      const { data: { user } } = await supabase.auth.getUser()
      const userId = user?.id ?? null

      const [visiveisRes, statusRes] = await Promise.all([
        supabase.rpc('fn_listar_areas_visiveis', { p_company_id: companyId, p_user_id: userId }),
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
        const habilitadaStatus = habilitadaPorSlug.get(a.area_slug)
        // OR logico: contratada se QUALQUER das duas fontes disser sim.
        // Promove false->true (status pega novo plano antes de listar_areas);
        // NUNCA rebaixa true->false (listar_areas pode ja saber de
        // assinaturas que a logica do status ainda nao mapeou, ex.: v15_agro).
        const ehContratada = !!a.empresa_tem_acesso || !!habilitadaStatus
        if (ehContratada === !!a.empresa_tem_acesso && habilitadaStatus === undefined) return a
        return {
          ...a,
          empresa_tem_acesso: ehContratada,
          motivo_acesso: ehContratada ? 'contratada' : a.motivo_acesso,
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

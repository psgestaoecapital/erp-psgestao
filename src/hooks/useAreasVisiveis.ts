'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { comPrazo } from '@/lib/comPrazo'
import { useUsuario } from '@/lib/AuthProvider'

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
  // null = ok/carregando; 'rpc' = falha nas RPCs. NUNCA confundir com lista vazia de verdade
  // (error=null, areas=[]). 'sessao' mantido no tipo por compat; a sessão agora vem do provider.
  error: 'sessao' | 'rpc' | null
}

// Cache por companyId (evita refetch ao trocar de rota).
const cache = new Map<string, AreaVisivel[]>()
// HOTFIX mobile (#1579): dedup de chamada em andamento por companyId::userId — ~10 instâncias do hook
// compartilham UMA Promise → 1 chamada fn_listar_areas_visiveis por troca de empresa (antes 10).
// P0 (item d): as ~10 instâncias montam ESCALONADAS (o 1º pedido resolve e sai do mapa antes de o 10º
// chegar) → voltavam a ser 10 chamadas. Agora a Promise resolvida fica no mapa por uma JANELA DE
// GRAÇA curta, então montagens escalonadas dentro dela ainda compartilham o mesmo resultado.
const inflight = new Map<string, Promise<AreaVisivel[]>>()
const GRACA_DEDUP_MS = 1500

async function buscarAreas(companyId: string | null, userId: string): Promise<AreaVisivel[]> {
  const key = `${companyId ?? '-'}::${userId}`
  const emAndamento = inflight.get(key)
  if (emAndamento) return emAndamento
  const p = (async () => {
    const [visiveisRes, statusRes] = await comPrazo(() => Promise.all([
      supabase.rpc('fn_listar_areas_visiveis', { p_company_id: companyId, p_user_id: userId }),
      companyId
        ? supabase.rpc('fn_empresa_areas_status', { p_company_id: companyId })
        : Promise.resolve({ data: [], error: null }),
    ]), { ms: 8000, tentativas: 1, label: 'areas_rpc' }) as [
      { data: unknown; error: { message: string } | null },
      { data: unknown; error: { message: string } | null },
    ]
    if (visiveisRes.error) throw new Error(visiveisRes.error.message)

    const base = (visiveisRes.data ?? []) as AreaVisivel[]
    const habilitadaPorSlug = new Map<string, boolean>()
    const statusData = (statusRes.data ?? []) as Array<{ area_slug: string; habilitada: boolean }>
    statusData.forEach((s) => habilitadaPorSlug.set(s.area_slug, !!s.habilitada))

    // seletor-fonte-unica-contratado (#446): OR lógico das duas fontes; promove false->true, nunca rebaixa.
    const areas: AreaVisivel[] = base.map((a) => {
      const habilitadaStatus = habilitadaPorSlug.get(a.area_slug)
      const ehContratada = !!a.empresa_tem_acesso || !!habilitadaStatus
      if (ehContratada === !!a.empresa_tem_acesso && habilitadaStatus === undefined) return a
      return { ...a, empresa_tem_acesso: ehContratada, motivo_acesso: ehContratada ? 'contratada' : a.motivo_acesso }
    })
    if (companyId) cache.set(companyId, areas)
    return areas
  })()
  inflight.set(key, p)
  // Janela de graça: só remove do mapa 1.5s depois de resolver/rejeitar — montagens escalonadas dentro
  // da janela reusam esta Promise (sucesso OU falha), sem virar 10 chamadas nem 10 retries.
  void p.finally(() => { setTimeout(() => { if (inflight.get(key) === p) inflight.delete(key) }, GRACA_DEDUP_MS) })
  return p
}

export function useAreasVisiveis(companyId: string | null): State & { reload: () => void } {
  const [state, setState] = useState<State>({
    areas: companyId ? cache.get(companyId) ?? [] : [],
    loading: !companyId || !cache.has(companyId),
    error: null,
  })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => {
    if (companyId) cache.delete(companyId)
    setTick((t) => t + 1)
  }, [companyId])

  // P0 Camada 2 (#1577) reconciliado com o hotfix #1579: a sessão vem do provider (useUsuario), lida
  // UMA vez via getSession — sem getUser próprio aqui (que disputava a trava do mobile). loading do
  // provider = sessão carregando; userId null com provider pronto = sem sessão (vazio real, fail-closed).
  // O dedup in-flight + o estado de erro/reload (retry no AreaSwitcher) vêm do #1579.
  const { userId, loading: sessaoLoading } = useUsuario()

  useEffect(() => {
    let mounted = true
    async function carregar() {
      if (sessaoLoading) { setState((s) => ({ ...s, loading: true, error: null })); return }
      if (!userId) { setState({ areas: [], loading: false, error: null }); return }
      setState((s) => ({ ...s, loading: true, error: null }))
      try {
        const areas = await buscarAreas(companyId, userId)
        if (!mounted) return
        setState({ areas, loading: false, error: null })
      } catch {
        if (!mounted) return
        setState({ areas: companyId ? cache.get(companyId) ?? [] : [], loading: false, error: 'rpc' })
      }
    }
    carregar()
    return () => { mounted = false }
  }, [companyId, userId, sessaoLoading, tick])

  return { ...state, reload }
}

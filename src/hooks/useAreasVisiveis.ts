'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { comPrazo } from '@/lib/comPrazo'

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
  // null = ok/carregando; 'sessao' = falha ao ler a sessão (trava); 'rpc' = falha nas RPCs.
  // NUNCA confundir com lista vazia de verdade (error=null, areas=[]).
  error: 'sessao' | 'rpc' | null
}

// Cache por companyId (evita refetch ao trocar de rota).
const cache = new Map<string, AreaVisivel[]>()
// HOTFIX mobile (16bc8561): dedup de chamada em andamento por companyId::userId. Antes, ~10
// instâncias do hook (AreaSwitcher, Sidebar, MobileDrawer, guardas…) disparavam fn_listar_areas_visiveis
// ao mesmo tempo. Agora todas compartilham UMA Promise → 1 chamada por troca de empresa.
const inflight = new Map<string, Promise<AreaVisivel[]>>()

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

    // seletor-fonte-unica-contratado (#446): OR lógico das duas fontes; promove false->true,
    // nunca rebaixa (fn_listar_areas_visiveis pode já saber de assinaturas que o status não mapeou).
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
  try {
    return await p
  } finally {
    inflight.delete(key)
  }
}

// seletor-fonte-unica-contratado · usa fn_empresa_areas_status como fonte
// principal de "Contratado" (mesma do admin) + fn_listar_areas_visiveis (metadado visual).
export function useAreasVisiveis(companyId: string | null): State & { reload: () => void } {
  const [state, setState] = useState<State>({
    areas: companyId ? cache.get(companyId) ?? [] : [],
    loading: !companyId || !cache.has(companyId),
    error: null,
  })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => {
    if (companyId) { cache.delete(companyId); inflight.delete(`${companyId}::`) }
    setTick((t) => t + 1)
  }, [companyId])

  // HOTFIX mobile (16bc8561): a sessão vem de getSession() (lê o storage local — sem ida ao servidor e
  // sem segurar a trava navigator.locks durante um round-trip, que era o que o getUser() fazia e provocava
  // "Lock broken … steal" quando ~10 instâncias corriam juntas). Estados:
  //   loading → sessão ainda carregando; erro → falha de leitura da trava (NÃO fail-closed; oferece retry);
  //   ok → resolvida (userId pode ser null só quando NÃO há sessão de verdade → aí sim vazio).
  const [userId, setUserId] = useState<string | null>(null)
  const [sessao, setSessao] = useState<'loading' | 'ok' | 'erro'>('loading')
  useEffect(() => {
    let alive = true
    setSessao('loading')
    void comPrazo(() => supabase.auth.getSession(), { ms: 8000, tentativas: 1, label: 'areas_getSession' })
      .then(({ data }) => { if (!alive) return; setUserId(data.session?.user?.id ?? null); setSessao('ok') })
      .catch(() => { if (!alive) return; setSessao('erro') }) // erro de trava: mantém retry, nunca "sem áreas"
    return () => { alive = false }
  }, [tick])

  useEffect(() => {
    let mounted = true
    async function carregar() {
      if (sessao === 'loading') { setState((s) => ({ ...s, loading: true, error: null })); return }
      if (sessao === 'erro') { setState({ areas: companyId ? cache.get(companyId) ?? [] : [], loading: false, error: 'sessao' }); return }
      if (!userId) { setState({ areas: [], loading: false, error: null }); return } // sessão ok e sem usuário = vazio real
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
  }, [companyId, userId, sessao, tick])

  return { ...state, reload }
}

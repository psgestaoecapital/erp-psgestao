'use client'

import { useEffect, useState } from 'react'
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

  // FIX-VAZAMENTO-AREAS: resolve o usuário ANTES de chamar a RPC. Antes, o efeito dependia só de
  // [companyId] e chamava fn_listar_areas_visiveis mesmo com getUser ainda null → a RPC (que falhava
  // aberta) devolvia TODAS as áreas para um usuário restrito, e como não havia refetch ao resolver o
  // usuário, o resultado errado grudava. Agora: userId em estado, nas deps, e a RPC só roda com usuário.
  const [userId, setUserId] = useState<string | null>(null)
  const [userResolvido, setUserResolvido] = useState(false)
  useEffect(() => {
    let alive = true
    // P0 (16bc8561): getUser pode pendurar na trava de sessão do mobile e NUNCA resolver → userResolvido
    // ficava false p/ sempre → loading eterno. comPrazo destrava: no timeout/erro, resolve fail-closed
    // (sem usuário) mas SEGUE (userResolvido=true), então a tela sai do "Carregando".
    void comPrazo(() => supabase.auth.getUser(), { ms: 8000, tentativas: 1, label: 'areas_getUser' })
      .then(({ data }) => { if (!alive) return; setUserId(data?.user?.id ?? null); setUserResolvido(true) })
      .catch(() => { if (!alive) return; setUserId(null); setUserResolvido(true) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let mounted = true

    async function carregar() {
      if (!userResolvido) { setState((s) => ({ ...s, loading: true })); return } // espera o usuário
      if (!userId) { setState({ areas: [], loading: false, error: null }); return } // sem usuário = sem áreas (fail-closed)
      setState((s) => ({ ...s, loading: true, error: null }))

      // P0 (16bc8561): as RPCs correm contra um prazo. Penduraram/estouraram → não fica em "Carregando":
      // usa o cache (se houver) ou lista vazia, com erro, e loading=false. Guardas seguem fail-closed.
      let visiveisRes: { data: unknown; error: { message: string } | null }
      let statusRes: { data: unknown; error: { message: string } | null }
      try {
        [visiveisRes, statusRes] = await comPrazo(() => Promise.all([
          supabase.rpc('fn_listar_areas_visiveis', { p_company_id: companyId, p_user_id: userId }),
          companyId
            ? supabase.rpc('fn_empresa_areas_status', { p_company_id: companyId })
            : Promise.resolve({ data: [], error: null }),
        ]), { ms: 8000, tentativas: 1, label: 'areas_rpc' })
      } catch {
        if (!mounted) return
        setState({ areas: companyId ? cache.get(companyId) ?? [] : [], loading: false, error: 'timeout' })
        return
      }

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
  }, [companyId, userId, userResolvido])

  return state
}

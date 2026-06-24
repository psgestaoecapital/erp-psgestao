'use client'

// Sidebar dinamico (PR #441):
// SEMPRE chama fn_modulos_sidebar_por_area(area, company, user) e renderiza
// o retorno. SIDEBAR_GESTAO_EMPRESARIAL hardcoded vira fallback de
// emergencia (so usado em rpc-error). Antes a area GE curto-circuitava
// pro hardcoded — causava bug de "Frioeste/Compliance" mostrar menu GE
// porque ate a deteccao de area falhasse uma vez, voltava pra GE.
//
// Loading/empty estados expostos pro consumer decidir.

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  SIDEBAR_GESTAO_EMPRESARIAL,
  type SidebarModuleNode,
  type SidebarSubItemNode,
  type SidebarStatus,
} from './sidebar-config'
import { useAreasVisiveis } from '@/hooks/useAreasVisiveis'

const AREA_STORAGE_KEY = 'ps_area_sel'
const EMPRESA_STORAGE_KEY = 'ps_empresa_sel'
const AREA_GE = 'gestao_empresarial'

export type SidebarModoFonte = 'hardcoded' | 'rpc' | 'rpc-empty' | 'rpc-error'

interface RpcRow {
  secao: string | null
  secao_label: string | null
  modulo_id: string
  nome: string
  rota: string | null
  icone: string | null
  ordem: number
  status: string | null
  badge_label: string | null
  badge_color: string | null
  diferencial: boolean | null
}

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const sel = localStorage.getItem(EMPRESA_STORAGE_KEY)
  if (!sel || sel === 'consolidado') return null
  if (sel.startsWith('group_')) return null
  return sel
}

function lerAreaPersistida(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(AREA_STORAGE_KEY) } catch { return null }
}

function statusFromRpc(s: string | null): SidebarStatus {
  if (s === 'pronto' || s === 'parcial' || s === 'em_breve') return s
  return 'pronto' // default defensivo
}

function rpcRowsToModulos(rows: RpcRow[]): SidebarModuleNode[] {
  // RPC ja vem ordenada (secao_ordem, ordem). Agrupar preservando a ordem
  // de aparicao da secao na lista (1a ocorrencia define a posicao).
  const grupos = new Map<string, { label: string; items: SidebarSubItemNode[] }>()

  for (const r of rows) {
    const secaoKey = r.secao ?? 'outros'
    const label = r.secao_label ?? r.secao ?? 'Outros'
    if (!grupos.has(secaoKey)) {
      grupos.set(secaoKey, { label, items: [] })
    }
    const grp = grupos.get(secaoKey)!
    grp.items.push({
      id: r.modulo_id,
      label: r.nome,
      href: r.rota ?? '#',
      status: statusFromRpc(r.status),
      ...(r.badge_label ? { badge: r.badge_label } : {}),
    })
  }

  const modulos: SidebarModuleNode[] = []
  for (const [secaoKey, { label, items }] of grupos.entries()) {
    modulos.push({
      id: secaoKey,
      label,
      status: 'pronto',
      items,
    })
  }
  return modulos
}

interface State {
  modulos: SidebarModuleNode[]
  loading: boolean
  mode: SidebarModoFonte
}

export function useSidebarModulos(): State {
  const pathname = usePathname() || ''
  const searchParams = useSearchParams()
  const queryArea = searchParams?.get('area') ?? null

  const [companyId, setCompanyId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [areaPersistida, setAreaPersistida] = useState<string | null>(null)
  const [rpcRows, setRpcRows] = useState<RpcRow[] | null>(null)
  const [rpcErro, setRpcErro] = useState<string | null>(null)
  const [rpcLoading, setRpcLoading] = useState(false)

  // company_id · resolve do localStorage e revalida via interval (mesmo
  // padrao do AreaSwitcher · permite reagir a troca de empresa)
  useEffect(() => {
    if (typeof window === 'undefined') return
    setCompanyId(resolveCompanyId())
    setAreaPersistida(lerAreaPersistida())
    const interval = setInterval(() => {
      const atual = resolveCompanyId()
      setCompanyId((prev) => (prev === atual ? prev : atual))
      const areaAtual = lerAreaPersistida()
      setAreaPersistida((prev) => (prev === areaAtual ? prev : areaAtual))
    }, 800)
    return () => clearInterval(interval)
  }, [])

  // user_id
  useEffect(() => {
    let alive = true
    void (async () => {
      const { data } = await supabase.auth.getUser()
      if (!alive) return
      setUserId(data?.user?.id ?? null)
    })()
    return () => { alive = false }
  }, [])

  // Resolve area atual (cascata: ?area= > persistida > path > path-fallback > GE)
  const { areas } = useAreasVisiveis(companyId)
  const areaSlugDoPath = useMemo(() => {
    if (!pathname || areas.length === 0) return null
    let melhor: { slug: string; len: number } | null = null
    for (const a of areas) {
      if (!a.rota_raiz) continue
      if (pathname === a.rota_raiz || pathname.startsWith(a.rota_raiz + '/')) {
        if (!melhor || a.rota_raiz.length > melhor.len) {
          melhor = { slug: a.area_slug, len: a.rota_raiz.length }
        }
      }
    }
    return melhor?.slug ?? null
  }, [areas, pathname])

  // Fallback estatico por path: usado quando useAreasVisiveis ainda nao
  // resolveu ou nao retornou a area (caso cliente CLIENT_OWNER com restricted
  // que filtra demais). NUNCA toca gestao_empresarial (mantem o caminho atual).
  const areaSlugDoPathEstatico = useMemo(() => {
    if (!pathname) return null
    if (pathname === '/dashboard/agro' || pathname.startsWith('/dashboard/agro/')) return 'agro'
    return null
  }, [pathname])

  const areaSlug = queryArea ?? areaPersistida ?? areaSlugDoPath ?? areaSlugDoPathEstatico ?? AREA_GE

  // Sem company/user ainda — espera para evitar GE hardcoded por engano
  const aguardandoContexto = !companyId || !userId

  // Carrega RPC sempre que tiver contexto (SEMPRE inclusive para GE)
  useEffect(() => {
    if (aguardandoContexto) return
    let alive = true
    setRpcLoading(true)
    setRpcErro(null)
    // eslint-disable-next-line no-console
    console.debug('[sidebar] fn_modulos_sidebar_por_area chamando', { areaSlug, companyId, userId })
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('fn_modulos_sidebar_por_area', {
          p_area_id: areaSlug,
          p_company_id: companyId,
          p_user_id: userId,
        })
        if (!alive) return
        if (error) {
          // eslint-disable-next-line no-console
          console.warn('[sidebar] fn_modulos_sidebar_por_area falhou · fallback hardcoded', error.message)
          setRpcErro(error.message)
          setRpcRows(null)
        } else {
          // eslint-disable-next-line no-console
          console.debug('[sidebar] fn_modulos_sidebar_por_area ok', { areaSlug, linhas: (data ?? []).length })
          setRpcRows((data ?? []) as RpcRow[])
        }
      } catch (e) {
        if (alive) {
          setRpcErro(e instanceof Error ? e.message : String(e))
          setRpcRows(null)
        }
      } finally {
        // SEMPRE desliga loading se ainda vivo — evita sidebar travada em "Carregando…"
        if (alive) setRpcLoading(false)
      }
    })()
    return () => { alive = false }
  }, [aguardandoContexto, areaSlug, companyId, userId])

  // Sem contexto ainda: para GE/sem empresa, devolve hardcoded como
  // experiencia razoavel; demais areas seguram em loading.
  if (aguardandoContexto) {
    if (areaSlug === AREA_GE) {
      return { modulos: SIDEBAR_GESTAO_EMPRESARIAL, loading: false, mode: 'hardcoded' }
    }
    return { modulos: [], loading: true, mode: 'rpc' }
  }

  if (rpcErro) {
    // Fallback defensivo de emergencia: nao deixar o usuario sem menu.
    return { modulos: SIDEBAR_GESTAO_EMPRESARIAL, loading: false, mode: 'rpc-error' }
  }

  if (rpcLoading && !rpcRows) {
    return { modulos: [], loading: true, mode: 'rpc' }
  }

  const rows = rpcRows ?? []
  if (rows.length === 0) {
    return { modulos: [], loading: false, mode: 'rpc-empty' }
  }

  return { modulos: rpcRowsToModulos(rows), loading: false, mode: 'rpc' }
}

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

// surfacing-admin-owner · atalho "Usuários & Acessos" no rodapé pro CLIENT_OWNER
// ativo (Master da empresa) que NAO e PS_ADMIN. O painel /dashboard/admin ja
// autoriza e escopa o dono (so a propria empresa · so abas Usuarios+Convites);
// aqui so exibimos o LINK, que a RPC do menu (por plano) nao emite pra ele.
// Aditivo, escopado por papel, reversivel — NAO toca a RPC/resolver de permissao.
const OWNER_ADMIN_MODULO: SidebarModuleNode = {
  id: 'usuarios-acessos-owner',
  label: 'Usuários & Acessos',
  href: '/dashboard/admin',
  status: 'pronto',
  separator: true,
  matchPaths: ['/dashboard/admin'],
}

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

// Labels amigaveis pra secoes que vem cruas da RPC (ex.: PM em 4 blocos).
// Mantemos no front pra nao precisar de migration por cada apresentacao.
const SECAO_LABEL_OVERRIDE: Record<string, string> = {
  PM_COMERCIAL: '1 · Comercial & Entrada',
  PM_PRODUCAO: '2 · Produção & Controle',
  PM_FINANCEIRO: '3 · Financeiro da Produção',
  PM_INTELIGENCIA: '4 · Inteligência & IA',
}

function rpcRowsToModulos(rows: RpcRow[]): SidebarModuleNode[] {
  // RPC ja vem ordenada (secao_ordem, ordem). Agrupar preservando a ordem
  // de aparicao da secao na lista (1a ocorrencia define a posicao).
  const grupos = new Map<string, { label: string; items: SidebarSubItemNode[] }>()

  for (const r of rows) {
    const secaoKey = r.secao ?? 'outros'
    const labelRaw = r.secao_label ?? r.secao ?? 'Outros'
    const label = SECAO_LABEL_OVERRIDE[secaoKey] ?? SECAO_LABEL_OVERRIDE[labelRaw] ?? labelRaw
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
  // FALLBACK (#455): se localStorage nao da company valida, consulta
  // user_companies do usuario logado. Single-company auto-seleciona ela.
  // Sem isso: companyId=null -> aguardandoContexto=true -> loading eterno.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let alive = true
    const aplicar = (v: string | null) => {
      if (!alive) return
      setCompanyId((p) => (p === v ? p : v))
    }
    aplicar(resolveCompanyId())
    setAreaPersistida(lerAreaPersistida())

    // Auto-select user_companies se localStorage nao deu
    ;(async () => {
      if (resolveCompanyId()) return
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

    const interval = setInterval(() => {
      const atual = resolveCompanyId()
      if (atual) aplicar(atual) // so promove com valor valido — preserva auto-select
      const areaAtual = lerAreaPersistida()
      setAreaPersistida((prev) => (prev === areaAtual ? prev : areaAtual))
    }, 800)
    return () => { alive = false; clearInterval(interval) }
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

  // surfacing-admin-owner · e CLIENT_OWNER ativo e NAO PS_ADMIN? (mesma regra do
  // checkAuth de /dashboard/admin: scoped = isOwner && !isSystemAdmin). Se sim,
  // o rodape ganha o atalho "Usuarios & Acessos". Pilar 2: operador/viewer nao entram.
  const [ownerAtalho, setOwnerAtalho] = useState(false)
  useEffect(() => {
    let alive = true
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { if (alive) setOwnerAtalho(false); return }
      const { data: up } = await supabase.from('users').select('system_role').eq('id', user.id).maybeSingle()
      if (up?.system_role) { if (alive) setOwnerAtalho(false); return } // PS_ADMIN ja tem o painel via RPC
      const { data: owner } = await supabase
        .from('tenant_user_roles')
        .select('company_id')
        .eq('user_id', user.id)
        .eq('role', 'CLIENT_OWNER')
        .eq('is_active', true)
        .limit(1)
      if (alive) setOwnerAtalho(!!(owner && owner.length > 0))
    })()
    return () => { alive = false }
  }, [])

  // Resolve area atual (cascata: ?area= > persistida > path > primeira permitida > GE)
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

  const slugsPermitidos = useMemo(
    () => (areas.length > 0 ? new Set(areas.map((a) => a.area_slug)) : null),
    [areas],
  )
  const primeiraPermitida = areas[0]?.area_slug ?? null

  // Cascata bruta
  const cascadeBrute = queryArea ?? areaPersistida ?? areaSlugDoPath ?? AREA_GE

  // Se a area do cascade NAO esta nas permitidas do usuario (caso CLIENT
  // com user_areas_allowed.restricted=true), forca para a 1a permitida.
  // Isso elimina o caso "engenheira de Compliance cai em GE e nao monta o menu".
  // slugsPermitidos==null = nao temos dado ainda (useAreasVisiveis carregando)
  // → mantem cascade bruto pra nao trocar prematuramente.
  const areaSlug = slugsPermitidos && !slugsPermitidos.has(cascadeBrute) && primeiraPermitida
    ? primeiraPermitida
    : cascadeBrute

  // Sem company/user ainda — espera para evitar GE hardcoded por engano
  const aguardandoContexto = !companyId || !userId

  // Normalizar hifen->underscore: URLs usam 'gestao-empresarial' (cascade
  // vem da rota) mas module_catalog.grupo e area_menu_config.area_slug usam
  // 'gestao_empresarial'. Sem normalizar, a RPC filtra `mc.grupo = p_area_id`
  // e retorna 0 linhas — CEO empiricamente confirmado (SPEC):
  //   fn_modulos_sidebar_por_area('gestao_empresarial', KGF, NULL) -> 70 modulos
  //   fn_modulos_sidebar_por_area('gestao-empresarial',  KGF, NULL) -> 0
  // Serve pra TODAS areas com hifen na URL, nao so GE.
  const areaSlugRpc = areaSlug.replace(/-/g, '_')

  // Carrega RPC sempre que tiver contexto (SEMPRE inclusive para GE)
  useEffect(() => {
    if (aguardandoContexto) return
    let alive = true
    setRpcLoading(true)
    setRpcErro(null)
    // eslint-disable-next-line no-console
    console.debug('[sidebar] fn_modulos_sidebar_por_area chamando', { areaSlug, areaSlugRpc, companyId, userId })
    void (async () => {
      try {
        // 3 args explicitos (a RPC aceita p_user_id opcional; passar sempre
        // evita ambiguidade de overload). areaSlugRpc ja com hifen normalizado.
        const rpcName = 'fn_modulos_sidebar_por_area'
        const rpcArgs = {
          p_area_id: areaSlugRpc,
          p_company_id: companyId,
          p_user_id: userId,
        }
        const { data, error } = await supabase.rpc(rpcName, rpcArgs)
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
  }, [aguardandoContexto, areaSlugRpc, companyId, userId])

  // FIX-MENU-GE-FANTASMA (07/07 · CEO decisao): NUNCA renderizar hardcoded
  // como menu real da empresa. Antes: sem contexto na area GE devolvia
  // SIDEBAR_GESTAO_EMPRESARIAL (menu antigo com "Vendas & Fiscal" agrupado),
  // enquanto Gean (com contexto ok) via o menu real da RPC (VENDAS + NF + PDV
  // separados) — inconsistencia entre empresas do mesmo plano.
  // Agora: aguardandoContexto -> loading. Menu real ou nada.
  if (aguardandoContexto) {
    return { modulos: [], loading: true, mode: 'rpc' }
  }

  if (rpcErro) {
    // Fallback defensivo APENAS quando a RPC nao roda por erro real (rede,
    // policy, etc). Nao usado no fluxo normal. Estrutura hardcoded foi
    // realinhada em sidebar-config.ts pra bater com a RPC (Fix 1 CEO).
    return { modulos: SIDEBAR_GESTAO_EMPRESARIAL, loading: false, mode: 'rpc-error' }
  }

  if (rpcLoading && !rpcRows) {
    return { modulos: [], loading: true, mode: 'rpc' }
  }

  const rows = rpcRows ?? []
  if (rows.length === 0) {
    return { modulos: [], loading: false, mode: 'rpc-empty' }
  }

  const modulos = rpcRowsToModulos(rows)
  // Rodape de apoio da Gestao Empresarial: Guia de Implantacao (onboarding
  // sob demanda). Hardcoded aqui pra evitar migration por cada apresentacao
  // — segue o mesmo padrao de SECAO_LABEL_OVERRIDE acima.
  if (areaSlugRpc === AREA_GE) {
    modulos.push({
      id: 'guia_implantacao',
      label: 'Guia de Implantação',
      href: '/dashboard/gestao-empresarial/implantacao',
      status: 'pronto',
      separator: true,
    })
  }
  // surfacing-admin-owner · dono da empresa ganha o atalho pro painel escopado.
  // Dedupe: nao adiciona se algum modulo/RPC ja aponta pra /dashboard/admin.
  if (ownerAtalho && !modulos.some((m) => m.href === '/dashboard/admin' || m.items?.some((s) => s.href === '/dashboard/admin'))) {
    modulos.push(OWNER_ADMIN_MODULO)
  }
  return { modulos, loading: false, mode: 'rpc' }
}

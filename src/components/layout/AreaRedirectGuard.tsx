'use client'

// AreaRedirectGuard: garante que o CONTEUDO central segue a area ATIVA do usuario
// (queryArea > areaPersistida > path > primeira permitida).
//
// 2 cenarios cobertos:
//   1) Path em area NAO PERMITIDA (ex.: engenheira Compliance Frioeste em /dashboard/gestao-empresarial)
//      -> redireciona pra rota_raiz da area ativa.
//   2) Path em area PERMITIDA mas DIFERENTE da area ativa selecionada
//      (ex.: Tryo com persistida=hub mas URL em /dashboard/gestao-empresarial)
//      -> redireciona pra rota_raiz da area ativa.
// Generico: serve hub, compliance, agro, etc.

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAreasVisiveis, type AreaVisivel } from '@/hooks/useAreasVisiveis'

const EMPRESA_STORAGE_KEY = 'ps_empresa_sel'
const AREA_STORAGE_KEY = 'ps_area_sel'

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem(EMPRESA_STORAGE_KEY)
  if (!v || v === 'consolidado' || v.startsWith('group_')) return null
  return v
}

function lerAreaPersistida(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(AREA_STORAGE_KEY) } catch { return null }
}

function areaPorSlug(areas: AreaVisivel[], slug: string | null): AreaVisivel | null {
  if (!slug) return null
  return areas.find((a) => a.area_slug === slug) ?? null
}

function areaPorPath(areas: AreaVisivel[], pathname: string): AreaVisivel | null {
  if (!pathname) return null
  let melhor: AreaVisivel | null = null
  for (const a of areas) {
    if (!a.rota_raiz) continue
    if (pathname === a.rota_raiz || pathname.startsWith(a.rota_raiz + '/')) {
      if (!melhor || a.rota_raiz.length > melhor.rota_raiz.length) melhor = a
    }
  }
  return melhor
}

// Paths que NUNCA disparam redirect (cadastros transversais, telas de admin etc).
const PATHS_LIVRES = ['/dashboard/admin', '/dashboard/cadastros', '/dashboard/conectores']

export default function AreaRedirectGuard() {
  const pathname = usePathname() || ''
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryArea = searchParams?.get('area') ?? null
  const [companyId, setCompanyId] = useState<string | null>(() => resolveCompanyId())
  const [areaPersistida, setAreaPersistida] = useState<string | null>(() => lerAreaPersistida())

  // Polling leve: reage a troca de empresa OU de area no localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const t = setInterval(() => {
      const c = resolveCompanyId()
      setCompanyId((prev) => (prev === c ? prev : c))
      const a = lerAreaPersistida()
      setAreaPersistida((prev) => (prev === a ? prev : a))
    }, 600)
    return () => clearInterval(t)
  }, [])

  const { areas, loading } = useAreasVisiveis(companyId)

  useEffect(() => {
    if (loading || !pathname || areas.length === 0) return
    if (pathname === '/dashboard' || PATHS_LIVRES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return

    // Cascata da area ativa (alinhada ao AreaSwitcher / useSidebarModulos).
    const areaAtiva =
      areaPorSlug(areas, queryArea) ??
      areaPorSlug(areas, areaPersistida) ??
      areaPorPath(areas, pathname) ??
      areas[0] ??
      null

    if (!areaAtiva?.rota_raiz) return

    const areaDoPath = areaPorPath(areas, pathname)

    // Caso 1: path NAO esta em nenhuma area permitida -> redireciona pra ativa.
    if (!areaDoPath) {
      if (areaAtiva.rota_raiz !== pathname) {
        // eslint-disable-next-line no-console
        console.info('[area-guard] path fora das areas permitidas -> redireciona para', areaAtiva.rota_raiz)
        router.replace(areaAtiva.rota_raiz)
      }
      return
    }

    // Caso 2: path esta em area permitida MAS diferente da ativa -> redireciona pra ativa.
    // Pula se o queryArea ja casa com o path (URL explicita).
    if (areaDoPath.area_slug !== areaAtiva.area_slug) {
      if (areaAtiva.rota_raiz !== pathname) {
        // eslint-disable-next-line no-console
        console.info('[area-guard] path em', areaDoPath.area_slug, 'mas ativa e', areaAtiva.area_slug, '-> redireciona para', areaAtiva.rota_raiz)
        router.replace(areaAtiva.rota_raiz)
      }
    }
  }, [pathname, areas, loading, router, queryArea, areaPersistida])

  return null
}

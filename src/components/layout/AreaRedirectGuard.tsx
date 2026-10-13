'use client'

// AreaRedirectGuard: SO redireciona quando o pathname bate com a rota_raiz
// de uma area CONHECIDA mas NAO permitida pra empresa atual (ex.: engenheira
// de Compliance da Frioeste caindo em /dashboard/gestao-empresarial).
//
// Rotas transversais que NAO sao rota_raiz de nenhuma area (financeiro,
// fiscal, orcamentos, etc — usadas por varias areas via module_catalog)
// passam livres. Antes a logica redirecionava QUALQUER path fora das
// rotas_raiz permitidas — capturava /dashboard/financeiro/pagar e jogava
// na home da area, mostrando o onboarding por engano.

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAreasVisiveis } from '@/hooks/useAreasVisiveis'

const EMPRESA_STORAGE_KEY = 'ps_empresa_sel'

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem(EMPRESA_STORAGE_KEY)
  if (!v || v === 'consolidado' || v.startsWith('group_')) return null
  return v
}

const PATHS_LIVRES = ['/dashboard/admin', '/dashboard/cadastros', '/dashboard/conectores']

export default function AreaRedirectGuard() {
  const pathname = usePathname() || ''
  const router = useRouter()
  const companyId = typeof window !== 'undefined' ? resolveCompanyId() : null
  const { areas, loading } = useAreasVisiveis(companyId)

  useEffect(() => {
    if (loading || !pathname || areas.length === 0) return
    if (pathname === '/dashboard' || PATHS_LIVRES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return

    // Path bate com a rota_raiz de ALGUMA area conhecida?
    // (areas vem com todas as areas do sistema + flag empresa_tem_acesso)
    const matchArea = areas.find(
      (a) => a.rota_raiz && (pathname === a.rota_raiz || pathname.startsWith(a.rota_raiz + '/')),
    )

    // Caso 1: path bate com uma area conhecida e ela e PERMITIDA -> ok, passa.
    // Caso 2: path NAO bate com nenhuma area -> rota transversal (financeiro,
    //         fiscal, orcamentos, etc). Modulos do module_catalog sao acessados
    //         via essas rotas e nao moram sob rota_raiz da area. Deixar passar.
    if (!matchArea || matchArea.empresa_tem_acesso) return

    // Caso 3: path bate com rota_raiz de area NAO permitida -> redireciona pra
    // primeira permitida.
    const permitidas = areas.filter((a) => a.empresa_tem_acesso && a.rota_raiz)
    const destino = permitidas[0]?.rota_raiz
    if (destino && destino !== pathname) {
      // eslint-disable-next-line no-console
      console.info('[area-guard] redirecionando para', destino, '— area', matchArea.area_slug, 'nao permitida')
      router.replace(destino)
    }
  }, [pathname, areas, loading, router])

  return null
}

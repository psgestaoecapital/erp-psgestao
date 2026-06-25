'use client'

// AreaRedirectGuard: redireciona o usuario para a primeira area permitida
// quando o pathname atual aponta para uma area que ele nao tem acesso.
// Caso classico: engenheira de Compliance da Frioeste cai em /dashboard/gestao-empresarial
// (ou outra area nao-permitida) — redireciona para /dashboard/compliance.

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

// Paths que NUNCA disparam redirect (cadastros transversais, telas de admin etc).
// Mantem a regra restrita as rotas que pertencem a uma area especifica.
const PATHS_LIVRES = ['/dashboard/admin', '/dashboard/cadastros', '/dashboard/conectores']

export default function AreaRedirectGuard() {
  const pathname = usePathname() || ''
  const router = useRouter()
  const companyId = typeof window !== 'undefined' ? resolveCompanyId() : null
  const { areas, loading } = useAreasVisiveis(companyId)

  useEffect(() => {
    if (loading || !pathname || areas.length === 0) return
    if (pathname === '/dashboard' || PATHS_LIVRES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return

    // Path bate com alguma rota_raiz das areas permitidas?
    const dentroDePermitida = areas.some((a) => a.rota_raiz && (pathname === a.rota_raiz || pathname.startsWith(a.rota_raiz + '/')))
    if (dentroDePermitida) return

    // Cai aqui = path nao pertence a nenhuma area permitida → redireciona pra primeira permitida.
    const destino = areas[0]?.rota_raiz
    if (destino && destino !== pathname) {
      // eslint-disable-next-line no-console
      console.info('[area-guard] redirecionando para', destino, 'porque', pathname, 'nao esta nas areas permitidas')
      router.replace(destino)
    }
  }, [pathname, areas, loading, router])

  return null
}

'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { SIDEBAR_GESTAO_EMPRESARIAL } from '@/lib/menu/sidebar-config'
import { useSidebarState } from '@/lib/menu/sidebar-state'
import SidebarHeader from './SidebarHeader'
import SidebarModule from './SidebarModule'
import SidebarFooter from './SidebarFooter'

export default function Sidebar() {
  const pathname = usePathname() || ''
  const { expandedModule, toggleModule, setActiveModule, isHydrated } = useSidebarState()

  // Auto-expandir modulo pai do item ativo
  useEffect(() => {
    if (!isHydrated) return
    const moduleAtivo = SIDEBAR_GESTAO_EMPRESARIAL.find(
      (m) =>
        m.items?.some((s) => pathname.startsWith(s.href)) ||
        (m.href && pathname.startsWith(m.href))
    )
    if (moduleAtivo && moduleAtivo.id !== expandedModule && moduleAtivo.items) {
      setActiveModule(moduleAtivo.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isHydrated])

  const modulosPrincipais = SIDEBAR_GESTAO_EMPRESARIAL.filter((m) => !m.separator)
  const modulosRodape = SIDEBAR_GESTAO_EMPRESARIAL.filter((m) => m.separator)

  return (
    <aside
      className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-[220px] bg-[#3D2314] text-[#FAF7F2] border-r border-[#4D2E1D] z-30"
    >
      <SidebarHeader />
      <nav className="flex-1 overflow-y-auto py-2">
        {modulosPrincipais.map((modulo) => (
          <SidebarModule
            key={modulo.id}
            modulo={modulo}
            pathname={pathname}
            isExpanded={expandedModule === modulo.id}
            onToggle={() => toggleModule(modulo.id)}
          />
        ))}
      </nav>
      <SidebarFooter
        modulos={modulosRodape}
        pathname={pathname}
        expandedModule={expandedModule}
        onToggle={toggleModule}
      />
    </aside>
  )
}

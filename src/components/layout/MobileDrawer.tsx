'use client'

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { useSidebarState } from '@/lib/menu/sidebar-state'
import { useSidebarModulos } from '@/lib/menu/useSidebarModulos'
import SidebarHeader from './SidebarHeader'
import SidebarModule from './SidebarModule'

export default function MobileDrawer() {
  return (
    <Suspense fallback={null}>
      <MobileDrawerInner />
    </Suspense>
  )
}

function MobileDrawerInner() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname() || ''
  const searchParams = useSearchParams()
  const currentTab = searchParams?.get('tab') ?? null
  const { expandedModule, toggleModule } = useSidebarState()
  const { modulos, loading, mode } = useSidebarModulos()

  // Fecha drawer ao mudar de rota
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  const modulosPrincipais = modulos.filter((m) => !m.separator)
  const modulosRodape = modulos.filter((m) => m.separator)
  const closeDrawer = () => setOpen(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        data-testid="mobile-drawer-toggle"
        className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg text-[#FAF7F2] hover:bg-[#C8941A]/12 transition-colors"
      >
        <Menu size={20} />
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-full w-[85%] max-w-[320px] bg-[#3D2314] text-[#FAF7F2] z-50 md:hidden flex flex-col transform transition-transform duration-300 ease-out shadow-[8px_0_32px_rgba(0,0,0,0.45)] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-end px-3 py-2 border-b border-[#4D2E1D]">
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Fechar menu"
            className="text-[#FAF7F2] hover:bg-white/8 w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <SidebarHeader />

        <nav className="flex-1 overflow-y-auto py-2">
          {loading && (
            <div className="px-4 py-3 text-[12px] text-[#FAF7F2]/60">Carregando menu…</div>
          )}
          {!loading && mode === 'rpc-empty' && (
            <div className="px-4 py-3 text-[12px] text-[#FAF7F2]/60">
              Nenhum módulo disponível para esta área.
            </div>
          )}
          {modulosPrincipais.map((modulo) => (
            <SidebarModule
              key={modulo.id}
              modulo={modulo}
              pathname={pathname}
              currentTab={currentTab}
              isExpanded={expandedModule === modulo.id}
              onToggle={() => toggleModule(modulo.id)}
              onNavigate={closeDrawer}
            />
          ))}
        </nav>

        {modulosRodape.length > 0 && (
          <div className="border-t border-[#4D2E1D] py-2">
            {modulosRodape.map((modulo) => (
              <SidebarModule
                key={modulo.id}
                modulo={modulo}
                pathname={pathname}
                currentTab={currentTab}
                isExpanded={expandedModule === modulo.id}
                onToggle={() => toggleModule(modulo.id)}
                onNavigate={closeDrawer}
              />
            ))}
          </div>
        )}
      </aside>
    </>
  )
}

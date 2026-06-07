'use client'

import type { SidebarModuleNode } from '@/lib/menu/sidebar-config'
import SidebarModule from './SidebarModule'

interface Props {
  modulos: SidebarModuleNode[]
  pathname: string
  currentTab: string | null
  expandedModule: string | null
  onToggle: (moduleId: string) => void
  onNavigate?: () => void
}

export default function SidebarFooter({ modulos, pathname, currentTab, expandedModule, onToggle, onNavigate }: Props) {
  if (modulos.length === 0) return null
  return (
    <div className="border-t border-[#4D2E1D] py-2">
      {modulos.map((modulo) => (
        <SidebarModule
          key={modulo.id}
          modulo={modulo}
          pathname={pathname}
          currentTab={currentTab}
          isExpanded={expandedModule === modulo.id}
          onToggle={() => onToggle(modulo.id)}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

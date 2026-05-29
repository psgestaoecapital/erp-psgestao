'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, ChevronDown } from 'lucide-react'
import {
  DASHBOARD_MENU_GROUPS,
  statusTagClasses,
  statusTagLabel,
} from '@/lib/menu/dashboard-menu-config'
import { AREAS_VISIVEIS, detectarAreaAtiva } from '@/lib/menu/areas-config'

export default function MobileDrawer() {
  const [open, setOpen] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [areasOpen, setAreasOpen] = useState(false)
  const pathname = usePathname() || ''
  const areaAtiva = detectarAreaAtiva(pathname)
  const ActiveAreaIcon = areaAtiva?.icon

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
          className="fixed inset-0 bg-black/55 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-full w-[300px] bg-[#3D2314] z-50 md:hidden transform transition-transform duration-300 overflow-y-auto shadow-[8px_0_32px_rgba(0,0,0,0.4)] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between px-5 py-5 border-b border-[#C8941A]/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#C8941A] rounded-[8px] flex items-center justify-center text-[#3D2314] font-medium text-sm shadow-[0_0_0_1.5px_rgba(200,148,26,0.25)]">
              PS
            </div>
            <div className="leading-[1.15]">
              <div className="text-[14px] font-medium text-[#FAF7F2] tracking-[0.2px]">PS Gestão</div>
              <div className="text-[10px] text-[#FAF7F2]/70 tracking-[1px] font-medium">CAPITAL · ERP</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            className="text-[#FAF7F2] hover:bg-[#C8941A]/12 w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => setAreasOpen((o) => !o)}
            data-testid="mobile-area-toggle"
            aria-expanded={areasOpen}
            className="w-full flex items-center justify-between gap-2 px-3 py-3 rounded-lg bg-[#C8941A]/12 border border-[#C8941A]/30 text-[#FAF7F2] text-[13px] font-medium"
          >
            <span className="flex items-center gap-2.5">
              {areaAtiva && ActiveAreaIcon ? (
                <>
                  <ActiveAreaIcon size={17} className="text-[#C8941A]" />
                  <span>{areaAtiva.label}</span>
                </>
              ) : (
                <span className="text-[#FAF7F2]/70">Selecionar área</span>
              )}
            </span>
            <ChevronDown size={13} className={`opacity-70 transition-transform ${areasOpen ? 'rotate-180' : ''}`} />
          </button>
          {areasOpen && (
            <div className="mt-2 ml-2 pl-3 border-l border-[#C8941A]/20 space-y-0.5">
              {AREAS_VISIVEIS.filter((a) => a.visivel).map((area) => {
                const Icon = area.icon
                const isAtual = areaAtiva?.id === area.id
                return (
                  <Link
                    key={area.id}
                    href={area.hubRoute}
                    onClick={() => {
                      if (typeof window !== 'undefined') localStorage.setItem('area_atual_id', area.id)
                      setOpen(false)
                      setAreasOpen(false)
                    }}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[12.5px] font-medium transition-colors ${
                      isAtual ? 'bg-[#C8941A]/15 text-[#C8941A]' : 'text-[#FAF7F2]/85 hover:bg-[#C8941A]/10'
                    }`}
                  >
                    <Icon size={15} className="text-[#C8941A]" />
                    {area.label}
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <nav className="p-3 pt-2">
          <div className="px-3 py-2 text-[10px] text-[#FAF7F2]/45 tracking-[1px] font-medium">
            MENU DA ÁREA
          </div>
          {DASHBOARD_MENU_GROUPS.map((group) => {
            const GroupIcon = group.icon
            const isExpanded = expandedGroup === group.id
            const isGroupActive = group.items.some((i) => pathname?.startsWith(i.href))
            return (
              <div key={group.id} className="mb-1">
                <button
                  type="button"
                  onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-3 rounded-lg text-[13.5px] font-medium tracking-[0.2px] transition-colors ${
                    isGroupActive || isExpanded
                      ? 'text-[#C8941A] bg-[#C8941A]/10'
                      : 'text-[#FAF7F2] hover:bg-[#C8941A]/12'
                  }`}
                  aria-expanded={isExpanded}
                >
                  <span className="flex items-center gap-3">
                    <GroupIcon size={17} className={isGroupActive || isExpanded ? 'text-[#C8941A]' : 'text-[#FAF7F2]/85'} />
                    {group.label}
                  </span>
                  <ChevronDown
                    size={13}
                    className={`opacity-70 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </button>

                {isExpanded && (
                  <div className="mt-1 ml-2 pl-3 border-l border-[#C8941A]/20 space-y-0.5">
                    {group.items.map((item) => {
                      const ItemIcon = item.icon
                      const isActive = pathname?.startsWith(item.href)
                      return (
                        <Link
                          key={`${item.href}-${item.label}`}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-[12.5px] font-medium transition-colors ${
                            isActive
                              ? 'bg-[#C8941A]/15 text-[#C8941A]'
                              : 'text-[#FAF7F2]/85 hover:bg-[#C8941A]/10 hover:text-[#FAF7F2]'
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <ItemIcon size={15} className="text-[#C8941A]" />
                            {item.label}
                          </span>
                          {item.status && (
                            <span className={`text-[9px] font-medium px-1.5 py-[2px] rounded-full tracking-[0.3px] ${statusTagClasses(item.status)}`}>
                              {statusTagLabel(item.status)}
                            </span>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </aside>
    </>
  )
}

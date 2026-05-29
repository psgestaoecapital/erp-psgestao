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

export default function MobileDrawer() {
  const [open, setOpen] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const pathname = usePathname()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        className="md:hidden flex items-center justify-center w-10 h-10 rounded-md text-[#FAF7F2] hover:bg-white/10"
      >
        <Menu size={20} />
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-full w-72 bg-[#3D2314] z-50 md:hidden transform transition-transform duration-300 overflow-y-auto ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-[#C8941A] rounded-md flex items-center justify-center text-[#3D2314] font-medium text-sm">
              PS
            </div>
            <div className="text-[#FAF7F2] text-sm font-medium leading-tight">
              PS Gestão
              <div className="text-[10px] text-[#FAF7F2]/60 tracking-wider">
                CAPITAL &amp; ERP
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            className="text-[#FAF7F2] hover:bg-white/10 w-8 h-8 rounded-md flex items-center justify-center"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="p-2">
          {DASHBOARD_MENU_GROUPS.map((group) => {
            const GroupIcon = group.icon
            const isExpanded = expandedGroup === group.id
            const isGroupActive = group.items.some((i) => pathname?.startsWith(i.href))
            return (
              <div key={group.id} className="mb-1">
                <button
                  type="button"
                  onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-md text-sm transition-colors ${
                    isGroupActive ? 'text-[#C8941A]' : 'text-[#FAF7F2] hover:bg-white/10'
                  }`}
                  aria-expanded={isExpanded}
                >
                  <span className="flex items-center gap-2.5">
                    <GroupIcon size={16} />
                    {group.label}
                  </span>
                  <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {isExpanded && (
                  <div className="mt-1 pl-2 space-y-0.5">
                    {group.items.map((item) => {
                      const ItemIcon = item.icon
                      const isActive = pathname?.startsWith(item.href)
                      return (
                        <Link
                          key={`${item.href}-${item.label}`}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm ${
                            isActive
                              ? 'bg-[#C8941A]/15 text-[#C8941A] font-medium'
                              : 'text-[#FAF7F2]/80 hover:bg-white/5'
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <ItemIcon size={15} className="text-[#C8941A]" />
                            {item.label}
                          </span>
                          {item.status && (
                            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${statusTagClasses(item.status)}`}>
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

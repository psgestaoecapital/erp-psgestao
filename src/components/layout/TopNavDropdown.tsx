'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import {
  type MenuGroup,
  statusTagClasses,
  statusTagLabel,
} from '@/lib/menu/dashboard-menu-config'

interface Props {
  group: MenuGroup
}

export default function TopNavDropdown({ group }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const Icon = group.icon

  const isGroupActive = group.items.some((i) => pathname?.startsWith(i.href))

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        data-testid={`topnav-group-${group.id}`}
        className={`relative flex items-center gap-[7px] px-3.5 py-[9px] rounded-lg text-[13.5px] font-medium tracking-[0.2px] transition-all duration-150 ${
          isGroupActive || open
            ? 'text-[#C8941A] bg-[#C8941A]/8'
            : 'text-[#FAF7F2] hover:text-[#FAF7F2] hover:bg-[#C8941A]/12'
        }`}
      >
        <Icon size={17} className={isGroupActive || open ? 'text-[#C8941A]' : 'text-[#FAF7F2]/85'} />
        <span>{group.label}</span>
        <ChevronDown
          size={12}
          className={`opacity-70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
        {(isGroupActive || open) && (
          <span className="absolute left-3.5 right-3.5 -bottom-[1px] h-[2px] bg-[#C8941A] rounded-t-[2px]" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 mt-2 min-w-[280px] bg-[#FAF7F2] rounded-2xl p-2 z-50 shadow-[0_1px_2px_rgba(61,35,20,0.05),0_16px_40px_rgba(61,35,20,0.18),0_0_0_0.5px_rgba(61,35,20,0.08)]"
        >
          <div className="px-3 py-2 text-[10px] text-[#3D2314]/55 tracking-[0.8px] font-medium uppercase">
            {group.label}
          </div>
          {group.items.map((item) => {
            const ItemIcon = item.icon
            const isActive = pathname?.startsWith(item.href)
            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                data-testid={`topnav-item-${item.href.replace(/\//g, '-')}`}
                className={`flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                  isActive ? 'bg-[#C8941A]/12 text-[#3D2314]' : 'text-[#3D2314] hover:bg-[#C8941A]/10'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <ItemIcon size={16} className="text-[#C8941A]" />
                  <span>{item.label}</span>
                </span>
                {item.status && (
                  <span className={`text-[9.5px] font-medium px-2 py-[3px] rounded-full tracking-[0.4px] ${statusTagClasses(item.status)}`}>
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
}

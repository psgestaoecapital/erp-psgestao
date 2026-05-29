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
        className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm transition-colors ${
          isGroupActive ? 'text-[#C8941A]' : 'text-[#FAF7F2] hover:bg-white/10'
        }`}
      >
        <Icon size={16} />
        <span>{group.label}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 min-w-[260px] bg-[#FAF7F2] border border-[#3D2314]/15 rounded-lg shadow-lg p-1.5 z-50"
          role="menu"
        >
          {group.items.map((item) => {
            const ItemIcon = item.icon
            const isActive = pathname?.startsWith(item.href)
            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm text-[#3D2314] hover:bg-[#C8941A]/10 transition-colors ${
                  isActive ? 'bg-[#C8941A]/10 font-medium' : ''
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <ItemIcon size={16} className="text-[#C8941A]" />
                  <span>{item.label}</span>
                </span>
                {item.status && (
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusTagClasses(item.status)}`}>
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

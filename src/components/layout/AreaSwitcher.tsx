'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, Sparkles } from 'lucide-react'
import { AREAS_VISIVEIS, detectarAreaAtiva, type AreaConfig } from '@/lib/menu/areas-config'

export default function AreaSwitcher() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname() || ''
  const areaAtiva = detectarAreaAtiva(pathname)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  function selecionarArea(area: AreaConfig) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('area_atual_id', area.id)
    }
    setOpen(false)
  }

  const ActiveIcon = areaAtiva?.icon ?? Sparkles
  const activeLabel = areaAtiva?.label ?? 'Selecionar área'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="area-switcher"
        className="flex items-center gap-2 pl-3 pr-3 py-[7px] rounded-full bg-[#C8941A]/18 hover:bg-[#C8941A]/25 border border-[#C8941A]/45 text-[12px] font-medium text-[#FAF7F2] transition-colors mr-2"
      >
        <ActiveIcon size={14} className="text-[#C8941A]" />
        <span className="hidden sm:inline">{activeLabel}</span>
        <ChevronDown size={12} className="opacity-70" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 mt-2 w-[340px] bg-[#FAF7F2] rounded-2xl p-2 z-50 shadow-[0_1px_2px_rgba(61,35,20,0.05),0_16px_40px_rgba(61,35,20,0.18),0_0_0_0.5px_rgba(61,35,20,0.08)]"
        >
          <div className="px-3 py-2 text-[10px] text-[#3D2314]/55 tracking-[0.8px] font-medium uppercase">
            Trocar de área
          </div>
          <div className="grid grid-cols-2 gap-1">
            {AREAS_VISIVEIS.filter((a) => a.visivel).map((area) => {
              const Icon = area.icon
              const isAtual = areaAtiva?.id === area.id
              return (
                <Link
                  key={area.id}
                  href={area.hubRoute}
                  role="menuitem"
                  onClick={() => selecionarArea(area)}
                  data-testid={`area-${area.id}`}
                  className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg transition-colors ${
                    isAtual
                      ? 'bg-[#C8941A]/12 ring-1 ring-[#C8941A]/30'
                      : 'hover:bg-[#C8941A]/10'
                  }`}
                >
                  <Icon size={18} className="text-[#C8941A] flex-shrink-0 mt-[1px]" />
                  <div className="min-w-0">
                    <div className={`text-[12.5px] font-medium leading-tight ${isAtual ? 'text-[#C8941A]' : 'text-[#3D2314]'}`}>
                      {area.label}
                    </div>
                    {area.description && (
                      <div className="text-[10.5px] text-[#3D2314]/60 leading-[1.4] mt-[2px] line-clamp-2">
                        {area.description}
                      </div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

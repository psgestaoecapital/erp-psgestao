'use client'

import Link from 'next/link'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { SidebarModuleNode } from '@/lib/menu/sidebar-config'
import SidebarSubItem from './SidebarSubItem'

interface Props {
  modulo: SidebarModuleNode
  pathname: string
  isExpanded: boolean
  onToggle: () => void
  onNavigate?: () => void
}

export default function SidebarModule({ modulo, pathname, isExpanded, onToggle, onNavigate }: Props) {
  const hasItems = !!modulo.items?.length
  const isActiveSelf = modulo.href ? pathname.startsWith(modulo.href) : false
  const hasActiveChild = modulo.items?.some((item) => pathname.startsWith(item.href)) ?? false
  const isActive = isActiveSelf || hasActiveChild

  if (!hasItems && modulo.href) {
    return (
      <Link
        href={modulo.href}
        onClick={onNavigate}
        className={[
          'flex items-center justify-between',
          'px-4 py-2.5 text-[13px] font-medium',
          'transition-colors border-l-[3px]',
          isActive
            ? 'bg-[#C8941A]/15 text-[#FAF7F2] border-[#C8941A]'
            : 'text-[#FAF7F2]/85 hover:bg-white/8 border-transparent',
        ].join(' ')}
      >
        <span>{modulo.label}</span>
        {isActive && <span className="text-[#C8941A] text-[10px]">●</span>}
      </Link>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className={[
          'w-full flex items-center justify-between',
          'px-4 py-2.5 text-[13px] font-medium',
          'transition-colors border-l-[3px]',
          hasActiveChild
            ? 'bg-[#C8941A]/15 text-[#FAF7F2] border-[#C8941A]'
            : 'text-[#FAF7F2]/85 hover:bg-white/8 border-transparent',
        ].join(' ')}
      >
        <span>{modulo.label}</span>
        {isExpanded ? (
          <ChevronDown size={14} className="opacity-60" />
        ) : (
          <ChevronRight size={14} className="opacity-60" />
        )}
      </button>

      {isExpanded && modulo.items && (
        <div className="bg-[#2D1A0E]">
          {modulo.items.map((item) => (
            <SidebarSubItem
              key={item.id}
              item={item}
              isActive={pathname.startsWith(item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

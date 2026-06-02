'use client'

import Link from 'next/link'
import type { SidebarSubItemNode } from '@/lib/menu/sidebar-config'

interface Props {
  item: SidebarSubItemNode
  isActive: boolean
  onNavigate?: () => void
}

export default function SidebarSubItem({ item, isActive, onNavigate }: Props) {
  const emBreve = item.status === 'em_breve'
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={[
        'flex items-center justify-between',
        'pl-7 pr-4 py-2 text-[12.5px]',
        'transition-colors',
        'border-l-[3px]',
        isActive
          ? 'bg-[#C8941A]/15 text-[#FAF7F2] font-medium border-[#C8941A]'
          : 'text-[#FAF7F2]/75 hover:bg-white/8 hover:text-[#FAF7F2] border-transparent',
        emBreve ? 'opacity-60' : '',
      ].join(' ')}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className="truncate">{item.label}</span>
        {item.badge && (
          <span className="text-[9px] px-1.5 py-0.5 bg-[#C8941A]/30 text-[#FAF7F2] rounded uppercase tracking-wider flex-shrink-0">
            {item.badge}
          </span>
        )}
        {emBreve && (
          <span className="text-[9px] text-[#FAF7F2]/40 italic flex-shrink-0">em breve</span>
        )}
      </span>
      {isActive && <span className="text-[#C8941A] text-[9px]">●</span>}
    </Link>
  )
}

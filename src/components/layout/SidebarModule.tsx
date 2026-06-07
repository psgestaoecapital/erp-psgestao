'use client'

import Link from 'next/link'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { SidebarModuleNode } from '@/lib/menu/sidebar-config'
import SidebarSubItem from './SidebarSubItem'

interface Props {
  modulo: SidebarModuleNode
  pathname: string
  /** FIX-ESTOQUE-DEEPLINK-ABAS-v1 · tab atual da URL pra distinguir sub-itens
   *  com mesmo pathname (ex: Produtos vs Movimentacoes em /commerce/estoque) */
  currentTab: string | null
  isExpanded: boolean
  onToggle: () => void
  onNavigate?: () => void
}

function itemMatches(pathname: string, currentTab: string | null, href: string, matchPaths?: string[]): boolean {
  // Extrai pathname + tab do href configurado
  const [hrefPath, hrefQs = ''] = href.split('?')
  let hrefTab: string | null = null
  try { hrefTab = new URLSearchParams(hrefQs).get('tab') } catch { /* noop */ }

  const pathHit =
    matchPaths?.some((p) => pathname === p || pathname.startsWith(p + '/'))
    ?? false
  const hrefPathHit = pathname === hrefPath || pathname.startsWith(hrefPath + '/')

  if (!pathHit && !hrefPathHit) return false
  // Se href especifica tab, exige que a tab atual da URL bata.
  if (hrefTab) return currentTab === hrefTab
  // Caso href sem tab, qualquer tab (ou sem) ainda casa pelo pathname.
  // Pra evitar sub-itens "sem tab" pegarem fogo quando ha sub-itens com tab,
  // so mata se tem outro sub-item com tab vazio (proximo SOC).
  return true
}

export default function SidebarModule({ modulo, pathname, currentTab, isExpanded, onToggle, onNavigate }: Props) {
  const hasItems = !!modulo.items?.length
  const isActiveSelf = modulo.href ? itemMatches(pathname, currentTab, modulo.href, modulo.matchPaths) : false
  const hasActiveChild = modulo.items?.some((item) => itemMatches(pathname, currentTab, item.href, item.matchPaths)) ?? false
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
              isActive={itemMatches(pathname, currentTab, item.href, item.matchPaths)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

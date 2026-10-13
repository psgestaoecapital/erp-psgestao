'use client'

import type { ReactNode } from 'react'

export type FiscalStatus = 'autorizada' | 'processando' | 'rejeitada' | 'cancelada' | 'denegada' | string

interface Props {
  status: FiscalStatus
  size?: 'sm' | 'md'
  motivo?: string | null
  children?: ReactNode
}

const STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  autorizada: { bg: 'bg-[#E8F4DC]', text: 'text-[#1B3608]', border: 'border-[#C0DD97]', label: 'Autorizada' },
  processando: { bg: 'bg-[#FAEEDA]', text: 'text-[#633806]', border: 'border-[#E8C387]', label: 'Processando' },
  rejeitada: { bg: 'bg-[#FCEBEB]', text: 'text-[#791F1F]', border: 'border-[#E8A6A5]', label: 'Rejeitada' },
  cancelada: { bg: 'bg-[#3D2314]/8', text: 'text-[#3D2314]', border: 'border-[#3D2314]/20', label: 'Cancelada' },
  denegada: { bg: 'bg-[#FCEBEB]', text: 'text-[#791F1F]', border: 'border-[#E8A6A5]', label: 'Denegada' },
}

export default function FiscalStatusBadge({ status, size = 'md', motivo, children }: Props) {
  const cfg = STYLE[status] ?? { bg: 'bg-[#3D2314]/8', text: 'text-[#3D2314]', border: 'border-[#3D2314]/20', label: status }
  const sz = size === 'sm' ? 'text-[10.5px] px-2 py-0.5' : 'text-[11px] px-2.5 py-0.5'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium border ${sz} ${cfg.bg} ${cfg.text} ${cfg.border}`}
      title={motivo ?? undefined}
    >
      {cfg.label}
      {children}
    </span>
  )
}

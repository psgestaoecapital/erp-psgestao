'use client'
import { ReactNode } from 'react'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'

export default function PlaceholderModulo({
  nome, descricao, icone, status = 'Previsto',
}: { nome: string; descricao?: string; icone?: ReactNode; status?: string }) {
  return (
    <div style={{ background: BG, minHeight: '100%' }} className="p-6">
      <div className="max-w-xl mx-auto rounded-2xl p-8 text-center" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div className="text-4xl mb-3" aria-hidden>{icone ?? '🐂'}</div>
        <div className="text-xs uppercase tracking-widest mb-1" style={{ color: GOLD, fontWeight: 600 }}>
          Pecuária · Em breve
        </div>
        <h1 className="text-xl sm:text-2xl mb-2" style={{ fontFamily: 'ui-serif,Georgia,serif', color: ESP, fontWeight: 600 }}>{nome}</h1>
        <p className="text-sm mb-4" style={{ color: ESP60 }}>
          {descricao ?? 'Este módulo está em desenvolvimento e chega na próxima onda.'}
        </p>
        <span className="inline-block text-[11px] uppercase tracking-wider px-3 py-1 rounded-full font-semibold" style={{ background: '#F0ECE3', color: ESP }}>
          {status}
        </span>
      </div>
    </div>
  )
}

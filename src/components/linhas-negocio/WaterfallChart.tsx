'use client'
import React from 'react'
import type { DREPorLinha } from '@/types/linhas-negocio'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

// Design system PS premium (RD-96) — mesma paleta das telas irmãs da jornada (Divisões / Linhas de negócio).
// Antes: tokens genéricos do shadcn/tailwind (text-muted-foreground, bg-muted, text-green/red/yellow-600) destoavam
// do restante da jornada. Agora cores próprias PS por estilo inline; layout segue em utilitárias.
const DOURADO = '#C8941A'; const BORDA = '#E7DED3'; const TEXTM = '#6b5444'
const BG_NEUTRO = '#F0ECE3'; const POS = '#1A7A4A'; const NEG = '#8B1A1A'
const corScore = (s: number) => (s >= 70 ? POS : s >= 40 ? DOURADO : NEG)

interface Props {
  linhas: DREPorLinha[]
  onLinhaClick?: (linha: DREPorLinha) => void
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const pct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'

export default function WaterfallChart({ linhas, onLinhaClick }: Props) {
  const total = linhas.reduce((s, l) => s + l.cm3, 0)
  const maxAbs = Math.max(...linhas.map(l => Math.abs(l.cm3)), 1)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <p className="text-xs uppercase tracking-wide" style={{ color: TEXTM }}>
            Contribuição Marginal (CM3) por linha
          </p>
          <AjudaCampo chave='ge.linhas.waterfall_cm3' rota='/dashboard/linhas-negocio' />
        </span>
        <p className="text-sm font-medium">{fmt(total)}</p>
      </div>
      {linhas.sort((a, b) => b.cm3 - a.cm3).map(l => {
        const barPct = (Math.abs(l.cm3) / maxAbs) * 100
        const positivo = l.cm3 >= 0
        return (
          <div
            key={l.linha_id}
            onClick={() => onLinhaClick?.(l)}
            className="flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors"
            onMouseEnter={(e) => { e.currentTarget.style.background = BG_NEUTRO }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <div className="flex items-center gap-2 w-40 flex-shrink-0">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: l.linha_cor }}
              />
              <span className="text-xs font-medium truncate">{l.linha_nome}</span>
            </div>
            <div className="flex-1 relative h-6 rounded" style={{ background: BG_NEUTRO }}>
              <div
                className="absolute top-0 h-full rounded transition-all"
                style={{
                  width: barPct + '%',
                  background: positivo ? l.linha_cor : NEG,
                  opacity: 0.8
                }}
              />
            </div>
            <div className="w-28 text-right flex-shrink-0">
              <span className="text-xs font-medium" style={{ color: positivo ? POS : NEG }}>
                {fmt(l.cm3)}
              </span>
              <span className="text-xs ml-1" style={{ color: TEXTM }}>({pct(l.cm3_pct)})</span>
            </div>
            {l.health_score !== undefined && (
              <div className="w-8 flex-shrink-0">
                <div className="text-xs font-bold text-center" style={{ color: corScore(l.health_score ?? 0) }}>
                  {l.health_score}
                </div>
              </div>
            )}
          </div>
        )
      })}
      <div className="flex items-center gap-3 p-2 mt-2" style={{ borderTop: `1px solid ${BORDA}` }}>
        <div className="w-40 flex-shrink-0">
          <span className="text-xs font-bold uppercase tracking-wide">Total</span>
        </div>
        <div className="flex-1" />
        <div className="w-28 text-right flex-shrink-0">
          <span className="text-sm font-bold" style={{ color: total >= 0 ? POS : NEG }}>
            {fmt(total)}
          </span>
        </div>
        <div className="w-8" />
      </div>
    </div>
  )
}

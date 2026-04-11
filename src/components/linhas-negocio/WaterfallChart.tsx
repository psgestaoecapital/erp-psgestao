'use client'
import React from 'react'
import type { DREPorLinha } from '@/types/linhas-negocio'

interface Props {
  linhas: DREPorLinha[]
  onLinhaClick?: (linha: DREPorLinha) => void
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const pct = (v: number) => \`\${v >= 0 ? '+' : ''}\${v.toFixed(1)}%\`

export default function WaterfallChart({ linhas, onLinhaClick }: Props) {
  const total = linhas.reduce((s, l) => s + l.cm3, 0)
  const maxAbs = Math.max(...linhas.map(l => Math.abs(l.cm3)), 1)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Contribuição Marginal (CM3) por linha</p>
        <p className="text-sm font-medium">{fmt(total)}</p>
      </div>
      {linhas.sort((a, b) => b.cm3 - a.cm3).map(l => {
        const barPct = (Math.abs(l.cm3) / maxAbs) * 100
        const positivo = l.cm3 >= 0
        return (
          <div key={l.linha_id} onClick={() => onLinhaClick?.(l)}
            className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2 w-40 flex-shrink-0">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: l.linha_cor }}/>
              <span className="text-xs font-medium truncate">{l.linha_nome}</span>
            </div>
            <div className="flex-1 relative h-6 bg-muted/30 rounded">
              <div
                className="absolute top-0 h-full rounded transition-all"
                style={{
                  width: \`\${barPct}%\`,
                  background: positivo ? l.linha_cor : '#8B1A1A',
                  opacity: 0.8
                }}
              />
            </div>
            <div className="w-28 text-right flex-shrink-0">
              <span className={\`text-xs font-medium \${positivo ? 'text-green-600' : 'text-red-600'}\`}>
                {fmt(l.cm3)}
              </span>
              <span className="text-xs text-muted-foreground ml-1">({pct(l.cm3_pct)})</span>
            </div>
            {l.health_score !== undefined && (
              <div className="w-8 flex-shrink-0">
                <div className={\`text-xs font-bold text-center \${l.health_score >= 70 ? 'text-green-600' : l.health_score >= 40 ? 'text-yellow-600' : 'text-red-600'}\`}>
                  {l.health_score}
                </div>
              </div>
            )}
          </div>
        )
      })}
      <div className="flex items-center gap-3 p-2 border-t mt-2">
        <div className="w-40 flex-shrink-0">
          <span className="text-xs font-bold uppercase tracking-wide">Total</span>
        </div>
        <div className="flex-1"/>
        <div className="w-28 text-right flex-shrink-0">
          <span className={\`text-sm font-bold \${total >= 0 ? 'text-green-600' : 'text-red-600'}\`}>{fmt(total)}</span>
        </div>
        <div className="w-8"/>
      </div>
    </div>
  )
}

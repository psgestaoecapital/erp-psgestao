'use client'
import React from 'react'
import type { DREPorLinha } from '@/types/linhas-negocio'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

// Design system PS premium (RD-96) — mesma paleta das telas irmãs (Divisões / Linhas de negócio).
// Antes: tokens genéricos do shadcn/tailwind (bg-card, bg-muted, text-muted-foreground, text-green/yellow/red-600).
// Agora cores próprias PS por estilo inline; layout segue em utilitárias.
const ESPRESSO = '#3D2314'; const DOURADO = '#C8941A'; const BORDA = '#E7DED3'; const TEXTM = '#6b5444'
const BG_NEUTRO = '#F0ECE3'; const POS = '#1A7A4A'; const NEG = '#8B1A1A'
const SERIF = 'Fraunces, Georgia, serif'
const corScore = (s: number) => (s >= 70 ? POS : s >= 40 ? DOURADO : NEG)

interface Props { linhas: DREPorLinha[] }

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="relative h-2 rounded-full overflow-hidden" style={{ background: BG_NEUTRO }}>
      <div className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
        style={{ width: `${score}%`, background: corScore(score) }}/>
    </div>
  )
}

export default function HealthScorePanel({ linhas }: Props) {
  const sorted = [...linhas].sort((a, b) => (b.health_score ?? 0) - (a.health_score ?? 0))
  const media = linhas.length > 0
    ? Math.round(linhas.reduce((s, l) => s + (l.health_score ?? 0), 0) / linhas.length)
    : 0

  return (
    <div className="rounded-xl p-4" style={{ background: '#fff', border: `1px solid ${BORDA}` }}>
      <div className="flex items-center justify-between mb-4">
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <h3 className="text-sm font-semibold" style={{ color: ESPRESSO, fontFamily: SERIF }}>Health Score por linha</h3>
          <AjudaCampo chave='ge.linhas.health_score' rota='/dashboard/linhas-negocio' />
        </span>
        <div className="text-right">
          <p className="text-xs" style={{ color: TEXTM }}>Média geral</p>
          <p className="text-lg font-bold" style={{ color: corScore(media) }}>{media}</p>
        </div>
      </div>
      <div className="space-y-3">
        {sorted.map(l => (
          <div key={l.linha_id}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: l.linha_cor }}/>
                <span className="text-xs font-medium">{l.linha_nome}</span>
              </div>
              <span className="text-xs font-bold" style={{ color: corScore(l.health_score ?? 0) }}>{l.health_score ?? 0}</span>
            </div>
            <ScoreBar score={l.health_score ?? 0}/>
          </div>
        ))}
      </div>
      <p className="text-xs mt-3" style={{ color: TEXTM }}>
        Score 0–100 baseado em margem CM3, tendência e desvio de budget.
      </p>
    </div>
  )
}

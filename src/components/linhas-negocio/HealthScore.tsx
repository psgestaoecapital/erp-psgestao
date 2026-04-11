'use client'
import React from 'react'
import type { DREPorLinha } from '@/types/linhas-negocio'

interface Props { linhas: DREPorLinha[] }

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? '#1A7A4A' : score >= 40 ? '#C8941A' : '#8B1A1A'
  return (
    <div className="relative h-2 bg-muted rounded-full overflow-hidden">
      <div className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
        style={{ width: `${score}%`, background: color }}/>
    </div>
  )
}

export default function HealthScorePanel({ linhas }: Props) {
  const sorted = [...linhas].sort((a, b) => (b.health_score ?? 0) - (a.health_score ?? 0))
  const media = linhas.length > 0
    ? Math.round(linhas.reduce((s, l) => s + (l.health_score ?? 0), 0) / linhas.length)
    : 0

  return (
    <div className="bg-card border rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Health Score por linha</h3>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Média geral</p>
          <p className={`text-lg font-bold ${media >= 70 ? 'text-green-600' : media >= 40 ? 'text-yellow-600' : 'text-red-600'}`}>{media}</p>
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
              <span className={`text-xs font-bold ${
                (l.health_score ?? 0) >= 70 ? 'text-green-600' :
                (l.health_score ?? 0) >= 40 ? 'text-yellow-600' : 'text-red-600'
              }`}>{l.health_score ?? 0}</span>
            </div>
            <ScoreBar score={l.health_score ?? 0}/>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        Score 0–100 baseado em margem CM3, tendência e desvio de budget.
      </p>
    </div>
  )
}

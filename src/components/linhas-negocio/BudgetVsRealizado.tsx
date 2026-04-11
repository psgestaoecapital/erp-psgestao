'use client'
import React from 'react'
import type { DREPorLinha } from '@/types/linhas-negocio'

interface Props { linhas: DREPorLinha[] }

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export default function BudgetVsRealizado({ linhas }: Props) {
  const comBudget = linhas.filter(l => l.budget_receita !== undefined)
  if (!comBudget.length) return (
    <div className="bg-card border rounded-xl p-4 text-center">
      <p className="text-sm text-muted-foreground">Configure budgets na tela de configuração para ver este painel.</p>
    </div>
  )

  return (
    <div className="bg-card border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">Budget vs Realizado</h3>
      <div className="space-y-3">
        {comBudget.map(l => {
          const realizadoPct = l.budget_receita! > 0 ? (l.receita_bruta / l.budget_receita!) * 100 : 0
          const dentro = realizadoPct >= 90
          return (
            <div key={l.linha_id}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: l.linha_cor }}/>
                  <span className="text-xs font-medium">{l.linha_nome}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-medium">{fmt(l.receita_bruta)}</span>
                  <span className="text-xs text-muted-foreground"> / {fmt(l.budget_receita!)}</span>
                </div>
              </div>
              <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                <div className="absolute left-0 top-0 h-full rounded-full"
                  style={{ width: `${Math.min(realizadoPct, 100)}%`, background: dentro ? '#1A7A4A' : '#C8941A' }}/>
                <div className="absolute top-0 h-full w-px bg-white/50" style={{ left: '100%', transform: 'translateX(-1px)' }}/>
              </div>
              <div className="flex justify-between mt-0.5">
                <span className={`text-xs ${dentro ? 'text-green-600' : 'text-yellow-600'}`}>
                  {realizadoPct.toFixed(0)}% do budget
                </span>
                {l.desvio_pct !== undefined && (
                  <span className={`text-xs ${l.desvio_pct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {l.desvio_pct >= 0 ? '+' : ''}{l.desvio_pct.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

'use client'
import React from 'react'
import type { DREPorLinha } from '@/types/linhas-negocio'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

// Design system PS premium (RD-96) — mesma paleta das telas irmãs (Divisões / Linhas de negócio).
// Antes: tokens genéricos do shadcn/tailwind (bg-card, bg-muted, text-muted-foreground, text-green/yellow/red-600).
const ESPRESSO = '#3D2314'; const DOURADO = '#C8941A'; const BORDA = '#E7DED3'; const TEXTM = '#6b5444'
const BG_NEUTRO = '#F0ECE3'; const POS = '#1A7A4A'; const NEG = '#8B1A1A'
const SERIF = 'Fraunces, Georgia, serif'

interface Props { linhas: DREPorLinha[] }

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export default function BudgetVsRealizado({ linhas }: Props) {
  const comBudget = linhas.filter(l => l.budget_receita !== undefined)
  if (!comBudget.length) return (
    <div className="rounded-xl p-4 text-center" style={{ background: '#fff', border: `1px solid ${BORDA}` }}>
      <p className="text-sm" style={{ color: TEXTM }}>Configure budgets na tela de configuração para ver este painel.</p>
    </div>
  )

  return (
    <div className="rounded-xl p-4" style={{ background: '#fff', border: `1px solid ${BORDA}` }}>
      <span style={{ display: 'inline-flex', alignItems: 'center' }} className="mb-3">
        <h3 className="text-sm font-semibold" style={{ color: ESPRESSO, fontFamily: SERIF }}>Budget vs Realizado</h3>
        <AjudaCampo chave='ge.linhas.budget_realizado' rota='/dashboard/linhas-negocio' />
      </span>
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
                  <span className="text-xs" style={{ color: TEXTM }}> / {fmt(l.budget_receita!)}</span>
                </div>
              </div>
              <div className="relative h-2 rounded-full overflow-hidden" style={{ background: BG_NEUTRO }}>
                <div className="absolute left-0 top-0 h-full rounded-full"
                  style={{ width: `${Math.min(realizadoPct, 100)}%`, background: dentro ? POS : DOURADO }}/>
                <div className="absolute top-0 h-full w-px bg-white/50" style={{ left: '100%', transform: 'translateX(-1px)' }}/>
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-xs" style={{ color: dentro ? POS : DOURADO }}>
                  {realizadoPct.toFixed(0)}% do budget
                </span>
                {l.desvio_pct !== undefined && (
                  <span className="text-xs" style={{ color: l.desvio_pct >= 0 ? POS : NEG }}>
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

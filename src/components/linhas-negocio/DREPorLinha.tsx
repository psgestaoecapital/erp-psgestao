'use client'
import React from 'react'
import type { DREPorLinha } from '@/types/linhas-negocio'

interface Props { linha: DREPorLinha }

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${v.toFixed(1)}%`
const cor = (v: number) => v >= 0 ? 'text-green-600' : 'text-red-600'

export default function DREPorLinhaCard({ linha }: Props) {
  const linhas = [
    { label: 'Receita bruta', valor: linha.receita_bruta, destaque: false, bold: false },
    { label: 'Custos diretos', valor: -linha.custos_diretos, destaque: false, bold: false },
    { label: 'CM1 — Margem Bruta', valor: linha.cm1, pct: linha.cm1_pct, destaque: true, bold: true },
    { label: 'Despesas comerciais', valor: -linha.despesas_comerciais, destaque: false, bold: false },
    { label: 'CM2 — Margem Operacional', valor: linha.cm2, pct: linha.cm2_pct, destaque: true, bold: true },
    { label: 'Overhead rateado', valor: -linha.overhead_rateado, destaque: false, bold: false },
    { label: 'CM3 — Margem Contribuição', valor: linha.cm3, pct: linha.cm3_pct, destaque: true, bold: true },
  ]

  return (
    <div className="bg-card border rounded-xl p-4 space-y-1">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3 h-3 rounded-full" style={{ background: linha.linha_cor }}/>
        <h3 className="text-sm font-semibold">{linha.linha_nome}</h3>
        {linha.health_score !== undefined && (
          <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${
            linha.health_score >= 70 ? 'bg-green-100 text-green-700' :
            linha.health_score >= 40 ? 'bg-yellow-100 text-yellow-700' :
            'bg-red-100 text-red-700'
          }`}>Score {linha.health_score}</span>
        )}
      </div>
      {linhas.map((row, i) => (
        <div key={i} className={`flex items-center justify-between py-1 ${row.destaque ? 'border-t border-b font-medium bg-muted/30 px-2 -mx-2 rounded' : ''}`}>
          <span className={`text-xs ${row.destaque ? 'font-semibold' : 'text-muted-foreground'}`}>{row.label}</span>
          <div className="flex items-center gap-2">
            {row.pct !== undefined && (
              <span className={`text-xs ${cor(row.valor)}`}>{pct(row.pct)}</span>
            )}
            <span className={`text-xs ${row.bold ? 'font-bold ' + cor(row.valor) : ''}`}>{fmt(row.valor)}</span>
          </div>
        </div>
      ))}
      {linha.budget_receita !== undefined && (
        <div className="mt-3 pt-2 border-t">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Budget receita</span>
            <span>{fmt(linha.budget_receita)}</span>
          </div>
          {linha.desvio_pct !== undefined && (
            <div className="flex justify-between text-xs mt-1">
              <span className="text-muted-foreground">Desvio</span>
              <span className={cor(linha.desvio_pct)}>{linha.desvio_pct >= 0 ? '+' : ''}{linha.desvio_pct.toFixed(1)}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

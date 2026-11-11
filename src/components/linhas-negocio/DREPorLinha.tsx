'use client'
import React from 'react'
import type { DREPorLinha } from '@/types/linhas-negocio'

// Design system PS premium (RD-96) — mesma paleta das telas irmãs (Divisões / Linhas de negócio).
// Antes: tokens genéricos do shadcn/tailwind (bg-card, bg-muted, text-muted-foreground, bg/text-green/yellow/red-*).
const ESPRESSO = '#3D2314'; const BORDA = '#E7DED3'; const TEXTM = '#6b5444'
const BG_NEUTRO = '#F0ECE3'; const POS = '#1A7A4A'; const NEG = '#8B1A1A'
const SERIF = 'Fraunces, Georgia, serif'
// Selo de score — fundo claro + texto na cor PS correspondente.
const seloScore = (s: number) =>
  s >= 70 ? { background: '#E3F1E9', color: POS } : s >= 40 ? { background: '#F6ECD4', color: '#8a6410' } : { background: '#F6E1DE', color: NEG }

interface Props { linha: DREPorLinha }

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${v.toFixed(1)}%`
const cor = (v: number) => (v >= 0 ? POS : NEG)

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
    <div className="rounded-xl p-4 space-y-1" style={{ background: '#fff', border: `1px solid ${BORDA}` }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3 h-3 rounded-full" style={{ background: linha.linha_cor }}/>
        <h3 className="text-sm font-semibold" style={{ color: ESPRESSO, fontFamily: SERIF }}>{linha.linha_nome}</h3>
        {linha.health_score !== undefined && (
          <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full" style={seloScore(linha.health_score)}>Score {linha.health_score}</span>
        )}
      </div>
      {linhas.map((row, i) => (
        <div key={i} className="flex items-center justify-between py-1" style={row.destaque ? { borderTop: `1px solid ${BORDA}`, borderBottom: `1px solid ${BORDA}`, fontWeight: 500, background: BG_NEUTRO, padding: '4px 8px', margin: '0 -8px', borderRadius: 6 } : undefined}>
          <span className="text-xs" style={{ color: row.destaque ? ESPRESSO : TEXTM, fontWeight: row.destaque ? 600 : 400 }}>{row.label}</span>
          <div className="flex items-center gap-2">
            {row.pct !== undefined && (
              <span className="text-xs" style={{ color: cor(row.valor) }}>{pct(row.pct)}</span>
            )}
            <span className="text-xs" style={row.bold ? { fontWeight: 700, color: cor(row.valor) } : undefined}>{fmt(row.valor)}</span>
          </div>
        </div>
      ))}
      {linha.budget_receita !== undefined && (
        <div className="mt-3 pt-2" style={{ borderTop: `1px solid ${BORDA}` }}>
          <div className="flex justify-between text-xs">
            <span style={{ color: TEXTM }}>Budget receita</span>
            <span>{fmt(linha.budget_receita)}</span>
          </div>
          {linha.desvio_pct !== undefined && (
            <div className="flex justify-between text-xs mt-1">
              <span style={{ color: TEXTM }}>Desvio</span>
              <span style={{ color: cor(linha.desvio_pct) }}>{linha.desvio_pct >= 0 ? '+' : ''}{linha.desvio_pct.toFixed(1)}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

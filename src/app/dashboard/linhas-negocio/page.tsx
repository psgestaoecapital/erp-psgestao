'use client'
import React, { useState } from 'react'
import { useDREPorLinha, useBenchmark, useLinhasNegocio } from '@/hooks/useLinhasNegocio'
import { useEmpresaAtual } from '@/hooks/useEmpresaAtual'
import WaterfallChart from '@/components/linhas-negocio/WaterfallChart'
import DREPorLinhaCard from '@/components/linhas-negocio/DREPorLinha'
import HealthScorePanel from '@/components/linhas-negocio/HealthScore'
import BudgetVsRealizado from '@/components/linhas-negocio/BudgetVsRealizado'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { DREPorLinha } from '@/types/linhas-negocio'

// Design system PS premium (RD-96) — mesmos tokens das telas irmãs da jornada (Divisões / P&M):
const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const SERIF = 'Fraunces, Georgia, serif'

const mesAtual = new Date().toISOString().slice(0, 7)

export default function LinhasNegocioPage() {
  const [periodo, setPeriodo] = useState(mesAtual)
  const [, setLinhaSelecionada] = useState<DREPorLinha | null>(null)
  const { empresaId, loading: loadingEmpresa } = useEmpresaAtual()
  const { data: dre, loading } = useDREPorLinha(empresaId, periodo)
  const { data: benchmark } = useBenchmark(empresaId, periodo)
  const { linhas } = useLinhasNegocio(empresaId)

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

  if (loadingEmpresa) {
    return <div style={{ background: OFFWHITE, minHeight: '100vh', padding: 32, color: TEXTM, fontSize: 13 }}>Carregando empresa...</div>
  }

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>Gestão Empresarial</div>
            <h1 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, color: ESPRESSO, margin: '2px 0 0' }}>Linhas de negócio</h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>
              Performance e contribuição marginal por linha — visão executiva
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <input type='month' value={periodo} onChange={e => setPeriodo(e.target.value)}
                style={{ border: `1px solid ${BORDA}`, borderRadius: 8, padding: '7px 12px', fontSize: 13, background: '#fff', color: ESPRESSO, minHeight: 40 }}/>
              <AjudaCampo chave='ge.linhas.periodo' />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <a href='/dashboard/linhas-negocio/configurar'
                style={{ fontSize: 13, fontWeight: 700, border: `1px solid ${ESPRESSO}`, color: ESPRESSO, borderRadius: 8, padding: '7px 14px', textDecoration: 'none', background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40 }}>
                ⚙ Configurar
              </a>
              <AjudaCampo chave='ge.linhas.configurar' />
            </span>
          </div>
        </header>

        {!loading && linhas.length === 0 && (
          <div style={{ border: `1px dashed ${DOURADO}`, background: '#fff', borderRadius: 16, padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 400, color: ESPRESSO, margin: '0 0 8px' }}>Configure suas linhas de negócio</h2>
            <p style={{ fontSize: 13, color: TEXTM, margin: '0 auto 16px', maxWidth: 420 }}>
              Saiba exatamente qual parte do seu negócio gera resultado. Cada linha tem sua própria DRE,
              margem de contribuição e health score — com análise de IA incluída.
            </p>
            <a href='/dashboard/linhas-negocio/configurar'
              style={{ display: 'inline-block', background: ESPRESSO, color: '#fff', padding: '9px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
              Criar primeira linha →
            </a>
          </div>
        )}

        {benchmark && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 14 }}>
            {[
              { label: 'Receita total', val: fmt(benchmark.consolidado.receita_total), chave: 'ge.linhas.receita_total' },
              { label: 'CM3 consolidado', val: fmt(benchmark.consolidado.cm3_total), chave: 'ge.linhas.cm3_consolidado' },
              { label: 'Margem CM3', val: benchmark.consolidado.cm3_pct_media.toFixed(1) + '%', chave: 'ge.linhas.margem_cm3' },
              { label: 'Melhor linha', val: benchmark.consolidado.melhor_linha, chave: 'ge.linhas.melhor_linha' },
            ].map((k, i) => (
              <div key={i} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: 16 }}>
                <p style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: TEXTM, textTransform: 'uppercase', letterSpacing: 0.6, margin: 0 }}>{k.label}<AjudaCampo chave={k.chave} /></p>
                <p style={{ fontSize: 22, fontWeight: 700, color: ESPRESSO, margin: '6px 0 0' }}>{k.val}</p>
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 128, color: TEXTM, fontSize: 13 }}>
            Calculando margens por linha...
          </div>
        )}

        {!loading && dre.length > 0 && (
          <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: 16 }}>
            <WaterfallChart linhas={dre} onLinhaClick={setLinhaSelecionada}/>
          </div>
        )}

        {!loading && dre.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: 16 }}>
            {dre.map(l => <DREPorLinhaCard key={l.linha_id} linha={l}/>)}
          </div>
        )}

        {!loading && dre.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))', gap: 20 }}>
            <HealthScorePanel linhas={dre}/>
            <BudgetVsRealizado linhas={dre}/>
          </div>
        )}
      </div>
    </div>
  )
}

'use client'
import React, { useState } from 'react'
import { useDREPorLinha, useBenchmark, useLinhasNegocio } from '@/hooks/useLinhasNegocio'
import { useEmpresaAtual } from '@/hooks/useEmpresaAtual'
import WaterfallChart from '@/components/linhas-negocio/WaterfallChart'
import DREPorLinhaCard from '@/components/linhas-negocio/DREPorLinha'
import HealthScorePanel from '@/components/linhas-negocio/HealthScore'
import BudgetVsRealizado from '@/components/linhas-negocio/BudgetVsRealizado'
import type { DREPorLinha } from '@/types/linhas-negocio'

const mesAtual = new Date().toISOString().slice(0, 7)

export default function LinhasNegocioPage() {
  const [periodo, setPeriodo] = useState(mesAtual)
  const [linhaSelecionada, setLinhaSelecionada] = useState<DREPorLinha | null>(null)
  const { empresaId, loading: loadingEmpresa } = useEmpresaAtual()
  const { data: dre, loading } = useDREPorLinha(empresaId, periodo)
  const { data: benchmark } = useBenchmark(empresaId, periodo)
  const { linhas } = useLinhasNegocio(empresaId)

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

  if (loadingEmpresa) {
    return <div className='p-6 text-sm text-muted-foreground'>Carregando empresa...</div>
  }

  return (
    <div className='p-6 space-y-6 max-w-7xl mx-auto'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold'>Linhas de negócio</h1>
          <p className='text-sm text-muted-foreground mt-0.5'>
            Performance e contribuição marginal por linha — visão executiva
          </p>
        </div>
        <div className='flex items-center gap-3'>
          <input type='month' value={periodo} onChange={e => setPeriodo(e.target.value)}
            className='border rounded px-3 py-1.5 text-sm bg-background'/>
          <a href='/dashboard/linhas-negocio/configurar'
            className='text-sm border rounded px-3 py-1.5 hover:bg-muted transition-colors'>
            ⚙ Configurar
          </a>
        </div>
      </div>

      {!loading && linhas.length === 0 && (
        <div className='border-2 border-dashed rounded-xl p-12 text-center'>
          <div className='text-4xl mb-3'>📊</div>
          <h2 className='text-lg font-semibold mb-2'>Configure suas linhas de negócio</h2>
          <p className='text-sm text-muted-foreground mb-4 max-w-md mx-auto'>
            Saiba exatamente qual parte do seu negócio gera resultado. Cada linha tem sua própria DRE,
            margem de contribuição e health score — com análise de IA incluída.
          </p>
          <a href='/dashboard/linhas-negocio/configurar'
            className='inline-block bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium'>
            Criar primeira linha →
          </a>
        </div>
      )}

      {benchmark && (
        <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
          {[
            { label: 'Receita total', val: fmt(benchmark.consolidado.receita_total) },
            { label: 'CM3 consolidado', val: fmt(benchmark.consolidado.cm3_total) },
            { label: 'Margem CM3', val: benchmark.consolidado.cm3_pct_media.toFixed(1) + '%' },
            { label: 'Melhor linha', val: benchmark.consolidado.melhor_linha },
          ].map((k, i) => (
            <div key={i} className='bg-card border rounded-xl p-4'>
              <p className='text-xs text-muted-foreground uppercase tracking-wide'>{k.label}</p>
              <p className='text-xl font-bold mt-1'>{k.val}</p>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className='flex items-center justify-center h-32 text-muted-foreground text-sm'>
          Calculando margens por linha...
        </div>
      )}

      {!loading && dre.length > 0 && (
        <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
          <div className='lg:col-span-2 bg-card border rounded-xl p-4'>
            <WaterfallChart linhas={dre} onLinhaClick={setLinhaSelecionada}/>
          </div>
          <div>
            <HealthScorePanel linhas={dre}/>
          </div>
        </div>
      )}

      {!loading && dre.length > 0 && (
        <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
          <div className='lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4'>
            {dre.map(l => <DREPorLinhaCard key={l.linha_id} linha={l}/>)}
          </div>
          <div>
            <BudgetVsRealizado linhas={dre}/>
          </div>
        </div>
      )}
    </div>
  )
}

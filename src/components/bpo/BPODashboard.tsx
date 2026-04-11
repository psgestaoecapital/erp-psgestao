'use client'

import React from 'react'
import { useBPOData } from '@/hooks/useBPOData'

interface BPODashboardProps {
  empresaId: string
  periodo?: string
}

export default function BPODashboard({ empresaId, periodo }: BPODashboardProps) {
  const { data, loading, error, summary, refetch } = useBPOData({ empresaId, periodo })

  if (loading) return <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">Carregando BPO...</div>
  if (error) return (
    <div className="flex flex-col items-center gap-3 h-48 justify-center">
      <p className="text-destructive text-sm">{error}</p>
      <button onClick={refetch} className="text-xs underline">Tentar novamente</button>
    </div>
  )

  const receitas = data.filter(l => l.tipo === 'receita').reduce((s, l) => s + Number(l.valor ?? 0), 0)
  const despesas = data.filter(l => l.tipo === 'despesa').reduce((s, l) => s + Number(l.valor ?? 0), 0)
  const resultado = receitas - despesas
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="space-y-4">
      {summary && process.env.NODE_ENV === 'development' && (
        <div className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded">
          BPO: {summary.total_filtrado}/{summary.total_original} lançamentos ({summary.excluidos} excluídos)
        </div>
      )}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Receitas</p>
          <p className="text-xl font-bold text-green-600">{fmt(receitas)}</p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Despesas</p>
          <p className="text-xl font-bold text-red-600">{fmt(despesas)}</p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Resultado</p>
          <p className={`text-xl font-bold ${resultado >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(resultado)}</p>
        </div>
      </div>
    </div>
  )
}

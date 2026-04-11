'use client'

import React from 'react'
import { useBPOData } from '@/hooks/useBPOData'

interface BPODashboardProps {
  empresaId: string
  periodo?: string
}

/**
 * BPODashboard — CORRIGIDO
 * Agora usa useBPOData (filtro unificado com dashboard).
 * Antes usava fetch direto com filtros inconsistentes.
 */
export default function BPODashboard({ empresaId, periodo }: BPODashboardProps) {
  const { data, loading, error, summary, refetch } = useBPOData({ empresaId, periodo })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Carregando dados BPO...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 h-48 justify-center">
        <p className="text-destructive text-sm">{error}</p>
        <button onClick={refetch} className="text-xs underline">Tentar novamente</button>
      </div>
    )
  }

  const receitas = data.filter(l => l.tipo === 'receita')
  const despesas = data.filter(l => l.tipo === 'despesa')
  const totalReceitas = receitas.reduce((s, l) => s + Number(l.valor ?? 0), 0)
  const totalDespesas = despesas.reduce((s, l) => s + Number(l.valor ?? 0), 0)
  const resultado = totalReceitas - totalDespesas

  return (
    <div className="space-y-4">
      {summary && process.env.NODE_ENV === 'development' && (
        <div className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded">
          Filtro BPO: {summary.total_filtrado} de {summary.total_original} lançamentos
          ({summary.excluidos} excluídos por cancelamento/duplicata/empréstimo)
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Receitas</p>
          <p className="text-xl font-bold text-green-600">
            {totalReceitas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Despesas</p>
          <p className="text-xl font-bold text-red-600">
            {totalDespesas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Resultado</p>
          <p className={`text-xl font-bold ${resultado >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {resultado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Data</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Descrição</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Categoria</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Valor</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 50).map((item, i) => (
              <tr key={item.id} className={`border-t ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                <td className="px-4 py-2 text-muted-foreground">
                  {item.data_lancamento ? String(item.data_lancamento).slice(0, 10) : '—'}
                </td>
                <td className="px-4 py-2">{String(item.descricao ?? '—')}</td>
                <td className="px-4 py-2 text-muted-foreground">{String(item.categoria ?? '—')}</td>
                <td className={`px-4 py-2 text-right font-mono ${item.tipo === 'receita' ? 'text-green-600' : 'text-red-600'}`}>
                  {Number(item.valor ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Nenhum lançamento encontrado para o período selecionado.
          </div>
        )}
      </div>
    </div>
  )
}

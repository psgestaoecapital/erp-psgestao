'use client'

// #3188 (Jordana · Gean) · ao abrir um título já lançado (clique na descrição em Receitas/Despesas), a ficha ganha a aba
// "Histórico de pagamentos" ao lado dos dados do lançamento. Inclusão nova (sem editarId) segue só com o formulário.
// O formulário fica montado ao trocar de aba (não perde o que foi digitado).

import React, { useState } from 'react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import HistoricoPagamentosPanel from './HistoricoPagamentosPanel'
import type { TipoTitulo } from '@/lib/financeiro/historicoPagamentos'

const ESP = '#3D2314'
const GOLD = '#C8941A'

export default function FichaTituloAbas({ tipo, editarId, children }: { tipo: TipoTitulo; editarId?: string; children: React.ReactNode }) {
  const [aba, setAba] = useState<'ficha' | 'historico'>('ficha')
  if (!editarId) return <>{children}</>

  const botao = (id: 'ficha' | 'historico', texto: string, testid: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={aba === id}
      data-testid={testid}
      onClick={() => setAba(id)}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer', padding: '12px 4px', fontSize: 14,
        fontWeight: aba === id ? 700 : 500, color: aba === id ? ESP : 'rgba(61,35,20,0.6)',
        borderBottom: `2px solid ${aba === id ? GOLD : 'transparent'}`,
      }}
    >
      {texto}
    </button>
  )

  return (
    <>
      <div role="tablist" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '0 24px', borderBottom: '1px solid #E7DECF', position: 'sticky', top: 0, background: '#FFFFFF', zIndex: 2 }}>
        {botao('ficha', 'Dados do lançamento', 'aba-ficha-titulo')}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {botao('historico', tipo === 'receber' ? 'Histórico de recebimentos' : 'Histórico de pagamentos', 'aba-historico-pagamentos')}
          <AjudaCampo chave="financeiro.historico_pagamentos.aba" rota="/dashboard/financeiro/historico-pagamentos" />
        </span>
      </div>
      <div style={{ display: aba === 'ficha' ? 'block' : 'none' }}>{children}</div>
      {aba === 'historico' && <HistoricoPagamentosPanel tipo={tipo} tituloId={editarId} />}
    </>
  )
}

'use client'

import React, { useState } from 'react'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5', teal: '#009688' }

export default function DashboardCEOPage() {
  const [periodo, setPeriodo] = useState('2026-04')

  // Dados simulados do diagnostico
  const kpis = {
    receitaBruta: 774000, ebitda: -29412, margemEbitda: -3.8,
    endividamento: 2280000, folhaTotal: 330000, breakEven: 871000,
    clientes: 142, ticketMedio: 5450, inadimplencia: 4.2,
    custoFixo: 520000, custoVariavel: 310000,
  }

  const fmt = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 0 })
  const fmtPct = (v: number) => v.toFixed(1) + '%'

  const alertas = [
    { tipo: 'critico', msg: 'EBITDA negativo -3.8% nos ultimos 3 meses', acao: 'Revisar estrutura de custos fixos' },
    { tipo: 'critico', msg: 'Folha com 55% de pagamentos informais', acao: 'Adequar regime trabalhista' },
    { tipo: 'atencao', msg: 'Inadimplencia em 4.2% (meta: 2%)', acao: 'Politica de credito mais rigorosa' },
    { tipo: 'atencao', msg: 'Ponto de equilibrio acima do faturamento medio', acao: 'Reduzir custos fixos ou aumentar margem' },
  ]

  const abcClientes = [
    { nome: 'Cliente Alpha', valor: 185000, pct: 23.9 },
    { nome: 'Cliente Beta', valor: 142000, pct: 18.3 },
    { nome: 'Cliente Gamma', valor: 98000, pct: 12.7 },
    { nome: 'Cliente Delta', valor: 76000, pct: 9.8 },
    { nome: 'Cliente Epsilon', valor: 54000, pct: 7.0 },
  ]

  const dfcl = [
    { mes: 'Jan', rec: 680000, desp: 710000 },
    { mes: 'Fev', rec: 720000, desp: 695000 },
    { mes: 'Mar', rec: 810000, desp: 780000 },
    { mes: 'Abr', rec: 774000, desp: 803000 },
  ]
  const maxDfcl = Math.max(...dfcl.flatMap(d => [d.rec, d.desp]))

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, margin: 0 }}>Dashboard CEO</h1>
          <div style={{ fontSize: 11, color: C.muted }}>PS Assessor | Visao Executiva do Cliente</div>
        </div>
        <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)}
          style={{ background: C.card, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 6, fontSize: 12 }} />
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Receita Bruta/Mes', val: fmt(kpis.receitaBruta), color: C.blue },
          { label: 'EBITDA', val: fmt(kpis.ebitda), color: kpis.ebitda >= 0 ? C.green : C.red },
          { label: 'Margem EBITDA', val: fmtPct(kpis.margemEbitda), color: kpis.margemEbitda >= 0 ? C.green : C.red },
          { label: 'Break-Even', val: fmt(kpis.breakEven), color: kpis.receitaBruta >= kpis.breakEven ? C.green : C.red },
          { label: 'Endividamento', val: fmt(kpis.endividamento), color: C.yellow },
          { label: 'Inadimplencia', val: fmtPct(kpis.inadimplencia), color: kpis.inadimplencia > 3 ? C.red : C.green },
        ].map((s, i) => (
          <div key={i} style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + s.color }}>
            <div style={{ fontSize: 9, color: C.muted }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, marginTop: 2 }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Alertas */}
        <div style={{ background: C.card, borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, color: C.gold, marginBottom: 10 }}>Alertas do Diagnostico</div>
          {alertas.map((a, i) => (
            <div key={i} style={{ padding: '10px 12px', marginBottom: 6, borderRadius: 6, background: C.bg, borderLeft: '3px solid ' + (a.tipo === 'critico' ? C.red : C.yellow) }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: a.tipo === 'critico' ? C.red : C.yellow }}>{a.msg}</div>
              <div style={{ fontSize: 10, color: C.gold, marginTop: 4 }}>Acao: {a.acao}</div>
            </div>
          ))}
        </div>

        {/* ABC Clientes */}
        <div style={{ background: C.card, borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, color: C.gold, marginBottom: 10 }}>Top 5 Clientes (ABC)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ borderBottom: '1px solid ' + C.border }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', color: C.gold }}>Cliente</th>
              <th style={{ padding: '6px 8px', textAlign: 'right', color: C.gold }}>Valor</th>
              <th style={{ padding: '6px 8px', textAlign: 'right', color: C.gold }}>%</th>
            </tr></thead>
            <tbody>
              {abcClientes.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}>
                  <td style={{ padding: '6px 8px' }}>{c.nome}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: C.green }}>{fmt(c.valor)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: C.muted }}>{c.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 9, color: C.muted }}>
            Top 5 = {abcClientes.reduce((s, c) => s + c.pct, 0).toFixed(1)}% da receita (concentracao {abcClientes.reduce((s, c) => s + c.pct, 0) > 60 ? 'ALTA' : 'moderada'})
          </div>
        </div>
      </div>

      {/* DFCL Visual */}
      <div style={{ background: C.card, borderRadius: 8, padding: 16 }}>
        <div style={{ fontWeight: 700, color: C.gold, marginBottom: 12 }}>Fluxo de Caixa Mensal</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', height: 160 }}>
          {dfcl.map((d, i) => {
            const hRec = maxDfcl > 0 ? (d.rec / maxDfcl) * 140 : 0
            const hDesp = maxDfcl > 0 ? (d.desp / maxDfcl) * 140 : 0
            const saldo = d.rec - d.desp
            return (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'flex-end', height: 140 }}>
                  <div style={{ width: 20, height: hRec, background: C.green, borderRadius: '4px 4px 0 0' }} title={'Receita: ' + fmt(d.rec)} />
                  <div style={{ width: 20, height: hDesp, background: C.red, borderRadius: '4px 4px 0 0' }} title={'Despesa: ' + fmt(d.desp)} />
                </div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{d.mes}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: saldo >= 0 ? C.green : C.red }}>{saldo >= 0 ? '+' : ''}{fmt(saldo)}</div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: 10 }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.green, borderRadius: 2, marginRight: 4 }} />Receita</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.red, borderRadius: 2, marginRight: 4 }} />Despesa</span>
        </div>
      </div>
    </div>
  )
}
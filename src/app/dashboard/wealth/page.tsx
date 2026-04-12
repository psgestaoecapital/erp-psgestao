'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', blue: '#42A5F5' }

export default function WealthPage() {
  const [clientes, setClientes] = useState<any[]>([])
  const [portfolios, setPortfolios] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    const [clientesRes, portfoliosRes] = await Promise.all([
      supabase.from('wealth_clientes').select('*').order('nome'),
      supabase.from('wealth_portfolios').select('*'),
    ])
    setClientes(clientesRes.data || [])
    setPortfolios(portfoliosRes.data || [])
    setLoading(false)
  }

  const totalAUM = portfolios.reduce((s, p) => s + (p.valor_atual || 0), 0)
  const totalClientes = clientes.length
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const fmtM = (v: number) => v >= 1000000 ? 'R$ ' + (v / 1000000).toFixed(1) + 'M' : fmt(v)

  const tabStyle = (t: string): React.CSSProperties => ({
    padding: '8px 16px', cursor: 'pointer', borderRadius: '6px 6px 0 0', fontWeight: 600, fontSize: 12,
    background: tab === t ? C.card : 'transparent', color: tab === t ? C.gold : C.muted, border: 'none',
  })

  // Group by asset class
  const byClass = portfolios.reduce((acc, p) => {
    const cls = p.classe_ativo || 'Outros'
    if (!acc[cls]) acc[cls] = { valor: 0, count: 0 }
    acc[cls].valor += p.valor_atual || 0
    acc[cls].count++
    return acc
  }, {} as Record<string, { valor: number; count: number }>)

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, margin: 0 }}>🏰 PS Wealth — Multi Family Office</h1>
        <button onClick={loadData} style={{ background: C.gold, color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>🔄</button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={{ background: C.card, borderRadius: 8, padding: 16, borderTop: '3px solid ' + C.gold }}>
          <div style={{ fontSize: 11, color: C.muted }}>AUM Total</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.gold }}>{fmtM(totalAUM)}</div>
        </div>
        <div style={{ background: C.card, borderRadius: 8, padding: 16, borderTop: '3px solid ' + C.blue }}>
          <div style={{ fontSize: 11, color: C.muted }}>Clientes</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.blue }}>{totalClientes}</div>
        </div>
        <div style={{ background: C.card, borderRadius: 8, padding: 16, borderTop: '3px solid ' + C.green }}>
          <div style={{ fontSize: 11, color: C.muted }}>Portfólios</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.green }}>{portfolios.length}</div>
        </div>
        <div style={{ background: C.card, borderRadius: 8, padding: 16, borderTop: '3px solid ' + C.muted }}>
          <div style={{ fontSize: 11, color: C.muted }}>Ticket Médio</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{totalClientes > 0 ? fmtM(totalAUM / totalClientes) : '-'}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid ' + C.border, marginBottom: 16 }}>
        <button style={tabStyle('overview')} onClick={() => setTab('overview')}>Visão Geral</button>
        <button style={tabStyle('clientes')} onClick={() => setTab('clientes')}>Clientes</button>
        <button style={tabStyle('alocacao')} onClick={() => setTab('alocacao')}>Alocação</button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Carregando...</div>}

      {/* Overview */}
      {tab === 'overview' && !loading && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            {/* Allocation */}
            <div style={{ background: C.card, borderRadius: 8, padding: 16 }}>
              <div style={{ fontWeight: 700, color: C.gold, marginBottom: 12 }}>Alocação por Classe</div>
              {Object.entries(byClass).sort((a, b) => b[1].valor - a[1].valor).map(([cls, data]) => {
                const pct = totalAUM > 0 ? (data.valor / totalAUM) * 100 : 0
                return (
                  <div key={cls} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span>{cls}</span>
                      <span style={{ color: C.gold }}>{pct.toFixed(1)}% — {fmtM(data.valor)}</span>
                    </div>
                    <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: pct + '%', background: C.gold, borderRadius: 3 }} />
                    </div>
                  </div>
                )
              })}
              {Object.keys(byClass).length === 0 && <div style={{ color: C.muted, fontSize: 12 }}>Nenhum portfólio cadastrado</div>}
            </div>

            {/* Recent clients */}
            <div style={{ background: C.card, borderRadius: 8, padding: 16 }}>
              <div style={{ fontWeight: 700, color: C.gold, marginBottom: 12 }}>Clientes Recentes</div>
              {clientes.slice(0, 8).map((c, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid ' + C.border, fontSize: 12 }}>
                  <span>{c.nome}</span>
                  <span style={{ color: C.muted }}>{c.perfil_risco || '-'}</span>
                </div>
              ))}
              {clientes.length === 0 && <div style={{ color: C.muted, fontSize: 12 }}>Nenhum cliente cadastrado</div>}
            </div>
          </div>
        </div>
      )}

      {/* Clientes tab */}
      {tab === 'clientes' && !loading && (
        <div style={{ background: C.card, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>{['Nome', 'CPF/CNPJ', 'Perfil', 'AUM', 'Status'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: C.gold, fontWeight: 600, fontSize: 11 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {clientes.map((c, i) => {
                const clientAUM = portfolios.filter(p => p.cliente_id === c.id).reduce((s, p) => s + (p.valor_atual || 0), 0)
                return (
                  <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}>
                    <td style={{ padding: '8px 12px', fontWeight: 500 }}>{c.nome}</td>
                    <td style={{ padding: '8px 12px', color: C.muted }}>{c.cpf_cnpj || '-'}</td>
                    <td style={{ padding: '8px 12px' }}>{c.perfil_risco || '-'}</td>
                    <td style={{ padding: '8px 12px', color: C.gold, fontWeight: 600 }}>{fmtM(clientAUM)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: c.ativo !== false ? '#1b5e2015' : '#c6282815', color: c.ativo !== false ? C.green : C.red }}>
                        {c.ativo !== false ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {clientes.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: C.muted }}>Nenhum cliente cadastrado</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Alocação tab */}
      {tab === 'alocacao' && !loading && (
        <div style={{ background: C.card, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>{['Ativo', 'Classe', 'Cliente', 'Valor Atual', '% AUM'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Valor Atual' || h === '% AUM' ? 'right' : 'left', color: C.gold, fontWeight: 600, fontSize: 11 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {portfolios.sort((a, b) => (b.valor_atual || 0) - (a.valor_atual || 0)).map((p, i) => {
                const cliente = clientes.find(c => c.id === p.cliente_id)
                return (
                  <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}>
                    <td style={{ padding: '8px 12px', fontWeight: 500 }}>{p.nome_ativo || '-'}</td>
                    <td style={{ padding: '8px 12px', color: C.muted }}>{p.classe_ativo || '-'}</td>
                    <td style={{ padding: '8px 12px' }}>{cliente?.nome || '-'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: C.gold, fontWeight: 600 }}>{fmt(p.valor_atual || 0)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: C.muted }}>{totalAUM > 0 ? ((p.valor_atual || 0) / totalAUM * 100).toFixed(1) + '%' : '-'}</td>
                  </tr>
                )
              })}
              {portfolios.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: C.muted }}>Nenhum portfólio cadastrado</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
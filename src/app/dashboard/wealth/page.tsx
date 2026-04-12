'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', blue: '#42A5F5' }

interface WealthCliente { id: string; nome: string; cpf_cnpj?: string; perfil_risco?: string; ativo?: boolean }
interface WealthPortfolio { id: string; cliente_id: string; nome_ativo?: string; classe_ativo?: string; valor_atual?: number }
interface ClasseData { valor: number; count: number }

export default function WealthPage() {
  const [clientes, setClientes] = useState<WealthCliente[]>([])
  const [portfolios, setPortfolios] = useState<WealthPortfolio[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    const [cRes, pRes] = await Promise.all([
      supabase.from('wealth_clientes').select('*').order('nome'),
      supabase.from('wealth_portfolios').select('*'),
    ])
    setClientes((cRes.data || []) as WealthCliente[])
    setPortfolios((pRes.data || []) as WealthPortfolio[])
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

  const byClass: Record<string, ClasseData> = portfolios.reduce((acc, p) => {
    const cls = p.classe_ativo || 'Outros'
    if (!acc[cls]) acc[cls] = { valor: 0, count: 0 }
    acc[cls].valor += p.valor_atual || 0
    acc[cls].count++
    return acc
  }, {} as Record<string, ClasseData>)

  const classEntries = Object.entries(byClass).sort((a, b) => b[1].valor - a[1].valor)

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, margin: 0 }}>\u{1F3F0} PS Wealth \u2014 Multi Family Office</h1>
        <button onClick={loadData} style={{ background: C.gold, color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>\u{1F504}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'AUM Total', value: fmtM(totalAUM), color: C.gold },
          { label: 'Clientes', value: String(totalClientes), color: C.blue },
          { label: 'Portf\u00f3lios', value: String(portfolios.length), color: C.green },
          { label: 'Ticket M\u00e9dio', value: totalClientes > 0 ? fmtM(totalAUM / totalClientes) : '-', color: C.text },
        ].map((s, i) => (
          <div key={i} style={{ background: C.card, borderRadius: 8, padding: 16, borderTop: '3px solid ' + s.color }}>
            <div style={{ fontSize: 11, color: C.muted }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid ' + C.border, marginBottom: 16 }}>
        <button style={tabStyle('overview')} onClick={() => setTab('overview')}>Vis\u00e3o Geral</button>
        <button style={tabStyle('clientes')} onClick={() => setTab('clientes')}>Clientes</button>
        <button style={tabStyle('alocacao')} onClick={() => setTab('alocacao')}>Aloca\u00e7\u00e3o</button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Carregando...</div>}

      {tab === 'overview' && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          <div style={{ background: C.card, borderRadius: 8, padding: 16 }}>
            <div style={{ fontWeight: 700, color: C.gold, marginBottom: 12 }}>Aloca\u00e7\u00e3o por Classe</div>
            {classEntries.map(([cls, data]) => {
              const pct = totalAUM > 0 ? (data.valor / totalAUM) * 100 : 0
              return (
                <div key={cls} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span>{cls}</span>
                    <span style={{ color: C.gold }}>{pct.toFixed(1)}% \u2014 {fmtM(data.valor)}</span>
                  </div>
                  <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: pct + '%', background: C.gold, borderRadius: 3 }} />
                  </div>
                </div>
              )
            })}
            {classEntries.length === 0 && <div style={{ color: C.muted, fontSize: 12 }}>Nenhum portf\u00f3lio cadastrado</div>}
          </div>

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
      )}

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
              {clientes.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: C.muted }}>Nenhum cliente</td></tr>}
            </tbody>
          </table>
        </div>
      )}

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
              {portfolios.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: C.muted }}>Nenhum portf\u00f3lio</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const COLORS = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350' }

export default function DadosPage() {
  const [lancamentos, setLancamentos] = useState<any[]>([])
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [filtroPeriodo, setFiltroPeriodo] = useState('')
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ receitas: 0, despesas: 0, saldo: 0, count: 0 })

  useEffect(() => {
    supabase.from('empresas').select('id, nome').order('nome').then(({ data }) => {
      if (data && data.length > 0) { setEmpresas(data); setEmpresaSel(data[0].id) }
    })
  }, [])

  const loadData = useCallback(async () => {
    if (!empresaSel) return
    setLoading(true)
    let query = supabase.from('lancamentos').select('*').eq('empresa_id', empresaSel).order('data', { ascending: false }).limit(500)
    if (filtroTipo === 'receita') query = query.gt('valor', 0)
    if (filtroTipo === 'despesa') query = query.lt('valor', 0)
    if (filtroPeriodo) {
      const [ano, mes] = filtroPeriodo.split('-')
      const inicio = filtroPeriodo + '-01'
      const fim = new Date(parseInt(ano), parseInt(mes), 0).toISOString().split('T')[0]
      query = query.gte('data', inicio).lte('data', fim)
    }
    const { data, error } = await query
    if (error) { console.error(error); setLoading(false); return }
    const rows = data || []
    setLancamentos(rows)
    const rec = rows.filter(l => l.valor > 0).reduce((s, l) => s + l.valor, 0)
    const desp = rows.filter(l => l.valor < 0).reduce((s, l) => s + Math.abs(l.valor), 0)
    setStats({ receitas: rec, despesas: desp, saldo: rec - desp, count: rows.length })
    setLoading(false)
  }, [empresaSel, filtroTipo, filtroPeriodo])

  useEffect(() => { loadData() }, [loadData])

  const filtered = lancamentos.filter(l => {
    if (!busca) return true
    const s = busca.toLowerCase()
    return (l.descricao || '').toLowerCase().includes(s) || (l.categoria || '').toLowerCase().includes(s) || (l.fornecedor || '').toLowerCase().includes(s)
  })

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const fmtDate = (d: string) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '-'

  const inputStyle: React.CSSProperties = { background: COLORS.card, border: '1px solid ' + COLORS.border, color: COLORS.text, padding: '8px 12px', borderRadius: 6, fontSize: 13 }

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: COLORS.bg, color: COLORS.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: COLORS.gold, margin: 0 }}>📊 Dados — Lançamentos</h1>
        <button onClick={loadData} style={{ background: COLORS.gold, color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>🔄 Atualizar</button>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={inputStyle}>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={inputStyle}>
          <option value="todos">Todos</option>
          <option value="receita">Receitas</option>
          <option value="despesa">Despesas</option>
        </select>
        <input type="month" value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)} style={inputStyle} />
        <input type="text" placeholder="Buscar descrição, categoria..." value={busca} onChange={e => setBusca(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Receitas', value: fmt(stats.receitas), color: COLORS.green },
          { label: 'Despesas', value: fmt(stats.despesas), color: COLORS.red },
          { label: 'Saldo', value: fmt(stats.saldo), color: stats.saldo >= 0 ? COLORS.green : COLORS.red },
          { label: 'Lançamentos', value: stats.count.toString(), color: COLORS.gold },
        ].map((s, i) => (
          <div key={i} style={{ background: COLORS.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + s.color }}>
            <div style={{ fontSize: 11, color: COLORS.muted }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color, marginTop: 4 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: COLORS.card, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid ' + COLORS.border }}>
              {['Data', 'Descrição', 'Categoria', 'Fornecedor/Cliente', 'Valor'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: COLORS.gold, fontWeight: 600, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: COLORS.muted }}>Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: COLORS.muted }}>Nenhum lançamento encontrado</td></tr>
            ) : filtered.slice(0, 200).map((l, i) => (
              <tr key={l.id || i} style={{ borderBottom: '1px solid ' + COLORS.border }}>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(l.data)}</td>
                <td style={{ padding: '8px 12px', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.descricao || '-'}</td>
                <td style={{ padding: '8px 12px' }}>{l.categoria || '-'}</td>
                <td style={{ padding: '8px 12px' }}>{l.fornecedor || l.cliente || '-'}</td>
                <td style={{ padding: '8px 12px', fontWeight: 600, color: l.valor >= 0 ? COLORS.green : COLORS.red, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(l.valor || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && <div style={{ padding: 10, textAlign: 'center', color: COLORS.muted, fontSize: 11 }}>Mostrando 200 de {filtered.length}</div>}
      </div>
    </div>
  )
}
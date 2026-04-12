'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107' }

const GRUPOS_CUSTO = [
  'Matéria-Prima', 'Embalagens', 'Mão de Obra Direta', 'Mão de Obra Indireta',
  'Energia e Utilidades', 'Manutenção', 'Depreciação', 'Logística e Frete',
  'Impostos sobre Produção', 'Seguros', 'Serviços Terceirizados',
  'Material de Consumo', 'Outros Custos'
]

export default function CustoPage() {
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [periodo, setPeriodo] = useState('')
  const [lancamentos, setLancamentos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('empresas').select('id, nome').order('nome').then(({ data }) => {
      if (data && data.length > 0) { setEmpresas(data); setEmpresaSel(data[0].id) }
    })
    const now = new Date()
    setPeriodo(now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'))
  }, [])

  const loadData = useCallback(async () => {
    if (!empresaSel) return
    setLoading(true)
    let query = supabase.from('lancamentos').select('*').eq('empresa_id', empresaSel).lt('valor', 0)
    if (periodo) {
      const [ano, mes] = periodo.split('-')
      query = query.gte('data', periodo + '-01').lte('data', new Date(parseInt(ano), parseInt(mes), 0).toISOString().split('T')[0])
    }
    const { data } = await query
    setLancamentos(data || [])
    setLoading(false)
  }, [empresaSel, periodo])

  useEffect(() => { loadData() }, [loadData])

  const custosPorGrupo = GRUPOS_CUSTO.map(grupo => {
    const items = lancamentos.filter(l => (l.categoria || 'Outros Custos').includes(grupo) || (grupo === 'Outros Custos' && !GRUPOS_CUSTO.slice(0, 12).some(g => (l.categoria || '').includes(g))))
    const realizado = items.reduce((s, l) => s + Math.abs(l.valor || 0), 0)
    const orcado = realizado * 1.1 // placeholder — idealmente vem da tabela orcamento
    const variacao = orcado > 0 ? ((realizado - orcado) / orcado) * 100 : 0
    return { grupo, realizado, orcado, variacao, count: items.length }
  }).filter(g => g.realizado > 0 || g.orcado > 0)

  const totalReal = custosPorGrupo.reduce((s, g) => s + g.realizado, 0)
  const totalOrc = custosPorGrupo.reduce((s, g) => s + g.orcado, 0)

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const inputStyle: React.CSSProperties = { background: C.card, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 6, fontSize: 13 }

  const semaforoColor = (v: number) => v > 5 ? C.red : v > 0 ? C.yellow : C.green
  const semaforoLabel = (v: number) => v > 5 ? '🔴' : v > 0 ? '🟡' : '🟢'

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, marginBottom: 16 }}>💲 Análise de Custos — 13 Grupos</h1>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={inputStyle}>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)} style={inputStyle} />
        <button onClick={loadData} style={{ background: C.gold, color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>🔄</button>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + C.gold }}>
          <div style={{ fontSize: 11, color: C.muted }}>Custo Total Realizado</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.red }}>{fmt(totalReal)}</div>
        </div>
        <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + C.muted }}>
          <div style={{ fontSize: 11, color: C.muted }}>Custo Total Orçado</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{fmt(totalOrc)}</div>
        </div>
        <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + (totalReal <= totalOrc ? C.green : C.red) }}>
          <div style={{ fontSize: 11, color: C.muted }}>Variação</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: totalReal <= totalOrc ? C.green : C.red }}>
            {totalOrc > 0 ? (((totalReal - totalOrc) / totalOrc) * 100).toFixed(1) + '%' : '-'}
          </div>
        </div>
      </div>

      {/* Cost Table */}
      <div style={{ background: C.card, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid ' + C.border }}>
              {['', 'Grupo de Custo', 'Realizado', 'Orçado', 'Variação %', '% do Total'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Grupo de Custo' ? 'left' : 'right', color: C.gold, fontWeight: 600, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: C.muted }}>Carregando...</td></tr>
            ) : custosPorGrupo.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: C.muted }}>Nenhum custo encontrado no período</td></tr>
            ) : custosPorGrupo.map((g, i) => (
              <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>{semaforoLabel(g.variacao)}</td>
                <td style={{ padding: '8px 12px', fontWeight: 500 }}>{g.grupo}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: C.red }}>{fmt(g.realizado)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: C.muted }}>{fmt(g.orcado)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: semaforoColor(g.variacao) }}>{g.variacao.toFixed(1)}%</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: C.muted }}>{totalReal > 0 ? ((g.realizado / totalReal) * 100).toFixed(1) + '%' : '-'}</td>
              </tr>
            ))}
            {custosPorGrupo.length > 0 && (
              <tr style={{ borderTop: '2px solid ' + C.gold, fontWeight: 700 }}>
                <td style={{ padding: '10px 12px' }}></td>
                <td style={{ padding: '10px 12px', color: C.gold }}>TOTAL</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: C.red }}>{fmt(totalReal)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: C.muted }}>{fmt(totalOrc)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: semaforoColor(totalOrc > 0 ? ((totalReal - totalOrc) / totalOrc) * 100 : 0) }}>
                  {totalOrc > 0 ? (((totalReal - totalOrc) / totalOrc) * 100).toFixed(1) + '%' : '-'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: C.gold }}>100%</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
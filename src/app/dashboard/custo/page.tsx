'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5', teal: '#009688' }

const GRUPOS = [
  { campo: 'materia_prima', label: 'Materia-Prima / Animal Vivo' },
  { campo: 'mao_obra_direta', label: 'Mao de Obra Direta' },
  { campo: 'mao_obra_indireta', label: 'Mao de Obra Indireta' },
  { campo: 'embalagens', label: 'Embalagens' },
  { campo: 'energia', label: 'Energia Eletrica' },
  { campo: 'gas_vapor', label: 'Gas / Vapor' },
  { campo: 'agua_efluentes', label: 'Agua e Efluentes' },
  { campo: 'manutencao', label: 'Manutencao' },
  { campo: 'logistica_interna', label: 'Logistica Interna' },
  { campo: 'depreciacao', label: 'Depreciacao' },
  { campo: 'insumos_quimicos', label: 'Insumos e Quimicos' },
  { campo: 'servicos_terceirizados', label: 'Servicos Terceirizados' },
  { campo: 'outros_custos', label: 'Outros Custos Ind.' },
]

interface CustoRow { grupo: string; campo: string; realizado: number; orcado: number; variacao: number; pctTotal: number }

export default function CustoPage() {
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [periodo, setPeriodo] = useState('')
  const [custos, setCustos] = useState<CustoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fonte, setFonte] = useState<'auto' | 'industrial' | 'lancamentos'>('auto')
  const [fonteUsada, setFonteUsada] = useState('')
  const [volumeTon, setVolumeTon] = useState(0)
  const [cabecas, setCabecas] = useState(0)
  const [especie, setEspecie] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [editValues, setEditValues] = useState<Record<string, { real: number; orc: number }>>({})

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
    let custoRows: CustoRow[] = []
    let usedFonte = ''

    if (fonte === 'auto' || fonte === 'industrial') {
      try {
        const resp = await fetch('/api/industrial/custos?empresa_id=' + empresaSel + '&periodo=' + periodo)
        const data = await resp.json()
        if (data.custos && data.custos.length > 0) {
          const row = data.custos[0]
          usedFonte = 'industrial'
          setEspecie(row.especie || '')
          setVolumeTon(row.volume_ton || 0)
          setCabecas(row.cabecas_abatidas || 0)
          let totalReal = 0
          GRUPOS.forEach(g => { totalReal += (row[g.campo] || 0) })
          custoRows = GRUPOS.map(g => {
            const real = row[g.campo] || 0
            const orc = row['orc_' + g.campo] || 0
            const variacao = orc > 0 ? ((real - orc) / orc) * 100 : 0
            return { grupo: g.label, campo: g.campo, realizado: real, orcado: orc, variacao, pctTotal: totalReal > 0 ? (real / totalReal) * 100 : 0 }
          })
        }
      } catch (e) { /* fallback */ }
    }

    if (custoRows.length === 0 && (fonte === 'auto' || fonte === 'lancamentos')) {
      usedFonte = 'lancamentos'
      setEspecie(''); setVolumeTon(0); setCabecas(0)
      let query = supabase.from('lancamentos').select('*').eq('empresa_id', empresaSel).lt('valor', 0)
      if (periodo) {
        const [ano, mes] = periodo.split('-')
        query = query.gte('data', periodo + '-01').lte('data', new Date(parseInt(ano), parseInt(mes), 0).toISOString().split('T')[0])
      }
      const { data } = await query
      const rows = data || []
      let totalReal = 0
      const grouped: Record<string, number> = {}
      GRUPOS.forEach(g => { grouped[g.campo] = 0 })
      rows.forEach((l: any) => {
        const cat = (l.categoria || '').toLowerCase()
        let matched = false
        GRUPOS.forEach(g => {
          const kw = g.label.toLowerCase().split(/[\s\/]+/)
          if (kw.some((k: string) => k.length > 3 && cat.includes(k))) { grouped[g.campo] += Math.abs(l.valor || 0); matched = true }
        })
        if (!matched) grouped['outros_custos'] += Math.abs(l.valor || 0)
      })
      GRUPOS.forEach(g => { totalReal += grouped[g.campo] })
      custoRows = GRUPOS.map(g => {
        const real = grouped[g.campo]; const orc = real * 1.1
        return { grupo: g.label, campo: g.campo, realizado: real, orcado: orc, variacao: orc > 0 ? ((real - orc) / orc) * 100 : 0, pctTotal: totalReal > 0 ? (real / totalReal) * 100 : 0 }
      })
    }

    setFonteUsada(usedFonte)
    setCustos(custoRows)
    setLoading(false)
  }, [empresaSel, periodo, fonte])

  useEffect(() => { loadData() }, [loadData])

  const totalReal = custos.reduce((s, c) => s + c.realizado, 0)
  const totalOrc = custos.reduce((s, c) => s + c.orcado, 0)
  const totalVar = totalOrc > 0 ? ((totalReal - totalOrc) / totalOrc) * 100 : 0
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const semCor = (v: number) => v > 5 ? C.red : v > 0 ? C.yellow : C.green
  const semLbl = (v: number) => v > 5 ? 'CRIT' : v > 0 ? 'ATN' : 'OK'
  const inputSt: React.CSSProperties = { background: C.card, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 6, fontSize: 13 }

  const saveManual = async () => {
    if (!empresaSel || !periodo) return
    const grupos: Record<string, number> = {}
    const orcamento: Record<string, number> = {}
    GRUPOS.forEach(g => {
      grupos[g.campo] = editValues[g.campo]?.real ?? custos.find(c => c.campo === g.campo)?.realizado ?? 0
      orcamento[g.campo] = editValues[g.campo]?.orc ?? custos.find(c => c.campo === g.campo)?.orcado ?? 0
    })
    try {
      await fetch('/api/industrial/custos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: empresaSel, periodo, grupos, orcamento, fonte: 'manual', volume_ton: volumeTon || null, cabecas: cabecas || null, especie: especie || null }),
      })
      setEditMode(false); loadData(); alert('Custos salvos!')
    } catch (e) { alert('Erro ao salvar') }
  }

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, margin: 0 }}>Analise de Custos</h1>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>13 Grupos | Integrado ao Industrial | Manual ou Automatico</div>
        </div>
        {fonteUsada && (
          <span style={{ fontSize: 10, padding: '4px 10px', borderRadius: 12, fontWeight: 700,
            background: fonteUsada === 'industrial' ? C.teal + '20' : C.blue + '20',
            color: fonteUsada === 'industrial' ? C.teal : C.blue }}>
            Fonte: {fonteUsada === 'industrial' ? 'Modulo Industrial' : 'Lancamentos'}{especie ? ' | ' + especie : ''}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={inputSt}>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)} style={inputSt} />
        <select value={fonte} onChange={e => setFonte(e.target.value as any)} style={inputSt}>
          <option value="auto">Auto (Industrial, depois Lanc.)</option>
          <option value="industrial">So Industrial</option>
          <option value="lancamentos">So Lancamentos</option>
        </select>
        <button onClick={loadData} style={{ background: C.gold, color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>Atualizar</button>
        <button onClick={() => setEditMode(!editMode)} style={{ background: editMode ? C.green : C.card, color: editMode ? '#fff' : C.muted, border: '1px solid ' + C.border, padding: '8px 16px', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
          {editMode ? 'Editando' : 'Editar Manual'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + C.red }}>
          <div style={{ fontSize: 11, color: C.muted }}>Custo Total</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.red }}>{fmt(totalReal)}</div>
        </div>
        <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + C.muted }}>
          <div style={{ fontSize: 11, color: C.muted }}>Orcado</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{fmt(totalOrc)}</div>
        </div>
        <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + semCor(totalVar) }}>
          <div style={{ fontSize: 11, color: C.muted }}>Variacao</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: semCor(totalVar) }}>{totalVar.toFixed(1)}%</div>
        </div>
        {volumeTon > 0 && (
          <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + C.gold }}>
            <div style={{ fontSize: 11, color: C.muted }}>Custo/kg</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.gold }}>R$ {(totalReal / (volumeTon * 1000)).toFixed(2)}</div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: C.card, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ borderBottom: '2px solid ' + C.border }}>
              <th style={{ padding: '8px 8px', textAlign: 'center', color: C.gold, width: 30 }}></th>
              <th style={{ padding: '8px 8px', textAlign: 'left', color: C.gold }}>Grupo</th>
              <th style={{ padding: '8px 8px', textAlign: 'right', color: C.gold }}>Realizado</th>
              <th style={{ padding: '8px 8px', textAlign: 'right', color: C.gold }}>Orcado</th>
              <th style={{ padding: '8px 8px', textAlign: 'right', color: C.gold }}>Var%</th>
              <th style={{ padding: '8px 8px', textAlign: 'right', color: C.gold }}>%Tot</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: C.muted }}>Carregando...</td></tr>
              ) : custos.every(c => c.realizado === 0) ? (
                <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: C.muted }}>Sem dados. Use Editar Manual ou importe via Industrial.</td></tr>
              ) : custos.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}>
                  <td style={{ padding: '5px 6px', textAlign: 'center', fontSize: 9, fontWeight: 700, color: semCor(c.variacao) }}>{semLbl(c.variacao)}</td>
                  <td style={{ padding: '5px 8px' }}>{c.grupo}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: C.red, fontFamily: 'monospace' }}>
                    {editMode ? <input type="number" defaultValue={Math.round(c.realizado)} onChange={e => setEditValues({...editValues, [c.campo]: { real: parseFloat(e.target.value)||0, orc: editValues[c.campo]?.orc??c.orcado }})} style={{ width: 80, background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '2px 4px', borderRadius: 4, fontSize: 11, textAlign: 'right' }} /> : fmt(c.realizado)}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: C.muted, fontFamily: 'monospace' }}>
                    {editMode ? <input type="number" defaultValue={Math.round(c.orcado)} onChange={e => setEditValues({...editValues, [c.campo]: { real: editValues[c.campo]?.real??c.realizado, orc: parseFloat(e.target.value)||0 }})} style={{ width: 80, background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '2px 4px', borderRadius: 4, fontSize: 11, textAlign: 'right' }} /> : fmt(c.orcado)}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: semCor(c.variacao) }}>{c.variacao.toFixed(1)}%</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: C.muted }}>{c.pctTotal.toFixed(1)}%</td>
                </tr>
              ))}
              {custos.some(c => c.realizado > 0) && (
                <tr style={{ borderTop: '2px solid ' + C.gold, fontWeight: 700 }}>
                  <td></td><td style={{ padding: '8px 8px', color: C.gold }}>TOTAL</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: C.red }}>{fmt(totalReal)}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: C.muted }}>{fmt(totalOrc)}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: semCor(totalVar) }}>{totalVar.toFixed(1)}%</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: C.gold }}>100%</td>
                </tr>
              )}
            </tbody>
          </table>
          {editMode && <div style={{ padding: 12, borderTop: '1px solid ' + C.border }}>
            <button onClick={saveManual} style={{ background: C.green, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', width: '100%' }}>Salvar Custos</button>
          </div>}
        </div>

        <div style={{ background: C.card, borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, color: C.gold, marginBottom: 12 }}>Composicao Visual</div>
          {custos.filter(c => c.realizado > 0).map((c, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                <span>{c.grupo}</span><span style={{ color: C.gold }}>{c.pctTotal.toFixed(1)}%</span>
              </div>
              <div style={{ height: 10, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: Math.min(c.pctTotal, 100) + '%', background: c.pctTotal > 15 ? C.red : c.pctTotal > 5 ? C.yellow : C.green, borderRadius: 4 }} />
              </div>
            </div>
          ))}
          {custos.every(c => c.realizado === 0) && <div style={{ color: C.muted, fontSize: 12, textAlign: 'center', padding: 20 }}>Sem dados</div>}
          <div style={{ marginTop: 16, padding: 10, background: C.bg, borderRadius: 6, fontSize: 10, color: C.muted, borderLeft: '3px solid ' + C.teal }}>
            <b style={{ color: C.teal }}>Fontes:</b> Auto busca Industrial primeiro, depois Lancamentos. Editar Manual salva na tabela custos_industriais.
          </div>
        </div>
      </div>
    </div>
  )
}
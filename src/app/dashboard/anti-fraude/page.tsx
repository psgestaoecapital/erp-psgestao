'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5' }

interface Alerta {
  tipo: string; descricao: string; risco: 'alto' | 'medio' | 'baixo'
  itens: any[]; valor: number
}

export default function AntiFraudePage() {
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [lancamentos, setLancamentos] = useState<any[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [loading, setLoading] = useState(true)
  const [analisado, setAnalisado] = useState(false)

  useEffect(() => {
    supabase.from('empresas').select('id, nome').order('nome').then(({ data }) => {
      if (data && data.length > 0) { setEmpresas(data); setEmpresaSel(data[0].id) }
    })
  }, [])

  const analisar = useCallback(async () => {
    if (!empresaSel) return
    setLoading(true); setAnalisado(false)
    const { data } = await supabase.from('lancamentos').select('*').eq('empresa_id', empresaSel).order('data', { ascending: false }).limit(2000)
    const rows = data || []
    setLancamentos(rows)

    const alerts: Alerta[] = []

    // 1. Duplicatas exatas (mesmo valor, data, descrição)
    const seen = new Map<string, any[]>()
    rows.forEach(l => {
      const key = l.data + '|' + l.valor + '|' + (l.descricao || '').toLowerCase().trim()
      if (!seen.has(key)) seen.set(key, [])
      seen.get(key)!.push(l)
    })
    const dupes = Array.from(seen.values()).filter(g => g.length > 1)
    if (dupes.length > 0) {
      const items = dupes.flat()
      alerts.push({ tipo: '🔴 Lançamentos Duplicados', descricao: dupes.length + ' grupos de lançamentos com mesma data, valor e descrição', risco: 'alto', itens: items, valor: items.reduce((s, l) => s + Math.abs(l.valor || 0), 0) })
    }

    // 2. Valores redondos suspeitos (acima de R$10K, terminando em 000)
    const redondos = rows.filter(l => Math.abs(l.valor || 0) >= 10000 && Math.abs(l.valor) % 1000 === 0)
    if (redondos.length > 0) {
      alerts.push({ tipo: '🟡 Valores Redondos Altos', descricao: redondos.length + ' lançamentos acima de R$10K com valor exatamente redondo', risco: 'medio', itens: redondos, valor: redondos.reduce((s, l) => s + Math.abs(l.valor || 0), 0) })
    }

    // 3. Lançamentos em finais de semana
    const weekends = rows.filter(l => {
      if (!l.data) return false
      const d = new Date(l.data + 'T12:00:00')
      return d.getDay() === 0 || d.getDay() === 6
    })
    if (weekends.length > 0) {
      alerts.push({ tipo: '🟡 Lançamentos em Fim de Semana', descricao: weekends.length + ' lançamentos registrados em sábado ou domingo', risco: 'medio', itens: weekends, valor: weekends.reduce((s, l) => s + Math.abs(l.valor || 0), 0) })
    }

    // 4. Sem descrição
    const semDesc = rows.filter(l => !l.descricao || l.descricao.trim().length < 3)
    if (semDesc.length > 0) {
      alerts.push({ tipo: '🟡 Sem Descrição', descricao: semDesc.length + ' lançamentos sem descrição adequada', risco: 'medio', itens: semDesc, valor: semDesc.reduce((s, l) => s + Math.abs(l.valor || 0), 0) })
    }

    // 5. Sequência de mesmo valor
    const valCount = new Map<number, any[]>()
    rows.forEach(l => {
      const v = Math.abs(l.valor || 0)
      if (v > 100) {
        if (!valCount.has(v)) valCount.set(v, [])
        valCount.get(v)!.push(l)
      }
    })
    const repetidos = Array.from(valCount.entries()).filter(([, g]) => g.length >= 5)
    repetidos.forEach(([val, items]) => {
      alerts.push({ tipo: '🟠 Valor Repetido ' + items.length + 'x', descricao: 'R$ ' + val.toFixed(2) + ' aparece ' + items.length + ' vezes', risco: 'medio', itens: items, valor: val * items.length })
    })

    // 6. Outliers (valor > 3x a média)
    const vals = rows.map(l => Math.abs(l.valor || 0)).filter(v => v > 0)
    const media = vals.reduce((s, v) => s + v, 0) / (vals.length || 1)
    const outliers = rows.filter(l => Math.abs(l.valor || 0) > media * 3 && Math.abs(l.valor || 0) > 1000)
    if (outliers.length > 0) {
      alerts.push({ tipo: '🔴 Valores Atípicos', descricao: outliers.length + ' lançamentos com valor superior a 3x a média (R$' + media.toFixed(0) + ')', risco: 'alto', itens: outliers, valor: outliers.reduce((s, l) => s + Math.abs(l.valor || 0), 0) })
    }

    setAlertas(alerts.sort((a, b) => (a.risco === 'alto' ? 0 : a.risco === 'medio' ? 1 : 2) - (b.risco === 'alto' ? 0 : b.risco === 'medio' ? 1 : 2)))
    setLoading(false)
    setAnalisado(true)
  }, [empresaSel])

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const fmtDate = (d: string) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '-'
  const riscoColor = (r: string) => r === 'alto' ? C.red : r === 'medio' ? C.yellow : C.green
  const inputStyle: React.CSSProperties = { background: C.card, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 6, fontSize: 13 }

  const altos = alertas.filter(a => a.risco === 'alto').length
  const medios = alertas.filter(a => a.risco === 'medio').length

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, marginBottom: 16 }}>🛡️ Anti-Fraude — Detecção de Anomalias</h1>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={inputStyle}>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <button onClick={analisar} style={{ background: C.gold, color: '#3D2314', border: 'none', padding: '10px 24px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
          🔍 ANALISAR LANÇAMENTOS
        </button>
      </div>

      {analisado && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
          <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + C.blue }}>
            <div style={{ fontSize: 11, color: C.muted }}>Analisados</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.blue }}>{lancamentos.length}</div>
          </div>
          <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + C.red }}>
            <div style={{ fontSize: 11, color: C.muted }}>Risco Alto</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.red }}>{altos}</div>
          </div>
          <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + C.yellow }}>
            <div style={{ fontSize: 11, color: C.muted }}>Risco Médio</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.yellow }}>{medios}</div>
          </div>
          <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + (altos === 0 ? C.green : C.red) }}>
            <div style={{ fontSize: 11, color: C.muted }}>Status</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: altos === 0 ? C.green : C.red }}>{altos === 0 ? '✅ OK' : '⚠️ Atenção'}</div>
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Analisando lançamentos...</div>}

      {alertas.map((a, i) => (
        <div key={i} style={{ background: C.card, borderRadius: 8, padding: 14, marginBottom: 10, borderLeft: '4px solid ' + riscoColor(a.risco) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{a.tipo}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: riscoColor(a.risco) }}>{fmt(a.valor)}</div>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{a.descricao}</div>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 11, color: C.gold }}>Ver {a.itens.length} lançamentos</summary>
            <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr>{['Data', 'Descrição', 'Valor'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: C.gold }}>{h}</th>)}</tr></thead>
                <tbody>{a.itens.slice(0, 50).map((l, j) => (
                  <tr key={j} style={{ borderTop: '1px solid ' + C.border }}>
                    <td style={{ padding: '4px 8px' }}>{fmtDate(l.data)}</td>
                    <td style={{ padding: '4px 8px' }}>{l.descricao || '-'}</td>
                    <td style={{ padding: '4px 8px', color: l.valor >= 0 ? C.green : C.red }}>{fmt(l.valor || 0)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </div>
      ))}

      {analisado && alertas.length === 0 && (
        <div style={{ background: C.card, borderRadius: 8, padding: 30, textAlign: 'center', borderLeft: '4px solid ' + C.green }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Nenhuma anomalia detectada</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{lancamentos.length} lançamentos analisados</div>
        </div>
      )}
    </div>
  )
}
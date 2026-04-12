'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5' }

const STATUS_EXCL = new Set(['CANCELADO','CANCELADA','ESTORNADO','ESTORNADA','DEVOLVIDO','DEVOLVIDA','ANULADO','ANULADA'])

interface Lancamento { data: string; descricao: string; valor: number; categoria: string; fornecedor: string; tipo: string }
interface Alerta { tipo: string; descricao: string; risco: 'alto' | 'medio' | 'baixo'; itens: Lancamento[]; valor: number }

function extractLancamentos(imports: any[]): Lancamento[] {
  const rows: Lancamento[] = []
  const clienteNomes: Record<string, string> = {}

  for (const imp of imports) {
    if (imp.import_type === 'clientes') {
      const cls = imp.import_data?.clientes_cadastro || []
      if (Array.isArray(cls)) {
        for (const c of cls) {
          const cod = String(c.codigo_cliente_omie || c.codigo_cliente || c.codigo || '')
          clienteNomes[cod] = c.nome_fantasia || c.razao_social || c.nome || ''
        }
      }
    }
  }

  for (const imp of imports) {
    if (imp.import_type === 'contas_receber') {
      const regs = imp.import_data?.conta_receber_cadastro || []
      if (!Array.isArray(regs)) continue
      for (const r of regs) {
        const st = (r.status_titulo || '').toUpperCase().trim()
        if (STATUS_EXCL.has(st)) continue
        const v = Number(r.valor_documento) || 0
        if (v <= 0) continue
        const codCF = String(r.codigo_cliente_fornecedor || '')
        rows.push({
          data: r.data_emissao || r.data_vencimento || '',
          descricao: r.observacao || r.descricao_categoria || '',
          valor: v,
          categoria: r.descricao_categoria || r.codigo_categoria || '',
          fornecedor: clienteNomes[codCF] || 'Cliente ' + codCF,
          tipo: 'receita',
        })
      }
    }
    if (imp.import_type === 'contas_pagar') {
      const regs = imp.import_data?.conta_pagar_cadastro || []
      if (!Array.isArray(regs)) continue
      for (const r of regs) {
        const st = (r.status_titulo || '').toUpperCase().trim()
        if (STATUS_EXCL.has(st)) continue
        const v = Number(r.valor_documento) || 0
        if (v <= 0) continue
        const codCF = String(r.codigo_cliente_fornecedor || r.codigo_fornecedor || '')
        rows.push({
          data: r.data_emissao || r.data_vencimento || '',
          descricao: r.observacao || r.descricao_categoria || '',
          valor: -v,
          categoria: r.descricao_categoria || r.codigo_categoria || '',
          fornecedor: clienteNomes[codCF] || r.observacao || 'Fornecedor ' + codCF,
          tipo: 'despesa',
        })
      }
    }
    // Support imported CSV data
    if (imp.import_type === 'import_csv') {
      const regs = imp.import_data?.registros || []
      if (Array.isArray(regs)) {
        for (const r of regs) {
          rows.push({
            data: r.data || '',
            descricao: r.descricao || '',
            valor: Number(r.valor) || 0,
            categoria: r.categoria || '',
            fornecedor: r.fornecedor || '',
            tipo: (Number(r.valor) || 0) >= 0 ? 'receita' : 'despesa',
          })
        }
      }
    }
  }
  return rows.sort((a, b) => (b.data || '').localeCompare(a.data || ''))
}

export default function AntiFraudePage() {
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [loading, setLoading] = useState(true)
  const [analisado, setAnalisado] = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: up } = await supabase.from('users').select('role').eq('id', user.id).single()
      let comps: any[] = []
      if (up?.role === 'adm' || up?.role === 'acesso_total') {
        const { data } = await supabase.from('companies').select('id, nome_fantasia, razao_social').order('nome_fantasia')
        comps = data || []
      } else {
        const { data: uc } = await supabase.from('user_companies').select('companies(id, nome_fantasia, razao_social)').eq('user_id', user.id)
        comps = (uc || []).map((u: any) => u.companies).filter(Boolean)
      }
      const mapped = comps.map((c: any) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social || 'Sem nome' }))
      if (mapped.length > 0) { setEmpresas(mapped); setEmpresaSel(mapped[0].id) }
      setLoading(false)
    }
    load()
  }, [])

  const analisar = useCallback(async () => {
    if (!empresaSel) return
    setLoading(true); setAnalisado(false)

    const { data: imports } = await supabase.from('omie_imports').select('import_type, import_data').eq('company_id', empresaSel)
    const rows = extractLancamentos(imports || [])
    setLancamentos(rows)

    const alerts: Alerta[] = []

    // 1. Duplicatas exatas
    const seen = new Map<string, Lancamento[]>()
    rows.forEach(l => {
      const key = l.data + '|' + Math.abs(l.valor) + '|' + (l.descricao || '').toLowerCase().trim()
      if (!seen.has(key)) seen.set(key, [])
      seen.get(key)!.push(l)
    })
    const dupes = Array.from(seen.values()).filter(g => g.length > 1)
    if (dupes.length > 0) {
      const items = dupes.flat()
      alerts.push({ tipo: 'Lancamentos Duplicados', descricao: dupes.length + ' grupos com mesma data, valor e descricao', risco: 'alto', itens: items, valor: items.reduce((s, l) => s + Math.abs(l.valor || 0), 0) })
    }

    // 2. Valores redondos
    const redondos = rows.filter(l => Math.abs(l.valor || 0) >= 10000 && Math.abs(l.valor) % 1000 === 0)
    if (redondos.length > 0) {
      alerts.push({ tipo: 'Valores Redondos Altos', descricao: redondos.length + ' lancamentos acima de R$10K com valor redondo', risco: 'medio', itens: redondos, valor: redondos.reduce((s, l) => s + Math.abs(l.valor || 0), 0) })
    }

    // 3. Finais de semana
    const weekends = rows.filter(l => {
      if (!l.data) return false
      const d = new Date(l.data + 'T12:00:00')
      return d.getDay() === 0 || d.getDay() === 6
    })
    if (weekends.length > 0) {
      alerts.push({ tipo: 'Lancamentos em Fim de Semana', descricao: weekends.length + ' lancamentos em sabado ou domingo', risco: 'medio', itens: weekends, valor: weekends.reduce((s, l) => s + Math.abs(l.valor || 0), 0) })
    }

    // 4. Sem descricao
    const semDesc = rows.filter(l => !l.descricao || l.descricao.trim().length < 3)
    if (semDesc.length > 0) {
      alerts.push({ tipo: 'Sem Descricao', descricao: semDesc.length + ' lancamentos sem descricao adequada', risco: 'medio', itens: semDesc, valor: semDesc.reduce((s, l) => s + Math.abs(l.valor || 0), 0) })
    }

    // 5. Valor repetido
    const valCount = new Map<number, Lancamento[]>()
    rows.forEach(l => {
      const v = Math.abs(l.valor || 0)
      if (v > 100) {
        if (!valCount.has(v)) valCount.set(v, [])
        valCount.get(v)!.push(l)
      }
    })
    const repetidos = Array.from(valCount.entries()).filter(([, g]) => g.length >= 5)
    repetidos.forEach(([val, items]) => {
      alerts.push({ tipo: 'Valor Repetido ' + items.length + 'x', descricao: 'R$ ' + val.toFixed(2) + ' aparece ' + items.length + ' vezes', risco: 'medio', itens: items, valor: val * items.length })
    })

    // 6. Outliers
    const vals = rows.map(l => Math.abs(l.valor || 0)).filter(v => v > 0)
    const media = vals.reduce((s, v) => s + v, 0) / (vals.length || 1)
    const outliers = rows.filter(l => Math.abs(l.valor || 0) > media * 3 && Math.abs(l.valor || 0) > 1000)
    if (outliers.length > 0) {
      alerts.push({ tipo: 'Valores Atipicos', descricao: outliers.length + ' lancamentos com valor superior a 3x a media (R$' + media.toFixed(0) + ')', risco: 'alto', itens: outliers, valor: outliers.reduce((s, l) => s + Math.abs(l.valor || 0), 0) })
    }

    setAlertas(alerts.sort((a, b) => (a.risco === 'alto' ? 0 : a.risco === 'medio' ? 1 : 2) - (b.risco === 'alto' ? 0 : b.risco === 'medio' ? 1 : 2)))
    setLoading(false)
    setAnalisado(true)
  }, [empresaSel])

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const fmtDate = (d: string) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '-'
  const riscoColor = (r: string) => r === 'alto' ? C.red : r === 'medio' ? C.yellow : C.green
  const riscoIcon = (r: string) => r === 'alto' ? '!!' : r === 'medio' ? '!' : ''
  const inputStyle: React.CSSProperties = { background: C.card, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 6, fontSize: 13 }

  const altos = alertas.filter(a => a.risco === 'alto').length
  const medios = alertas.filter(a => a.risco === 'medio').length

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, marginBottom: 16 }}>Anti-Fraude - Deteccao de Anomalias</h1>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={inputStyle}>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <button onClick={analisar} style={{ background: C.gold, color: '#3D2314', border: 'none', padding: '10px 24px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
          ANALISAR LANCAMENTOS
        </button>
        <a href="/dashboard/bpo" style={{ padding: '10px 16px', border: '1px solid ' + C.border, borderRadius: 6, color: C.text, textDecoration: 'none', fontSize: 12, display: 'flex', alignItems: 'center' }}>BPO</a>
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
            <div style={{ fontSize: 11, color: C.muted }}>Risco Medio</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.yellow }}>{medios}</div>
          </div>
          <div style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + (altos === 0 ? C.green : C.red) }}>
            <div style={{ fontSize: 11, color: C.muted }}>Status</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: altos === 0 ? C.green : C.red }}>{altos === 0 ? 'OK' : 'Atencao'}</div>
          </div>
        </div>
      )}

      {loading && !analisado && <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Carregando empresas...</div>}

      {alertas.map((a, i) => (
        <div key={i} style={{ background: C.card, borderRadius: 8, padding: 14, marginBottom: 10, borderLeft: '4px solid ' + riscoColor(a.risco) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{riscoIcon(a.risco)} {a.tipo}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: riscoColor(a.risco) }}>{fmt(a.valor)}</div>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{a.descricao}</div>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 11, color: C.gold }}>Ver {a.itens.length} lancamentos</summary>
            <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr>{['Data', 'Descricao', 'Fornecedor', 'Valor'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: C.gold }}>{h}</th>)}</tr></thead>
                <tbody>{a.itens.slice(0, 50).map((l, j) => (
                  <tr key={j} style={{ borderTop: '1px solid ' + C.border }}>
                    <td style={{ padding: '4px 8px' }}>{fmtDate(l.data)}</td>
                    <td style={{ padding: '4px 8px' }}>{l.descricao || '-'}</td>
                    <td style={{ padding: '4px 8px' }}>{l.fornecedor || '-'}</td>
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
          <div style={{ fontSize: 36, marginBottom: 8 }}>OK</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Nenhuma anomalia detectada</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{lancamentos.length} lancamentos analisados</div>
        </div>
      )}

      <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 20 }}>
        PS Gestao e Capital - Anti-Fraude v8.5.1 | Fonte: omie_imports + import_csv | Conectado ao BPO
      </div>
    </div>
  )
}
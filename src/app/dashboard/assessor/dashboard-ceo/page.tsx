'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5', teal: '#009688' }

const STATUS_EXCL = new Set(['CANCELADO','CANCELADA','ESTORNADO','ESTORNADA','DEVOLVIDO','DEVOLVIDA','ANULADO','ANULADA'])

export default function DashboardCEOPage() {
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<any>(null)
  const [alertas, setAlertas] = useState<any[]>([])
  const [abcClientes, setAbcClientes] = useState<any[]>([])
  const [dfcl, setDfcl] = useState<any[]>([])

  useEffect(() => { loadEmpresas() }, [])
  useEffect(() => { if (empresaSel) loadData() }, [empresaSel])

  const loadEmpresas = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
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
    if (mapped.length > 0) {
      setEmpresas(mapped)
      const saved = typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : ''
      const match = mapped.find(e => e.id === saved)
      setEmpresaSel(match ? match.id : mapped[0].id)
    }
    setLoading(false)
  }

  const loadData = async () => {
    setLoading(true)
    const { data: imports } = await supabase.from('omie_imports').select('import_type, import_data').eq('company_id', empresaSel)

    const nomes: Record<string, string> = {}
    let totalRec = 0, totalDesp = 0, totalVencido = 0, countRec = 0
    const clienteMap: Record<string, number> = {}
    const mesMap: Record<string, { rec: number; desp: number }> = {}
    const alerts: any[] = []

    for (const imp of (imports || [])) {
      if (imp.import_type === 'clientes') {
        const cls = imp.import_data?.clientes_cadastro || []
        if (Array.isArray(cls)) for (const c of cls) {
          const cod = String(c.codigo_cliente_omie || c.codigo_cliente || c.codigo || '')
          nomes[cod] = c.nome_fantasia || c.razao_social || ''
        }
      }
    }

    for (const imp of (imports || [])) {
      if (imp.import_type === 'contas_receber') {
        const regs = imp.import_data?.conta_receber_cadastro || []
        if (!Array.isArray(regs)) continue
        for (const r of regs) {
          const st = (r.status_titulo || '').toUpperCase().trim()
          if (STATUS_EXCL.has(st)) continue
          const v = Number(r.valor_documento) || 0
          if (v <= 0) continue
          totalRec += v; countRec++
          if (st === 'VENCIDO' || st === 'ATRASADO') totalVencido += v
          const codCF = String(r.codigo_cliente_fornecedor || '')
          const nome = nomes[codCF] || 'Cliente ' + codCF
          clienteMap[nome] = (clienteMap[nome] || 0) + v
          const mes = (r.data_emissao || r.data_vencimento || '').substring(0, 7)
          if (mes) { if (!mesMap[mes]) mesMap[mes] = { rec: 0, desp: 0 }; mesMap[mes].rec += v }
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
          totalDesp += v
          const mes = (r.data_emissao || r.data_vencimento || '').substring(0, 7)
          if (mes) { if (!mesMap[mes]) mesMap[mes] = { rec: 0, desp: 0 }; mesMap[mes].desp += v }
        }
      }
    }

    const resultado = totalRec - totalDesp
    const margem = totalRec > 0 ? (resultado / totalRec) * 100 : 0
    const inadimplencia = totalRec > 0 ? (totalVencido / totalRec) * 100 : 0
    const ticketMedio = countRec > 0 ? totalRec / countRec : 0

    // Alertas
    if (resultado < 0) alerts.push({ tipo: 'critico', msg: 'Resultado negativo: despesas superam receitas em ' + fmt(Math.abs(resultado)), acao: 'Revisar estrutura de custos e precificacao' })
    if (margem < 5 && margem >= 0) alerts.push({ tipo: 'atencao', msg: 'Margem muito baixa: ' + margem.toFixed(1) + '%', acao: 'Aumentar precos ou reduzir custos variaveis' })
    if (inadimplencia > 3) alerts.push({ tipo: 'atencao', msg: 'Inadimplencia em ' + inadimplencia.toFixed(1) + '% (meta: abaixo de 3%)', acao: 'Politica de credito mais rigorosa' })
    if (totalRec === 0 && totalDesp === 0) alerts.push({ tipo: 'info', msg: 'Nenhum dado financeiro encontrado', acao: 'Importe dados via Omie ou CSV' })

    // ABC
    const abc = Object.entries(clienteMap).map(([nome, valor]) => {
      const pct = totalRec > 0 ? (valor / totalRec) * 100 : 0
      return { nome, valor, pct: Math.round(pct * 10) / 10 }
    }).sort((a, b) => b.valor - a.valor).slice(0, 10)

    // DFCL
    const dfclData = Object.entries(mesMap).map(([mes, v]) => ({
      mes: mes.substring(5) + '/' + mes.substring(2, 4),
      rec: v.rec, desp: v.desp, saldo: v.rec - v.desp, mesKey: mes,
    })).sort((a, b) => a.mesKey.localeCompare(b.mesKey)).slice(-6)

    setKpis({ receitaBruta: totalRec, despesaTotal: totalDesp, resultado, margem, inadimplencia, ticketMedio, totalVencido, clientes: Object.keys(clienteMap).length })
    setAlertas(alerts)
    setAbcClientes(abc)
    setDfcl(dfclData)
    setLoading(false)
  }

  const fmt = (v: number) => 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 0 })
  const fmtPct = (v: number) => v.toFixed(1) + '%'
  const inputSt: React.CSSProperties = { background: C.card, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 6, fontSize: 12 }

  const maxDfcl = Math.max(...dfcl.flatMap(d => [d.rec, d.desp]), 1)

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.muted, background: C.bg, minHeight: '100vh' }}>Carregando...</div>

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, margin: 0 }}>Dashboard CEO</h1>
          <div style={{ fontSize: 11, color: C.muted }}>PS Assessor | Visao Executiva — Dados Reais</div>
        </div>
        <select value={empresaSel} onChange={e => { setEmpresaSel(e.target.value); if (typeof window !== 'undefined') localStorage.setItem('ps_empresa_sel', e.target.value) }} style={{ ...inputSt, width: 220 }}>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </div>

      {kpis && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Receita Total', val: fmt(kpis.receitaBruta), color: C.blue },
            { label: 'Despesa Total', val: fmt(kpis.despesaTotal), color: C.red },
            { label: 'Resultado', val: (kpis.resultado >= 0 ? '+' : '') + fmt(kpis.resultado), color: kpis.resultado >= 0 ? C.green : C.red },
            { label: 'Margem', val: fmtPct(kpis.margem), color: kpis.margem >= 10 ? C.green : kpis.margem >= 0 ? C.yellow : C.red },
            { label: 'Inadimplencia', val: fmtPct(kpis.inadimplencia), color: kpis.inadimplencia > 3 ? C.red : C.green },
            { label: 'Clientes Ativos', val: String(kpis.clientes), color: C.teal },
          ].map((s, i) => (
            <div key={i} style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + s.color }}>
              <div style={{ fontSize: 9, color: C.muted }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: s.color, marginTop: 2 }}>{s.val}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Alertas */}
        <div style={{ background: C.card, borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, color: C.gold, marginBottom: 10 }}>Alertas ({alertas.length})</div>
          {alertas.length === 0 && <div style={{ fontSize: 12, color: C.green, padding: 10 }}>Nenhum alerta - empresa saudavel</div>}
          {alertas.map((a, i) => (
            <div key={i} style={{ padding: '10px 12px', marginBottom: 6, borderRadius: 6, background: C.bg, borderLeft: '3px solid ' + (a.tipo === 'critico' ? C.red : a.tipo === 'info' ? C.blue : C.yellow) }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: a.tipo === 'critico' ? C.red : a.tipo === 'info' ? C.blue : C.yellow }}>{a.msg}</div>
              <div style={{ fontSize: 10, color: C.gold, marginTop: 4 }}>Acao: {a.acao}</div>
            </div>
          ))}
        </div>

        {/* ABC */}
        <div style={{ background: C.card, borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, color: C.gold, marginBottom: 10 }}>Top Clientes (ABC)</div>
          {abcClientes.length === 0 ? (
            <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>Sem dados de clientes</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ borderBottom: '1px solid ' + C.border }}>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: C.gold }}>Cliente</th>
                <th style={{ padding: '6px 8px', textAlign: 'right', color: C.gold }}>Valor</th>
                <th style={{ padding: '6px 8px', textAlign: 'right', color: C.gold }}>%</th>
              </tr></thead>
              <tbody>
                {abcClientes.slice(0, 8).map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}>
                    <td style={{ padding: '5px 8px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nome}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: C.green }}>{fmt(c.valor)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: C.muted }}>{c.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {abcClientes.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 9, color: C.muted }}>
              Top {Math.min(5, abcClientes.length)} = {abcClientes.slice(0, 5).reduce((s, c) => s + c.pct, 0).toFixed(1)}% da receita
            </div>
          )}
        </div>
      </div>

      {/* DFCL */}
      {dfcl.length > 0 && (
        <div style={{ background: C.card, borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, color: C.gold, marginBottom: 12 }}>Fluxo de Caixa Mensal</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', height: 160 }}>
            {dfcl.map((d, i) => {
              const hRec = (d.rec / maxDfcl) * 140
              const hDesp = (d.desp / maxDfcl) * 140
              return (
                <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'flex-end', height: 140 }}>
                    <div style={{ width: 20, height: Math.max(hRec, 2), background: C.green, borderRadius: '4px 4px 0 0' }} title={'Receita: ' + fmt(d.rec)} />
                    <div style={{ width: 20, height: Math.max(hDesp, 2), background: C.red, borderRadius: '4px 4px 0 0' }} title={'Despesa: ' + fmt(d.desp)} />
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{d.mes}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: d.saldo >= 0 ? C.green : C.red }}>{d.saldo >= 0 ? '+' : ''}{fmt(d.saldo)}</div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: 10 }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.green, borderRadius: 2, marginRight: 4 }} />Receita</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.red, borderRadius: 2, marginRight: 4 }} />Despesa</span>
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 16 }}>
        PS Gestao e Capital - Dashboard CEO v8.6.1 | Dados reais de omie_imports
      </div>
    </div>
  )
}
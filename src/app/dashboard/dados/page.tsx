'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const COLORS = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350' }

const STATUS_EXCL = new Set(['CANCELADO','CANCELADA','ESTORNADO','ESTORNADA','DEVOLVIDO','DEVOLVIDA','ANULADO','ANULADA'])

interface Lancamento { data: string; descricao: string; valor: number; categoria: string; fornecedor: string; tipo: string; documento: string }

function extractLancamentos(imports: any[]): Lancamento[] {
  const rows: Lancamento[] = []
  const clienteNomes: Record<string, string> = {}
  for (const imp of imports) {
    if (imp.import_type === 'clientes') {
      const cls = imp.import_data?.clientes_cadastro || []
      if (Array.isArray(cls)) for (const c of cls) {
        const cod = String(c.codigo_cliente_omie || c.codigo_cliente || c.codigo || '')
        clienteNomes[cod] = c.nome_fantasia || c.razao_social || ''
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
        rows.push({ data: r.data_emissao || r.data_vencimento || '', descricao: r.observacao || r.descricao_categoria || '', valor: v, categoria: r.descricao_categoria || '', fornecedor: clienteNomes[codCF] || 'Cliente ' + codCF, tipo: 'receita', documento: r.numero_documento || '' })
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
        rows.push({ data: r.data_emissao || r.data_vencimento || '', descricao: r.observacao || r.descricao_categoria || '', valor: -v, categoria: r.descricao_categoria || '', fornecedor: clienteNomes[codCF] || r.observacao || '', tipo: 'despesa', documento: r.numero_documento || '' })
      }
    }
    if (imp.import_type === 'import_csv') {
      const regs = imp.import_data?.registros || []
      if (Array.isArray(regs)) for (const r of regs) {
        rows.push({ data: r.data || '', descricao: r.descricao || '', valor: Number(r.valor) || 0, categoria: r.categoria || 'Importado', fornecedor: r.fornecedor || '', tipo: (Number(r.valor) || 0) >= 0 ? 'receita' : 'despesa', documento: '' })
      }
    }
  }
  return rows.sort((a, b) => (b.data || '').localeCompare(a.data || ''))
}

export default function DadosPage() {
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ receitas: 0, despesas: 0, saldo: 0, count: 0 })

  useEffect(() => {
    const load = async () => {
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
      if (mapped.length > 0) { setEmpresas(mapped); setEmpresaSel(mapped[0].id) }
      setLoading(false)
    }
    load()
  }, [])

  const loadData = useCallback(async () => {
    if (!empresaSel) return
    setLoading(true)
    const { data: imports } = await supabase.from('omie_imports').select('import_type, import_data').eq('company_id', empresaSel)
    const rows = extractLancamentos(imports || [])

    let filtered = rows
    if (filtroTipo === 'receita') filtered = rows.filter(l => l.valor > 0)
    if (filtroTipo === 'despesa') filtered = rows.filter(l => l.valor < 0)

    setLancamentos(filtered)
    const rec = filtered.filter(l => l.valor > 0).reduce((s, l) => s + l.valor, 0)
    const desp = filtered.filter(l => l.valor < 0).reduce((s, l) => s + Math.abs(l.valor), 0)
    setStats({ receitas: rec, despesas: desp, saldo: rec - desp, count: filtered.length })
    setLoading(false)
  }, [empresaSel, filtroTipo])

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
        <h1 style={{ fontSize: 22, fontWeight: 700, color: COLORS.gold, margin: 0 }}>Dados - Lancamentos</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <a href="/dashboard/bpo" style={{ padding: '8px 14px', border: '1px solid ' + COLORS.border, borderRadius: 6, color: COLORS.text, textDecoration: 'none', fontSize: 11 }}>BPO</a>
          <button onClick={loadData} style={{ background: COLORS.gold, color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>Atualizar</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={inputStyle}>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={inputStyle}>
          <option value="todos">Todos</option>
          <option value="receita">Receitas</option>
          <option value="despesa">Despesas</option>
        </select>
        <input type="text" placeholder="Buscar descricao, categoria..." value={busca} onChange={e => setBusca(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Receitas', value: fmt(stats.receitas), color: COLORS.green },
          { label: 'Despesas', value: fmt(stats.despesas), color: COLORS.red },
          { label: 'Saldo', value: fmt(stats.saldo), color: stats.saldo >= 0 ? COLORS.green : COLORS.red },
          { label: 'Lancamentos', value: stats.count.toString(), color: COLORS.gold },
        ].map((s, i) => (
          <div key={i} style={{ background: COLORS.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + s.color }}>
            <div style={{ fontSize: 11, color: COLORS.muted }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color, marginTop: 4 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: COLORS.card, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid ' + COLORS.border }}>
              {['Data', 'Descricao', 'Categoria', 'Fornecedor/Cliente', 'Valor'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: COLORS.gold, fontWeight: 600, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: COLORS.muted }}>Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: COLORS.muted }}>Nenhum lancamento encontrado. Importe dados via Omie ou CSV.</td></tr>
            ) : filtered.slice(0, 200).map((l, i) => (
              <tr key={i} style={{ borderBottom: '1px solid ' + COLORS.border }}>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(l.data)}</td>
                <td style={{ padding: '8px 12px', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.descricao || '-'}</td>
                <td style={{ padding: '8px 12px' }}>{l.categoria || '-'}</td>
                <td style={{ padding: '8px 12px' }}>{l.fornecedor || '-'}</td>
                <td style={{ padding: '8px 12px', fontWeight: 600, color: l.valor >= 0 ? COLORS.green : COLORS.red, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(l.valor || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && <div style={{ padding: 10, textAlign: 'center', color: COLORS.muted, fontSize: 11 }}>Mostrando 200 de {filtered.length}</div>}
      </div>

      <div style={{ fontSize: 10, color: COLORS.muted, textAlign: 'center', marginTop: 16 }}>
        PS Gestao e Capital - Dados v8.5.1 | Fonte: omie_imports + import_csv | Conectado ao BPO
      </div>
    </div>
  )
}
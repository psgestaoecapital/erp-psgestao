'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0C0C0A', card: '#1A1410', card2: '#201C16', bd: '#2A2822', go: '#C8941A', gol: '#E8C872', tx: '#FAF7F2', txm: '#B0AB9F', txd: '#706C64', g: '#22C55E', r: '#EF4444', y: '#FBBF24', b: '#60A5FA', tl: '#2DD4BF', p: '#A855F7' }

const STATUS_EXCL = new Set(['CANCELADO','CANCELADA','ESTORNADO','ESTORNADA','DEVOLVIDO','DEVOLVIDA','ANULADO','ANULADA'])

interface Lanc { data: string; descricao: string; valor: number; categoria: string; fornecedor: string; tipo: string; documento: string }

function extractLancs(imports: any[]): Lanc[] {
  const rows: Lanc[] = []
  const nomes: Record<string, string> = {}
  for (const imp of imports) {
    if (imp.import_type === 'clientes') {
      const cls = imp.import_data?.clientes_cadastro || []
      if (Array.isArray(cls)) for (const c of cls) nomes[String(c.codigo_cliente_omie || c.codigo_cliente || c.codigo || '')] = c.nome_fantasia || c.razao_social || ''
    }
  }
  for (const imp of imports) {
    if (imp.import_type === 'contas_receber') {
      const regs = imp.import_data?.conta_receber_cadastro || []
      if (Array.isArray(regs)) for (const r of regs) {
        const st = (r.status_titulo || '').toUpperCase().trim(); if (STATUS_EXCL.has(st)) continue
        const v = Number(r.valor_documento) || 0; if (v <= 0) continue
        const codCF = String(r.codigo_cliente_fornecedor || '')
        rows.push({ data: r.data_emissao || r.data_vencimento || '', descricao: r.observacao || r.descricao_categoria || '', valor: v, categoria: r.descricao_categoria || '', fornecedor: nomes[codCF] || 'Cliente ' + codCF, tipo: 'receita', documento: r.numero_documento || '' })
      }
    }
    if (imp.import_type === 'contas_pagar') {
      const regs = imp.import_data?.conta_pagar_cadastro || []
      if (Array.isArray(regs)) for (const r of regs) {
        const st = (r.status_titulo || '').toUpperCase().trim(); if (STATUS_EXCL.has(st)) continue
        const v = Number(r.valor_documento) || 0; if (v <= 0) continue
        const codCF = String(r.codigo_cliente_fornecedor || r.codigo_fornecedor || '')
        rows.push({ data: r.data_emissao || r.data_vencimento || '', descricao: r.observacao || r.descricao_categoria || '', valor: -v, categoria: r.descricao_categoria || '', fornecedor: nomes[codCF] || r.observacao || 'Fornecedor ' + codCF, tipo: 'despesa', documento: r.numero_documento || '' })
      }
    }
    if (imp.import_type === 'import_csv') {
      const regs = imp.import_data?.registros || []
      if (Array.isArray(regs)) for (const r of regs) rows.push({ data: r.data || '', descricao: r.descricao || '', valor: Number(r.valor) || 0, categoria: r.categoria || 'Importado', fornecedor: r.fornecedor || '', tipo: (Number(r.valor) || 0) >= 0 ? 'receita' : 'despesa', documento: '' })
    }
  }
  return rows.sort((a, b) => (b.data || '').localeCompare(a.data || ''))
}

export default function DadosPage() {
  const [empresas, setEmpresas] = useState<any[]>([])
  const [grupos, setGrupos] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [lancs, setLancs] = useState<Lanc[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [tab, setTab] = useState<'hub' | 'tabela'>('hub')

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data: up } = await supabase.from('users').select('role').eq('id', user.id).single()
      let comps: any[] = []
      if (up?.role === 'adm' || up?.role === 'acesso_total') {
        const { data } = await supabase.from('companies').select('id, nome_fantasia, razao_social, group_id').order('nome_fantasia')
        comps = (data || []).map(c => ({ id: c.id, nome: c.nome_fantasia || c.razao_social, group_id: c.group_id }))
        const { data: grps } = await supabase.from('company_groups').select('*').order('nome')
        setGrupos(grps || [])
      } else {
        const { data: uc } = await supabase.from('user_companies').select('companies(id, nome_fantasia, razao_social, group_id)').eq('user_id', user.id)
        comps = (uc || []).map((u: any) => u.companies).filter(Boolean).map((c: any) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social, group_id: c.group_id }))
      }
      setEmpresas(comps)
      if (comps.length > 0) setEmpresaSel(comps[0].id)
      setLoading(false)
    })()
  }, [])

  const loadData = useCallback(async () => {
    if (!empresaSel) return
    setLoading(true)
    const { data: imports } = await supabase.from('omie_imports').select('import_type, import_data').eq('company_id', empresaSel)
    setLancs(extractLancs(imports || []))
    setLoading(false)
    setTab('tabela')
  }, [empresaSel])

  const filtered = lancs.filter(l => {
    if (!busca) return true
    const s = busca.toLowerCase()
    return (l.descricao || '').toLowerCase().includes(s) || (l.categoria || '').toLowerCase().includes(s) || (l.fornecedor || '').toLowerCase().includes(s)
  })

  const fmt = (v: number) => 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  const totalRec = lancs.filter(l => l.tipo === 'receita').reduce((s, l) => s + l.valor, 0)
  const totalDesp = lancs.filter(l => l.tipo === 'despesa').reduce((s, l) => s + Math.abs(l.valor), 0)

  return (
    <div style={{ padding: '16px 16px 40px', minHeight: '100vh', background: C.bg, color: C.tx }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.tx, margin: 0 }}>Entrada de Dados</h1>
          <div style={{ fontSize: 11, color: C.txd }}>Escolha como importar os dados financeiros da empresa</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={empresaSel} onChange={e => { setEmpresaSel(e.target.value); setLancs([]) }} style={{ background: C.card, border: '1px solid ' + C.bd, color: C.tx, padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
            {grupos.map(g => {
              const emps = empresas.filter(c => c.group_id === g.id)
              if (emps.length === 0) return null
              return (<optgroup key={g.id} label={'📁 ' + g.nome}>
                {emps.map(e => <option key={e.id} value={e.id}>└ {e.nome}</option>)}
              </optgroup>)
            })}
            {empresas.filter(c => !c.group_id || !grupos.find(g => g.id === c.group_id)).map(e => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>
          <a href="/dashboard" style={{ color: C.go, fontSize: 11, textDecoration: 'none', padding: '5px 10px', border: '1px solid ' + C.bd, borderRadius: 6 }}>Dashboard</a>
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        <button onClick={() => setTab('hub')} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: tab === 'hub' ? '1px solid ' + C.go : '1px solid ' + C.bd, background: tab === 'hub' ? C.go + '15' : 'transparent', color: tab === 'hub' ? C.gol : C.txm }}>Metodos de Importacao</button>
        <button onClick={() => { setTab('tabela'); if (lancs.length === 0) loadData() }} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: tab === 'tabela' ? '1px solid ' + C.go : '1px solid ' + C.bd, background: tab === 'tabela' ? C.go + '15' : 'transparent', color: tab === 'tabela' ? C.gol : C.txm }}>Ver Dados ({lancs.length})</button>
      </div>

      {tab === 'hub' && (
        <>
          {/* 3 OPTIONS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 20 }}>
            {/* API */}
            <a href="/dashboard/conectores" style={{ background: C.card, borderRadius: 12, padding: 20, border: '1px solid ' + C.bd, borderLeft: '4px solid ' + C.g, textDecoration: 'none', display: 'block' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔗</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.tx, marginBottom: 4 }}>Conectar via API</div>
              <div style={{ fontSize: 12, color: C.g, fontWeight: 600, marginBottom: 8 }}>Recomendado — Automatico</div>
              <div style={{ fontSize: 11, color: C.txm, lineHeight: 1.6 }}>Conecte direto ao ERP do cliente (Omie, ContaAzul, Bling). Dados sincronizam automaticamente. Suporte a 38 conectores.</div>
              <div style={{ marginTop: 10, fontSize: 10, color: C.txd }}>Conectores ativos: Omie, ContaAzul</div>
            </a>

            {/* EXCEL */}
            <a href="/dashboard/importar" style={{ background: C.card, borderRadius: 12, padding: 20, border: '1px solid ' + C.bd, borderLeft: '4px solid ' + C.b, textDecoration: 'none', display: 'block' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.tx, marginBottom: 4 }}>Importar Planilha</div>
              <div style={{ fontSize: 12, color: C.b, fontWeight: 600, marginBottom: 8 }}>CSV, Excel, OFX</div>
              <div style={{ fontSize: 11, color: C.txm, lineHeight: 1.6 }}>Importe arquivo CSV, Excel ou extrato bancario OFX. Mapeamento automatico de colunas. Ideal para clientes sem API disponivel.</div>
              <div style={{ marginTop: 10, fontSize: 10, color: C.txd }}>Formatos: .csv, .xlsx, .xls, .ofx</div>
            </a>

            {/* MANUAL */}
            <a href="/dashboard/importar-universal" style={{ background: C.card, borderRadius: 12, padding: 20, border: '1px solid ' + C.bd, borderLeft: '4px solid ' + C.y, textDecoration: 'none', display: 'block' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>✏️</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.tx, marginBottom: 4 }}>Entrada Manual / Universal</div>
              <div style={{ fontSize: 12, color: C.y, fontWeight: 600, marginBottom: 8 }}>Clientes, Fornecedores, Titulos</div>
              <div style={{ fontSize: 11, color: C.txm, lineHeight: 1.6 }}>Importe dados estruturados: cadastro de clientes, fornecedores, contas a receber, contas a pagar, produtos. Upload por tipo de dado.</div>
              <div style={{ marginTop: 10, fontSize: 10, color: C.txd }}>5 tipos: Clientes, Fornecedores, Receber, Pagar, Produtos</div>
            </a>
          </div>

          {/* Quick stats */}
          {lancs.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[
                { l: 'Total lancamentos', v: String(lancs.length), c: C.b },
                { l: 'Receitas', v: fmt(totalRec), c: C.g },
                { l: 'Despesas', v: fmt(totalDesp), c: C.r },
                { l: 'Resultado', v: fmt(totalRec - totalDesp), c: totalRec - totalDesp >= 0 ? C.g : C.r },
              ].map((k, i) => (
                <div key={i} style={{ background: C.card, borderRadius: 8, padding: '8px 12px', borderLeft: '3px solid ' + k.c }}>
                  <div style={{ fontSize: 8, color: C.txd, textTransform: 'uppercase' }}>{k.l}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: k.c }}>{k.v}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'tabela' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por descricao, categoria ou fornecedor..." style={{ flex: 1, background: C.card, border: '1px solid ' + C.bd, color: C.tx, padding: '8px 12px', borderRadius: 6, fontSize: 12, outline: 'none' }} />
            <button onClick={loadData} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: C.go, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>{loading ? '...' : 'Atualizar'}</button>
          </div>

          {lancs.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }}>
              {[
                { l: 'Lancamentos', v: String(filtered.length), c: C.b },
                { l: 'Receitas', v: fmt(totalRec), c: C.g },
                { l: 'Despesas', v: fmt(totalDesp), c: C.r },
                { l: 'Resultado', v: fmt(totalRec - totalDesp), c: totalRec - totalDesp >= 0 ? C.g : C.r },
              ].map((k, i) => (
                <div key={i} style={{ background: C.card, borderRadius: 7, padding: '6px 10px', borderLeft: '3px solid ' + k.c }}>
                  <div style={{ fontSize: 7, color: C.txd, textTransform: 'uppercase' }}>{k.l}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: k.c }}>{k.v}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ background: C.card, borderRadius: 8, overflow: 'hidden', border: '1px solid ' + C.bd }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid ' + C.bd }}>
                  {['Data', 'Fornecedor / Cliente', 'Descricao', 'Categoria', 'Valor'].map(h => (
                    <th key={h} style={{ padding: '8px 6px', textAlign: h === 'Valor' ? 'right' : 'left', color: C.go, fontSize: 9, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((l, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid ' + C.bd + '40' }}>
                    <td style={{ padding: '6px', fontSize: 10, color: C.txm, whiteSpace: 'nowrap' }}>{l.data}</td>
                    <td style={{ padding: '6px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.fornecedor}</td>
                    <td style={{ padding: '6px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', color: C.txm }}>{l.descricao}</td>
                    <td style={{ padding: '6px', fontSize: 10, color: C.y }}>{l.categoria || 'Sem categoria'}</td>
                    <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600, color: l.valor >= 0 ? C.g : C.r }}>{fmt(l.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 100 && <div style={{ padding: 8, textAlign: 'center', fontSize: 10, color: C.txd }}>Mostrando 100 de {filtered.length}</div>}
            {filtered.length === 0 && !loading && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: C.txm }}>Nenhum dado encontrado. Importe via API, Excel ou manualmente.</div>}
            {loading && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: C.txm }}>Carregando...</div>}
          </div>
        </>
      )}

      <div style={{ fontSize: 8, color: C.txd, textAlign: 'center', marginTop: 16 }}>PS Gestao e Capital — Entrada de Dados v8.7.4</div>
    </div>
  )
}

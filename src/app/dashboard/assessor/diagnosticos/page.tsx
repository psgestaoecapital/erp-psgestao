'use client'

import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0C0C0A', bg2: '#141210', bg3: '#1C1A16', esp: '#3D2314', go: '#C8941A', gol: '#E8C872', ow: '#FAF7F2',
  g: '#22C55E', r: '#EF4444', y: '#FBBF24', b: '#60A5FA', tl: '#2DD4BF', p: '#A855F7',
  bd: '#2A2822', tx: '#E8E5DC', txm: '#A8A498', txd: '#706C64' }

const STATUS_EXCL = new Set(['CANCELADO','CANCELADA','ESTORNADO','ESTORNADA','DEVOLVIDO','DEVOLVIDA','ANULADO','ANULADA'])

function toYM(d: string): string {
  if (!d) return ''
  if (d.includes('/')) { const p = d.split('/'); if (p.length === 3 && p[2].length === 4) return p[2] + '-' + p[1].padStart(2, '0') }
  if (d.includes('-') && d.length >= 7) return d.substring(0, 7)
  return d
}

interface Row { data: string; valor: number; desc: string; cat: string; forn: string; cli: string; tipo: string; status: string }

function extract(imports: any[]): Row[] {
  const rows: Row[] = []
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
      if (!Array.isArray(regs)) continue
      for (const r of regs) {
        const st = (r.status_titulo || '').toUpperCase().trim()
        if (STATUS_EXCL.has(st)) continue
        const v = Number(r.valor_documento) || 0; if (v <= 0) continue
        const codCF = String(r.codigo_cliente_fornecedor || '')
        rows.push({ data: r.data_emissao || r.data_vencimento || '', valor: v, desc: r.observacao || r.descricao_categoria || '', cat: r.descricao_categoria || r.codigo_categoria || '', forn: '', cli: nomes[codCF] || 'Cliente ' + codCF, tipo: 'receita', status: st })
      }
    }
    if (imp.import_type === 'contas_pagar') {
      const regs = imp.import_data?.conta_pagar_cadastro || []
      if (!Array.isArray(regs)) continue
      for (const r of regs) {
        const st = (r.status_titulo || '').toUpperCase().trim()
        if (STATUS_EXCL.has(st)) continue
        const v = Number(r.valor_documento) || 0; if (v <= 0) continue
        const codCF = String(r.codigo_cliente_fornecedor || r.codigo_fornecedor || '')
        rows.push({ data: r.data_emissao || r.data_vencimento || '', valor: -v, desc: r.observacao || r.descricao_categoria || '', cat: r.descricao_categoria || r.codigo_categoria || '', forn: nomes[codCF] || r.observacao || 'Fornecedor ' + codCF, cli: '', tipo: 'despesa', status: st })
      }
    }
    if (imp.import_type === 'import_csv') {
      const regs = imp.import_data?.registros || []
      if (Array.isArray(regs)) for (const r of regs) {
        const v = Number(r.valor) || 0
        rows.push({ data: r.data || '', valor: v, desc: r.descricao || '', cat: r.categoria || '', forn: r.fornecedor || '', cli: '', tipo: v >= 0 ? 'receita' : 'despesa', status: 'LIQUIDADO' })
      }
    }
  }
  return rows
}

function calcDiag(rows: Row[]) {
  let totalRec = 0, totalDesp = 0, totalVencido = 0, countRec = 0
  const cliMap: Record<string, number> = {}, fornMap: Record<string, number> = {}
  const catMap: Record<string, { rec: number; desp: number }> = {}
  const mesMap: Record<string, { rec: number; desp: number }> = {}

  for (const r of rows) {
    const ym = toYM(r.data)
    if (r.valor > 0) {
      totalRec += r.valor; countRec++
      cliMap[r.cli || 'N/I'] = (cliMap[r.cli || 'N/I'] || 0) + r.valor
      if (r.status === 'VENCIDO' || r.status === 'ATRASADO') totalVencido += r.valor
    } else {
      totalDesp += Math.abs(r.valor)
      fornMap[r.forn || 'N/I'] = (fornMap[r.forn || 'N/I'] || 0) + Math.abs(r.valor)
    }
    const cat = r.cat || 'Sem Categoria'
    if (!catMap[cat]) catMap[cat] = { rec: 0, desp: 0 }
    if (r.valor >= 0) catMap[cat].rec += r.valor; else catMap[cat].desp += Math.abs(r.valor)
    if (ym && ym.length >= 6) {
      if (!mesMap[ym]) mesMap[ym] = { rec: 0, desp: 0 }
      if (r.valor >= 0) mesMap[ym].rec += r.valor; else mesMap[ym].desp += Math.abs(r.valor)
    }
  }

  const resultado = totalRec - totalDesp
  const margem = totalRec > 0 ? (resultado / totalRec) * 100 : 0
  const inadimplencia = totalRec > 0 ? (totalVencido / totalRec) * 100 : 0
  const ticketMedio = countRec > 0 ? totalRec / countRec : 0

  const topCli = Object.entries(cliMap).map(([nome, valor]) => ({ nome, valor, pct: totalRec > 0 ? (valor / totalRec) * 100 : 0 })).sort((a, b) => b.valor - a.valor).slice(0, 15)
  const topForn = Object.entries(fornMap).map(([nome, valor]) => ({ nome, valor, pct: totalDesp > 0 ? (valor / totalDesp) * 100 : 0 })).sort((a, b) => b.valor - a.valor).slice(0, 15)
  const topCat = Object.entries(catMap).map(([nome, v]) => ({ nome, receita: v.rec, despesa: v.desp })).sort((a, b) => b.desp - a.desp).slice(0, 15)
  const dfcl = Object.entries(mesMap).map(([mes, v]) => ({ mes, rec: v.rec, desp: v.desp, saldo: v.rec - v.desp })).sort((a, b) => a.mes.localeCompare(b.mes))

  const c3 = topCli.slice(0, 3).reduce((s, c) => s + c.pct, 0)
  const c5 = topCli.slice(0, 5).reduce((s, c) => s + c.pct, 0)

  // 5 PILARES
  const alertas: { tipo: string; msg: string; impacto: string; sev: string }[] = []
  const pil: { nome: string; score: number; detalhe: string }[] = []

  // Rentabilidade
  let s1 = margem > 15 ? 90 : margem > 8 ? 70 : margem > 0 ? 40 : 10
  if (margem < 0) alertas.push({ tipo: 'Rentabilidade', msg: 'Resultado negativo: ' + margem.toFixed(1) + '%', impacto: 'Queima de caixa ativa', sev: 'critico' })
  else if (margem < 8) alertas.push({ tipo: 'Rentabilidade', msg: 'Margem abaixo de 8%', impacto: 'Vulnerabilidade em periodos de baixa', sev: 'atencao' })
  pil.push({ nome: 'Rentabilidade', score: s1, detalhe: 'Margem: ' + margem.toFixed(1) + '%' })

  // Liquidez
  const mPos = dfcl.filter(d => d.saldo > 0).length
  const mTot = dfcl.length || 1
  let s2 = (mPos / mTot) > 0.8 ? 85 : (mPos / mTot) > 0.5 ? 55 : 20
  if (inadimplencia > 5) { s2 -= 15; alertas.push({ tipo: 'Liquidez', msg: 'Inadimplencia em ' + inadimplencia.toFixed(1) + '%', impacto: 'Revisar politica de credito', sev: 'atencao' }) }
  if ((mPos / mTot) < 0.5) alertas.push({ tipo: 'Liquidez', msg: 'Maioria dos meses com caixa negativo', impacto: 'Dependencia de capital externo', sev: 'critico' })
  pil.push({ nome: 'Liquidez', score: Math.max(0, s2), detalhe: mPos + '/' + mTot + ' meses positivos' })

  // Eficiencia
  const topFornPct = topForn.length > 0 ? topForn[0].pct : 0
  let s3 = topFornPct > 40 ? 30 : topFornPct > 20 ? 60 : 80
  if (topFornPct > 40) alertas.push({ tipo: 'Eficiencia', msg: 'Fornecedor principal = ' + topFornPct.toFixed(0) + '% dos custos', impacto: 'Risco de supply chain', sev: 'atencao' })
  pil.push({ nome: 'Eficiencia', score: s3, detalhe: topCat.length + ' categorias de custo' })

  // Crescimento
  let s4 = 50
  if (dfcl.length >= 3) {
    const h1 = dfcl.slice(0, Math.ceil(dfcl.length / 2))
    const h2 = dfcl.slice(Math.ceil(dfcl.length / 2))
    const a1 = h1.reduce((s, d) => s + d.rec, 0) / h1.length
    const a2 = h2.reduce((s, d) => s + d.rec, 0) / h2.length
    const gr = a1 > 0 ? ((a2 - a1) / a1) * 100 : 0
    s4 = gr > 10 ? 85 : gr > 0 ? 60 : 25
    if (gr < 0) alertas.push({ tipo: 'Crescimento', msg: 'Receita em queda: ' + gr.toFixed(1) + '%', impacto: 'Break-even em risco', sev: 'atencao' })
    pil.push({ nome: 'Crescimento', score: s4, detalhe: (gr >= 0 ? '+' : '') + gr.toFixed(1) + '%' })
  } else pil.push({ nome: 'Crescimento', score: 50, detalhe: 'Dados limitados' })

  // Risco
  let s5 = 80
  if (c3 > 60) { s5 -= 30; alertas.push({ tipo: 'Risco', msg: 'Top 3 = ' + c3.toFixed(0) + '% da receita', impacto: 'Perda de 1 cliente pode inviabilizar', sev: 'critico' }) }
  else if (c3 > 40) s5 -= 15
  if (resultado < 0) s5 -= 20
  pil.push({ nome: 'Risco', score: Math.max(0, s5), detalhe: 'Concentracao Top 3: ' + c3.toFixed(0) + '%' })

  const healthScore = Math.round(pil.reduce((s, p) => s + p.score, 0) / pil.length)

  return { totalRec, totalDesp, resultado, margem, totalVencido, inadimplencia, clientes: Object.keys(cliMap).length, ticketMedio, topCli, topForn, topCat, dfcl, healthScore, pil, alertas, c3, c5, meses: dfcl.length, lancamentos: rows.length }
}

export default function DiagnosticosPage() {
  const [modo, setModo] = useState<'csv' | 'erp' | null>(null)
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [multi, setMulti] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [diag, setDiag] = useState<ReturnType<typeof calcDiag> | null>(null)
  const [parecer, setParecer] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingIA, setLoadingIA] = useState(false)
  const [loadEmps, setLoadEmps] = useState(false)
  const [err, setErr] = useState('')
  const [csv, setCsv] = useState<File | null>(null)
  const [csvL, setCsvL] = useState(false)
  const [abTab, setAbTab] = useState<'cli' | 'forn' | 'cat'>('cli')
  const [nomeAn, setNomeAn] = useState('')
  const fRef = useRef<HTMLInputElement>(null)

  const loadEmpresas = async () => {
    setLoadEmps(true); setErr('')
    try { const r = await fetch('/api/assessor/empresas-erp'); const d = await r.json(); setEmpresas(d.empresas || []) }
    catch { setErr('Erro ao carregar') }
    setLoadEmps(false)
  }

  const indiv = empresas.filter(e => e.fonte !== 'grupo')
  const grps = empresas.filter(e => e.fonte === 'grupo')
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n) }

  const analisar = async () => {
    setLoading(true); setDiag(null); setParecer(''); setErr('')
    let ids: string[] = []
    if (multi) ids = [...sel]
    else if (empresaSel) { const e = empresas.find(e => e.id === empresaSel); ids = e?.empresa_ids || [empresaSel] }
    if (ids.length === 0) { setErr('Selecione empresa'); setLoading(false); return }
    try {
      const allRows: Row[] = []
      for (const cid of ids) {
        let { data: imp } = await supabase.from('omie_imports').select('import_type, import_data').eq('company_id', cid)
        if (!imp || imp.length === 0) {
          const { data: cl } = await supabase.from('clientes_assessoria').select('cnpj').eq('id', cid).single()
          if (cl?.cnpj) { const { data: co } = await supabase.from('companies').select('id').eq('cnpj', cl.cnpj).single(); if (co?.id) { const r2 = await supabase.from('omie_imports').select('import_type, import_data').eq('company_id', co.id); imp = r2.data } }
        }
        allRows.push(...extract(imp || []))
      }
      if (allRows.length === 0) { setErr('Nenhum lancamento. Importe dados via Omie ou CSV.'); setLoading(false); return }
      const nomes = multi ? [...sel].map(id => empresas.find(e => e.id === id)?.nome || '').filter(Boolean) : [empresas.find(e => e.id === empresaSel)?.nome || '']
      setNomeAn(nomes.join(', ') + (ids.length > 1 ? ' (Consolidado)' : ''))
      setDiag(calcDiag(allRows))
    } catch (e: any) { setErr(e.message) }
    setLoading(false)
  }

  const gerarParecer = async () => {
    if (!diag) return; setLoadingIA(true)
    try {
      const r = await fetch('/api/assessor/consultor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ diagnostico: diag, cliente_nome: nomeAn }) })
      const d = await r.json(); setParecer(d.parecer || 'Erro')
    } catch { setParecer('Erro de conexao') }
    setLoadingIA(false)
  }

  const fmt = (v: number) => 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const sCol = (s: number) => s >= 70 ? C.g : s >= 40 ? C.y : C.r
  const sevC = (s: string) => s === 'critico' ? C.r : C.y
  const pBar = (pct: number, cor: string) => (<div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}><div style={{ flex: 1, height: 5, background: C.bd, borderRadius: 3, overflow: 'hidden' }}><div style={{ width: Math.min(pct, 100) + '%', height: '100%', background: cor, borderRadius: 3 }} /></div><span style={{ fontSize: 9, color: cor, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>{pct.toFixed(1)}%</span></div>)

  return (
    <div style={{ padding: '16px 16px 40px', minHeight: '100vh', background: C.bg, color: C.tx }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 9, color: C.go, letterSpacing: 2, textTransform: 'uppercase' }}>PS Assessor</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.ow, margin: '2px 0 0' }}>Diagnostico Inteligente</h1>
          <div style={{ fontSize: 11, color: C.txd, marginTop: 2 }}>Scorecard 5 Pilares | ABC Pareto | DFCL | Parecer IA</div>
        </div>
        <a href="/dashboard/assessor" style={{ color: C.go, fontSize: 11, textDecoration: 'none', padding: '5px 10px', border: '1px solid ' + C.bd, borderRadius: 6 }}>Dashboard</a>
      </div>

      {!modo && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 560 }}>
          {[{ id: 'erp' as const, label: 'Conector ERP', desc: 'Individual ou consolidado manual', cor: C.tl },
            { id: 'csv' as const, label: 'Upload CSV', desc: 'Arquivo com dados financeiros', cor: C.b }].map(m => (
            <div key={m.id} onClick={() => { setModo(m.id); if (m.id === 'erp') loadEmpresas() }}
              style={{ background: C.bg2, borderRadius: 10, padding: 20, cursor: 'pointer', borderLeft: '3px solid ' + m.cor }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: m.cor }}>{m.label}</div>
              <div style={{ fontSize: 11, color: C.txm, marginTop: 4 }}>{m.desc}</div>
            </div>
          ))}
        </div>
      )}

      {modo && !diag && (
        <div>
          <button onClick={() => { setModo(null); setMulti(false); setSel(new Set()); setCsv(null) }} style={{ background: 'transparent', border: '1px solid ' + C.bd, color: C.txm, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, marginBottom: 12 }}>Voltar</button>
          {modo === 'erp' ? (
            <div style={{ background: C.bg2, borderRadius: 10, padding: 14, borderLeft: '3px solid ' + C.tl }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 700, color: C.tl, fontSize: 13 }}>Selecione empresas</span>
                <button onClick={() => { setMulti(!multi); setSel(new Set()); setEmpresaSel('') }} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontWeight: 600, background: multi ? C.tl + '20' : 'transparent', border: '1px solid ' + (multi ? C.tl : C.bd), color: multi ? C.tl : C.txm }}>{multi ? 'Multi-Select ON' : 'Consolidado Manual'}</button>
              </div>
              {loadEmps ? <div style={{ color: C.txm, fontSize: 12 }}>Carregando...</div> : multi ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: C.txm }}>{sel.size} selecionadas</span>
                    <button onClick={() => { sel.size === indiv.length ? setSel(new Set()) : setSel(new Set(indiv.map(e => e.id))) }} style={{ fontSize: 9, color: C.tl, background: 'transparent', border: 'none', cursor: 'pointer' }}>{sel.size === indiv.length ? 'Desmarcar' : 'Todas'}</button>
                  </div>
                  <div style={{ maxHeight: 160, overflowY: 'auto', background: C.bg, borderRadius: 6, padding: 4 }}>
                    {indiv.map(e => (
                      <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', borderRadius: 4, background: sel.has(e.id) ? C.tl + '10' : 'transparent' }}>
                        <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} style={{ accentColor: C.tl, cursor: 'pointer' }} />
                        <span style={{ fontSize: 12, color: sel.has(e.id) ? C.tx : C.txm }}>{e.nome}</span>
                        {e.cnpj && <span style={{ fontSize: 9, color: C.txd, marginLeft: 'auto' }}>{e.cnpj}</span>}
                      </label>
                    ))}
                  </div>
                  <button onClick={analisar} disabled={loading || sel.size === 0} style={{ marginTop: 8, width: '100%', padding: '10px', borderRadius: 6, border: 'none', background: sel.size > 0 ? C.tl : C.bd, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    {loading ? 'Analisando...' : sel.size > 1 ? 'Diagnostico Consolidado (' + sel.size + ')' : sel.size === 1 ? 'Diagnostico Individual' : 'Selecione'}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={{ flex: 1, background: C.bg, border: '1px solid ' + C.bd, color: C.tx, padding: '10px', borderRadius: 6, fontSize: 12 }}>
                    <option value="">Selecione</option>
                    {grps.length > 0 && <optgroup label="GRUPOS">{grps.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</optgroup>}
                    <optgroup label="Individuais">{indiv.map(e => <option key={e.id} value={e.id}>{e.nome}{e.cnpj ? ' - ' + e.cnpj : ''}</option>)}</optgroup>
                  </select>
                  <button onClick={analisar} disabled={loading || !empresaSel} style={{ padding: '10px 20px', borderRadius: 6, border: 'none', background: C.tl, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{loading ? '...' : 'Analisar'}</button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ background: C.bg2, borderRadius: 10, padding: 16, borderLeft: '3px solid ' + C.b }}>
              <div style={{ fontWeight: 700, color: C.b, marginBottom: 8 }}>Upload CSV</div>
              <div style={{ fontSize: 11, color: C.txm, marginBottom: 10 }}>Colunas: data, descricao, valor, categoria, cliente/fornecedor</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input ref={fRef} type="file" accept=".csv,.txt" onChange={e => setCsv(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                <button onClick={() => fRef.current?.click()} style={{ background: C.b, color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>Selecionar</button>
                {csv && <span style={{ fontSize: 12 }}>{csv.name}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {err && <div style={{ background: C.r + '12', border: '1px solid ' + C.r + '30', borderRadius: 8, padding: 10, marginTop: 12, color: C.r, fontSize: 12 }}>{err}</div>}

      {/* ═══════════ RESULTADO ═══════════ */}
      {diag && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <button onClick={() => { setDiag(null); setParecer('') }} style={{ background: 'transparent', border: 'none', color: C.go, fontSize: 11, cursor: 'pointer', padding: 0, marginBottom: 2 }}>Nova analise</button>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.ow }}>{nomeAn}</div>
              <div style={{ fontSize: 10, color: C.txd }}>{diag.lancamentos} lancamentos | {diag.meses} meses</div>
            </div>
            <button onClick={gerarParecer} disabled={loadingIA} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: loadingIA ? C.bd : `linear-gradient(135deg, ${C.go}, ${C.gol})`, color: C.esp, fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
              {loadingIA ? 'Gerando...' : 'Parecer IA'}
            </button>
          </div>

          {/* HEALTH SCORE + 5 PILARES */}
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 10, marginBottom: 14 }}>
            <div style={{ background: C.bg2, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid ' + C.bd }}>
              <div style={{ fontSize: 8, color: C.txd, textTransform: 'uppercase', letterSpacing: 1 }}>Health Score</div>
              <div style={{ fontSize: 38, fontWeight: 800, color: sCol(diag.healthScore), lineHeight: 1 }}>{diag.healthScore}</div>
              <div style={{ fontSize: 8, color: sCol(diag.healthScore), fontWeight: 600, marginTop: 2 }}>{diag.healthScore >= 70 ? 'SAUDAVEL' : diag.healthScore >= 40 ? 'ATENCAO' : 'CRITICO'}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5 }}>
              {diag.pil.map((p, i) => (
                <div key={i} style={{ background: C.bg2, borderRadius: 8, padding: '10px 8px', border: '1px solid ' + C.bd, textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: C.txd, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>{p.nome}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: sCol(p.score), lineHeight: 1, marginBottom: 4 }}>{p.score}</div>
                  <div style={{ height: 3, background: C.bd, borderRadius: 2, overflow: 'hidden' }}><div style={{ width: p.score + '%', height: '100%', background: sCol(p.score), borderRadius: 2 }} /></div>
                  <div style={{ fontSize: 7, color: C.txd, marginTop: 4, lineHeight: 1.2 }}>{p.detalhe}</div>
                </div>
              ))}
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 5, marginBottom: 14 }}>
            {[
              { l: 'Receita', v: fmt(diag.totalRec), c: C.g },
              { l: 'Despesa', v: fmt(diag.totalDesp), c: C.r },
              { l: 'Resultado', v: (diag.resultado >= 0 ? '+' : '') + fmt(diag.resultado), c: diag.resultado >= 0 ? C.g : C.r },
              { l: 'Margem', v: diag.margem.toFixed(1) + '%', c: diag.margem >= 10 ? C.g : diag.margem >= 0 ? C.y : C.r },
              { l: 'Inadimplencia', v: diag.inadimplencia.toFixed(1) + '%', c: diag.inadimplencia > 3 ? C.r : C.g },
              { l: 'Clientes', v: String(diag.clientes), c: C.b },
              { l: 'Ticket Medio', v: fmt(diag.ticketMedio), c: C.tl },
              { l: 'Conc. Top 3', v: diag.c3.toFixed(0) + '%', c: diag.c3 > 60 ? C.r : diag.c3 > 40 ? C.y : C.g },
            ].map((k, i) => (
              <div key={i} style={{ background: C.bg2, borderRadius: 7, padding: '8px 10px', borderLeft: '3px solid ' + k.c }}>
                <div style={{ fontSize: 7, color: C.txd, textTransform: 'uppercase', letterSpacing: 0.3 }}>{k.l}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: k.c, marginTop: 1 }}>{k.v}</div>
              </div>
            ))}
          </div>

          {/* ALERTAS */}
          {diag.alertas.length > 0 && (
            <div style={{ background: C.bg2, borderRadius: 8, padding: 12, marginBottom: 14, border: '1px solid ' + C.bd }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.r, marginBottom: 6 }}>Alertas ({diag.alertas.length})</div>
              {diag.alertas.map((a, i) => (
                <div key={i} style={{ padding: '6px 8px', marginBottom: 3, borderRadius: 5, background: C.bg, borderLeft: '3px solid ' + sevC(a.sev) }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: sevC(a.sev) }}>{a.msg}</span>
                    <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 3, background: sevC(a.sev) + '20', color: sevC(a.sev), fontWeight: 700 }}>{a.sev.toUpperCase()}</span>
                  </div>
                  <div style={{ fontSize: 9, color: C.txm, marginTop: 1 }}>{a.impacto}</div>
                </div>
              ))}
            </div>
          )}

          {/* ABC */}
          <div style={{ background: C.bg2, borderRadius: 8, padding: 12, marginBottom: 14, border: '1px solid ' + C.bd }}>
            <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
              {([['cli', 'Clientes'], ['forn', 'Fornecedores'], ['cat', 'Categorias']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setAbTab(k)} style={{ padding: '4px 12px', borderRadius: 5, fontSize: 10, cursor: 'pointer', fontWeight: 600, border: abTab === k ? '1px solid ' + C.go : '1px solid ' + C.bd, background: abTab === k ? C.go + '10' : 'transparent', color: abTab === k ? C.gol : C.txm }}>ABC {l}</button>
              ))}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead><tr style={{ borderBottom: '1px solid ' + C.bd }}>
                <th style={{ padding: '4px 6px', textAlign: 'left', color: C.go, fontSize: 9, width: 20 }}>#</th>
                <th style={{ padding: '4px 6px', textAlign: 'left', color: C.go, fontSize: 9 }}>Nome</th>
                {abTab === 'cat' ? (<><th style={{ padding: '4px 6px', textAlign: 'right', color: C.go, fontSize: 9 }}>Receita</th><th style={{ padding: '4px 6px', textAlign: 'right', color: C.go, fontSize: 9 }}>Despesa</th></>) : (<><th style={{ padding: '4px 6px', textAlign: 'right', color: C.go, fontSize: 9 }}>Valor</th><th style={{ padding: '4px 6px', color: C.go, fontSize: 9 }}>%</th></>)}
              </tr></thead>
              <tbody>
                {(abTab === 'cli' ? diag.topCli : abTab === 'forn' ? diag.topForn : []).slice(0, 10).map((it, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid ' + C.bd + '40' }}>
                    <td style={{ padding: '4px 6px', color: C.txd, fontSize: 9 }}>{i + 1}</td>
                    <td style={{ padding: '4px 6px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.nome}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600, color: abTab === 'forn' ? C.r : C.g }}>{fmt(it.valor)}</td>
                    <td style={{ padding: '4px 6px', width: 140 }}>{pBar(it.pct, abTab === 'forn' ? C.r : C.g)}</td>
                  </tr>
                ))}
                {abTab === 'cat' && diag.topCat.slice(0, 10).map((it, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid ' + C.bd + '40' }}>
                    <td style={{ padding: '4px 6px', color: C.txd, fontSize: 9 }}>{i + 1}</td>
                    <td style={{ padding: '4px 6px' }}>{it.nome}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: C.g }}>{fmt(it.receita)}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: C.r }}>{fmt(it.despesa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* DFCL */}
          {diag.dfcl.length > 0 && (
            <div style={{ background: C.bg2, borderRadius: 8, padding: 12, marginBottom: 14, border: '1px solid ' + C.bd }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.b, marginBottom: 8 }}>Fluxo de Caixa Mensal</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 120 }}>
                {diag.dfcl.slice(-8).map((d, i) => {
                  const mx = Math.max(...diag.dfcl.slice(-8).flatMap(x => [x.rec, x.desp]), 1)
                  return (<div key={i} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'center', alignItems: 'flex-end', height: 100 }}>
                      <div style={{ width: 12, height: Math.max((d.rec / mx) * 90, 2), background: C.g, borderRadius: '2px 2px 0 0' }} />
                      <div style={{ width: 12, height: Math.max((d.desp / mx) * 90, 2), background: C.r, borderRadius: '2px 2px 0 0' }} />
                    </div>
                    <div style={{ fontSize: 8, color: C.txd, marginTop: 2 }}>{d.mes.substring(5)}/{d.mes.substring(2, 4)}</div>
                    <div style={{ fontSize: 7, fontWeight: 700, color: d.saldo >= 0 ? C.g : C.r }}>{(d.saldo / 1000).toFixed(0)}K</div>
                  </div>)
                })}
              </div>
            </div>
          )}

          {/* PARECER */}
          {parecer && (
            <div style={{ background: C.bg2, borderRadius: 8, padding: 14, borderLeft: '3px solid ' + C.go, border: '1px solid ' + C.bd }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.go, marginBottom: 8 }}>Parecer IA</div>
              <div style={{ fontSize: 12, color: C.tx, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{parecer}</div>
            </div>
          )}

          <div style={{ fontSize: 8, color: C.txd, textAlign: 'center', marginTop: 16 }}>PS Gestao e Capital - Diagnostico Inteligente v8.6.2 | Scorecard 5 Pilares</div>
        </div>
      )}
    </div>
  )
}

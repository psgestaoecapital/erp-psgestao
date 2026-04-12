'use client'

import React, { useState, useEffect, useRef } from 'react'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5', teal: '#009688' }

interface Empresa { id: string; nome: string; cnpj?: string; fonte?: string; empresa_ids?: string[]; membros?: any[] }

export default function DiagnosticosPage() {
  const [modo, setModo] = useState<'csv' | 'erp' | null>(null)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [multiSelect, setMultiSelect] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resultado, setResultado] = useState<any>(null)
  const [parecer, setParecer] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingIA, setLoadingIA] = useState(false)
  const [loadingEmpresas, setLoadingEmpresas] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvParsing, setCsvParsing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadEmpresas = async () => {
    setLoadingEmpresas(true); setErrorMsg('')
    try {
      const resp = await fetch('/api/assessor/empresas-erp')
      const data = await resp.json()
      setEmpresas(data.empresas || [])
      if ((data.empresas || []).length === 0) setErrorMsg('Nenhuma empresa encontrada.')
    } catch { setErrorMsg('Erro ao carregar empresas') }
    setLoadingEmpresas(false)
  }

  const individuais = empresas.filter(e => e.fonte !== 'grupo')
  const grupos = empresas.filter(e => e.fonte === 'grupo')

  const toggleSelect = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }

  const selectAll = () => {
    if (selected.size === individuais.length) setSelected(new Set())
    else setSelected(new Set(individuais.map(e => e.id)))
  }

  const analisarERP = async () => {
    setLoading(true); setResultado(null); setParecer(''); setErrorMsg('')

    let idsToAnalyze: string[] = []

    if (multiSelect) {
      idsToAnalyze = [...selected]
    } else if (empresaSel) {
      const emp = empresas.find(e => e.id === empresaSel)
      if (emp?.fonte === 'grupo' && emp.empresa_ids) {
        idsToAnalyze = emp.empresa_ids
      } else {
        idsToAnalyze = [empresaSel]
      }
    }

    if (idsToAnalyze.length === 0) { setErrorMsg('Selecione pelo menos uma empresa'); setLoading(false); return }

    try {
      if (idsToAnalyze.length === 1) {
        // Individual
        const resp = await fetch('/api/assessor/analisar-erp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empresa_id: idsToAnalyze[0] }) })
        const data = await resp.json()
        if (data.error) setErrorMsg(data.error)
        else setResultado(data)
      } else {
        // Consolidado
        const resultados: any[] = []
        for (const eid of idsToAnalyze) {
          const resp = await fetch('/api/assessor/analisar-erp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empresa_id: eid }) })
          const data = await resp.json()
          if (!data.error) resultados.push(data)
        }
        if (resultados.length === 0) { setErrorMsg('Nenhum lancamento encontrado nas empresas selecionadas'); setLoading(false); return }
        setResultado({
          total_lancamentos: resultados.reduce((s, r) => s + (r.total_lancamentos || 0), 0),
          tipo: 'consolidado', empresas_analisadas: resultados.length,
          abc_clientes: mergeABC(resultados.flatMap(r => r.abc_clientes || [])),
          abc_fornecedores: mergeABC(resultados.flatMap(r => r.abc_fornecedores || [])),
          abc_categorias: mergeABCCat(resultados.flatMap(r => r.abc_categorias || [])),
          dfcl_mensal: mergeDFCL(resultados.flatMap(r => r.dfcl_mensal || [])),
        })
      }
    } catch { setErrorMsg('Erro na analise') }
    setLoading(false)
  }

  const analisarCSV = async () => {
    if (!csvFile) return
    setCsvParsing(true); setResultado(null); setParecer(''); setErrorMsg('')
    try {
      const formData = new FormData()
      formData.append('file', csvFile)
      const resp = await fetch('/api/assessor/import', { method: 'POST', body: formData })
      const data = await resp.json()
      if (data.error) setErrorMsg(data.error)
      else setResultado({ total_lancamentos: data.total || 0, tipo: 'csv', abc_clientes: data.abc_clientes || [], abc_fornecedores: data.abc_fornecedores || [], abc_categorias: [], dfcl_mensal: data.dfcl_mensal || [] })
    } catch { setErrorMsg('Erro ao processar CSV') }
    setCsvParsing(false)
  }

  const mergeABC = (items: any[]) => {
    const map: Record<string, number> = {}
    items.forEach(i => { map[i.nome] = (map[i.nome] || 0) + (i.valor || 0) })
    return Object.entries(map).map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor).slice(0, 20)
  }

  const mergeABCCat = (items: any[]) => {
    const map: Record<string, { receita: number; despesa: number }> = {}
    items.forEach(i => { if (!map[i.nome]) map[i.nome] = { receita: 0, despesa: 0 }; map[i.nome].receita += i.receita || 0; map[i.nome].despesa += i.despesa || 0 })
    return Object.entries(map).map(([nome, v]) => ({ nome, receita: v.receita, despesa: v.despesa, saldo: v.receita - v.despesa })).sort((a, b) => b.despesa - a.despesa)
  }

  const mergeDFCL = (items: any[]) => {
    const map: Record<string, { receita: number; despesa: number }> = {}
    items.forEach(i => { if (!map[i.mes]) map[i.mes] = { receita: 0, despesa: 0 }; map[i.mes].receita += i.receita || 0; map[i.mes].despesa += i.despesa || 0 })
    return Object.entries(map).map(([mes, v]) => ({ mes, receita: v.receita, despesa: v.despesa, saldo: v.receita - v.despesa })).sort((a, b) => a.mes.localeCompare(b.mes))
  }

  const gerarParecer = async () => {
    if (!resultado) return
    setLoadingIA(true)
    try {
      const nomesSel = multiSelect
        ? [...selected].map(id => empresas.find(e => e.id === id)?.nome || '').filter(Boolean).join(', ')
        : empresas.find(e => e.id === empresaSel)?.nome || 'Cliente'
      const resp = await fetch('/api/assessor/consultor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ diagnostico: resultado, cliente_nome: nomesSel }) })
      const data = await resp.json()
      setParecer(data.parecer || 'Erro ao gerar parecer')
    } catch { setParecer('Erro de conexao') }
    setLoadingIA(false)
  }

  const fmt = (v: number) => 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 0 })
  const chk: React.CSSProperties = { width: 16, height: 16, accentColor: C.teal, cursor: 'pointer' }

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold }}>Diagnostico Inteligente</h1>
        <a href="/dashboard/assessor" style={{ color: C.gold, fontSize: 11, textDecoration: 'none' }}>Dashboard Assessor</a>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>PS Assessor | Individual, consolidado manual ou CSV</div>

      {!modo && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div onClick={() => { setModo('erp'); loadEmpresas() }} style={{ background: C.card, borderRadius: 8, padding: 24, cursor: 'pointer', textAlign: 'center', borderLeft: '3px solid ' + C.teal }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>ERP</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.teal }}>Conector ERP</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Individual ou consolidado manual (multi-select)</div>
          </div>
          <div onClick={() => setModo('csv')} style={{ background: C.card, borderRadius: 8, padding: 24, cursor: 'pointer', textAlign: 'center', borderLeft: '3px solid ' + C.blue }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>CSV</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.blue }}>Upload CSV</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Arraste ou selecione arquivo CSV com dados financeiros.</div>
          </div>
        </div>
      )}

      {modo === 'csv' && (
        <div>
          <button onClick={() => { setModo(null); setResultado(null); setParecer(''); setErrorMsg(''); setCsvFile(null) }} style={{ background: 'transparent', border: '1px solid ' + C.border, color: C.muted, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 11, marginBottom: 12 }}>Voltar</button>
          <div style={{ background: C.card, borderRadius: 8, padding: 20, marginBottom: 12, borderLeft: '3px solid ' + C.blue }}>
            <div style={{ fontWeight: 700, color: C.blue, marginBottom: 10 }}>Upload CSV - Diagnostico Rapido</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Colunas: data, descricao, valor, categoria, cliente/fornecedor (separador ; ou ,)</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={e => setCsvFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={{ background: C.blue, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>Selecionar CSV</button>
              {csvFile && <span style={{ fontSize: 12, color: C.text }}>{csvFile.name}</span>}
              {csvFile && <button onClick={analisarCSV} disabled={csvParsing} style={{ background: C.green, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', opacity: csvParsing ? 0.5 : 1 }}>{csvParsing ? 'Analisando...' : 'Analisar'}</button>}
            </div>
          </div>
        </div>
      )}

      {modo === 'erp' && (
        <div>
          <button onClick={() => { setModo(null); setResultado(null); setParecer(''); setErrorMsg(''); setMultiSelect(false); setSelected(new Set()) }} style={{ background: 'transparent', border: '1px solid ' + C.border, color: C.muted, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 11, marginBottom: 12 }}>Voltar</button>

          <div style={{ background: C.card, borderRadius: 8, padding: 16, marginBottom: 12, borderLeft: '3px solid ' + C.teal }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: C.teal }}>Conector ERP</div>
              <button onClick={() => { setMultiSelect(!multiSelect); setSelected(new Set()); setEmpresaSel('') }}
                style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600,
                  background: multiSelect ? C.teal + '20' : 'transparent',
                  border: '1px solid ' + (multiSelect ? C.teal : C.border),
                  color: multiSelect ? C.teal : C.muted }}>
                {multiSelect ? 'Modo: Multi-Select (Consolidado Manual)' : 'Ativar Consolidado Manual'}
              </button>
            </div>

            {loadingEmpresas ? <div style={{ color: C.muted, fontSize: 12 }}>Carregando...</div> : multiSelect ? (
              /* === MULTI-SELECT MODE === */
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: C.muted }}>Selecione as empresas para consolidar ({selected.size} selecionadas)</div>
                  <button onClick={selectAll} style={{ fontSize: 10, color: C.teal, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                    {selected.size === individuais.length ? 'Desmarcar todas' : 'Selecionar todas'}
                  </button>
                </div>

                <div style={{ maxHeight: 200, overflowY: 'auto', background: C.bg, borderRadius: 8, padding: 8 }}>
                  {individuais.map(e => (
                    <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', cursor: 'pointer', borderRadius: 6, background: selected.has(e.id) ? C.teal + '10' : 'transparent', marginBottom: 2 }}>
                      <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} style={chk} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: selected.has(e.id) ? 600 : 400, color: selected.has(e.id) ? C.text : C.muted }}>{e.nome}</div>
                        {e.cnpj && <div style={{ fontSize: 10, color: C.muted }}>{e.cnpj}</div>}
                      </div>
                      {e.fonte === 'companies' && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 4, background: C.green + '20', color: C.green, marginLeft: 'auto' }}>dados Omie</span>}
                    </label>
                  ))}
                </div>

                <button onClick={analisarERP} disabled={loading || selected.size === 0}
                  style={{ marginTop: 10, background: C.teal, color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13, opacity: loading || selected.size === 0 ? 0.5 : 1, width: '100%' }}>
                  {loading ? 'Analisando...' : selected.size > 1 ? 'Analisar Consolidado (' + selected.size + ' empresas)' : selected.size === 1 ? 'Analisar Individual' : 'Selecione empresas'}
                </button>
              </div>
            ) : (
              /* === SELECT MODE === */
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={{ flex: 1, background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '10px 14px', borderRadius: 6, fontSize: 12 }}>
                  <option value="">Selecione empresa ou grupo</option>
                  {grupos.length > 0 && (
                    <optgroup label="GRUPOS (Consolidado)">
                      {grupos.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </optgroup>
                  )}
                  <optgroup label="Empresas Individuais">
                    {individuais.map(e => <option key={e.id} value={e.id}>{e.nome}{e.cnpj ? ' - ' + e.cnpj : ''}</option>)}
                  </optgroup>
                </select>
                <button onClick={analisarERP} disabled={loading || !empresaSel} style={{ background: C.teal, color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13, opacity: loading || !empresaSel ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                  {loading ? 'Analisando...' : 'Analisar'}
                </button>
              </div>
            )}

            {/* Membros do grupo selecionado */}
            {!multiSelect && empresaSel && empresas.find(e => e.id === empresaSel)?.membros && (
              <div style={{ marginTop: 10, padding: 10, background: C.bg, borderRadius: 6, fontSize: 11, color: C.muted }}>
                <b style={{ color: C.teal }}>Empresas do grupo:</b>
                {empresas.find(e => e.id === empresaSel)?.membros?.map((m: any, i: number) => (
                  <div key={i} style={{ marginTop: 4 }}>{m.nome} - {m.cnpj || 'sem CNPJ'}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {errorMsg && <div style={{ background: C.red + '15', border: '1px solid ' + C.red, borderRadius: 8, padding: 12, marginBottom: 12, color: C.red, fontSize: 12 }}>{errorMsg}</div>}

      {resultado && (
        <div>
          <div style={{ background: C.card, borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <span style={{ fontWeight: 700, color: C.gold, fontSize: 14 }}>Resultado: {resultado.total_lancamentos} lancamentos</span>
                {resultado.tipo === 'consolidado' && <span style={{ marginLeft: 10, fontSize: 10, padding: '3px 8px', borderRadius: 10, background: C.teal + '20', color: C.teal, fontWeight: 700 }}>CONSOLIDADO ({resultado.empresas_analisadas} empresas)</span>}
                {resultado.tipo === 'csv' && <span style={{ marginLeft: 10, fontSize: 10, padding: '3px 8px', borderRadius: 10, background: C.blue + '20', color: C.blue, fontWeight: 700 }}>VIA CSV</span>}
              </div>
              <button onClick={gerarParecer} disabled={loadingIA} style={{ background: C.gold, color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 11, opacity: loadingIA ? 0.5 : 1 }}>
                {loadingIA ? 'Gerando...' : 'Gerar Parecer IA'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 6 }}>ABC Clientes (Top 10)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead><tr><th style={{ padding: '4px 6px', textAlign: 'left', color: C.gold }}>Cliente</th><th style={{ padding: '4px 6px', textAlign: 'right', color: C.gold }}>Valor</th></tr></thead>
                  <tbody>{(resultado.abc_clientes || []).slice(0, 10).map((c: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}><td style={{ padding: '3px 6px' }}>{c.nome}</td><td style={{ padding: '3px 6px', textAlign: 'right', color: C.green }}>{fmt(c.valor)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.red, marginBottom: 6 }}>ABC Fornecedores (Top 10)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead><tr><th style={{ padding: '4px 6px', textAlign: 'left', color: C.gold }}>Fornecedor</th><th style={{ padding: '4px 6px', textAlign: 'right', color: C.gold }}>Valor</th></tr></thead>
                  <tbody>{(resultado.abc_fornecedores || []).slice(0, 10).map((f: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}><td style={{ padding: '3px 6px' }}>{f.nome}</td><td style={{ padding: '3px 6px', textAlign: 'right', color: C.red }}>{fmt(f.valor)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>

            {resultado.dfcl_mensal && resultado.dfcl_mensal.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 6 }}>Fluxo de Caixa Mensal</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead><tr>
                    <th style={{ padding: '4px 8px', textAlign: 'left', color: C.gold }}>Mes</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right', color: C.gold }}>Receita</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right', color: C.gold }}>Despesa</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right', color: C.gold }}>Saldo</th>
                  </tr></thead>
                  <tbody>{resultado.dfcl_mensal.map((d: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}>
                      <td style={{ padding: '3px 8px' }}>{d.mes}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right', color: C.green }}>{fmt(d.receita)}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right', color: C.red }}>{fmt(d.despesa)}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right', fontWeight: 600, color: d.saldo >= 0 ? C.green : C.red }}>{fmt(d.saldo)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>

          {parecer && (
            <div style={{ background: C.card, borderRadius: 8, padding: 16, borderLeft: '3px solid ' + C.gold }}>
              <div style={{ fontWeight: 700, color: C.gold, marginBottom: 10 }}>Parecer do Consultor IA</div>
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{parecer}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
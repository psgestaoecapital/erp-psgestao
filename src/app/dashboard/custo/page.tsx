'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5', teal: '#009688', espresso: '#3D2314', orange: '#FF9800' }

// ═══════════════════════════════════════
// TIPOS E ESTRUTURAS
// ═══════════════════════════════════════
interface DRELine { id: string; label: string; nivel: number; tipo: 'valor' | 'subtotal' | 'total' | 'header'; realizado: number; orcado: number; pct?: number; editavel?: boolean }

const GRUPOS_DIRETOS = [
  { id: 'mp', label: 'Materia-Prima / Animal Vivo', campo: 'materia_prima' },
  { id: 'mod', label: 'Mao de Obra Direta', campo: 'mao_obra_direta' },
  { id: 'emb', label: 'Embalagens', campo: 'embalagens' },
]

const GRUPOS_CIF = [
  { id: 'moi', label: 'Mao de Obra Indireta', campo: 'mao_obra_indireta' },
  { id: 'ene', label: 'Energia Eletrica', campo: 'energia' },
  { id: 'gas', label: 'Gas / Vapor', campo: 'gas_vapor' },
  { id: 'agua', label: 'Agua e Efluentes', campo: 'agua_efluentes' },
  { id: 'man', label: 'Manutencao Industrial', campo: 'manutencao' },
  { id: 'dep', label: 'Depreciacao', campo: 'depreciacao' },
  { id: 'log', label: 'Logistica Interna', campo: 'logistica_interna' },
  { id: 'ins', label: 'Insumos e Quimicos', campo: 'insumos_quimicos' },
  { id: 'ter', label: 'Servicos Terceirizados', campo: 'servicos_terceirizados' },
  { id: 'out', label: 'Outros CIF', campo: 'outros_custos' },
]

const LINHAS_PRODUTO = [
  { id: 'cortes_nobres', label: 'Cortes Nobres', pctMP: 25, pctVol: 15 },
  { id: 'cortes_padrao', label: 'Cortes Padrao', pctMP: 30, pctVol: 30 },
  { id: 'industrializados', label: 'Industrializados', pctMP: 20, pctVol: 25 },
  { id: 'subprodutos', label: 'Subprodutos (farinhas/oleos)', pctMP: 10, pctVol: 20 },
  { id: 'exportacao', label: 'Exportacao', pctMP: 15, pctVol: 10 },
]

export default function CustoPage() {
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [periodo, setPeriodo] = useState('')
  const [tab, setTab] = useState<'dre' | 'cpv' | 'produto' | 'manual'>('dre')
  const [loading, setLoading] = useState(true)
  const [fonteUsada, setFonteUsada] = useState('')
  const [dados, setDados] = useState<Record<string, number>>({})
  const [editValues, setEditValues] = useState<Record<string, number>>({})
  const [editMode, setEditMode] = useState(false)

  // Dados simulados para demonstracao
  const [receitaBruta, setReceitaBruta] = useState(8500000)
  const [deducoes, setDeducoes] = useState(1275000)
  const [despAdm, setDespAdm] = useState(420000)
  const [despCom, setDespCom] = useState(380000)
  const [despFin, setDespFin] = useState(210000)
  const [volumeTon, setVolumeTon] = useState(450)

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
    const d: Record<string, number> = {}

    // Tentar buscar do modulo industrial
    try {
      const resp = await fetch('/api/industrial/custos?empresa_id=' + empresaSel + '&periodo=' + periodo)
      const data = await resp.json()
      if (data.custos && data.custos.length > 0) {
        const row = data.custos[0]
        setFonteUsada('industrial');
        [...GRUPOS_DIRETOS, ...GRUPOS_CIF].forEach(g => { d[g.campo] = row[g.campo] || 0 })
        if (row.volume_ton) setVolumeTon(row.volume_ton)
        setDados(d); setLoading(false); return
      }
    } catch (e) { /* fallback */ }

    // Fallback: dados simulados realistas
    setFonteUsada('simulado')
    d.materia_prima = 4200000 + Math.random() * 800000
    d.mao_obra_direta = 850000 + Math.random() * 200000
    d.embalagens = 320000 + Math.random() * 80000
    d.mao_obra_indireta = 280000 + Math.random() * 60000
    d.energia = 245000 + Math.random() * 50000
    d.gas_vapor = 135000 + Math.random() * 30000
    d.agua_efluentes = 98000 + Math.random() * 20000
    d.manutencao = 175000 + Math.random() * 40000
    d.depreciacao = 140000 + Math.random() * 30000
    d.logistica_interna = 110000 + Math.random() * 25000
    d.insumos_quimicos = 85000 + Math.random() * 20000
    d.servicos_terceirizados = 95000 + Math.random() * 20000
    d.outros_custos = 65000 + Math.random() * 15000
    setDados(d)
    setLoading(false)
  }, [empresaSel, periodo])

  useEffect(() => { loadData() }, [loadData])

  // Calculos
  const custoDireto = GRUPOS_DIRETOS.reduce((s, g) => s + (dados[g.campo] || 0), 0)
  const cif = GRUPOS_CIF.reduce((s, g) => s + (dados[g.campo] || 0), 0)
  const cpv = custoDireto + cif
  const recLiquida = receitaBruta - deducoes
  const resultBruto = recLiquida - cpv
  const despTotal = despAdm + despCom + despFin
  const resultOperacional = resultBruto - despTotal
  const margemBruta = recLiquida > 0 ? (resultBruto / recLiquida) * 100 : 0
  const margemOper = recLiquida > 0 ? (resultOperacional / recLiquida) * 100 : 0
  const custoKg = volumeTon > 0 ? cpv / (volumeTon * 1000) : 0

  const fmt = (v: number) => {
    if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(2) + 'M'
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'K'
    return v.toFixed(2)
  }
  const fmtR = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const fmtPct = (v: number) => v.toFixed(1) + '%'
  const semCor = (v: number, inv?: boolean) => {
    const check = inv ? -v : v
    return check > 5 ? C.red : check > 0 ? C.yellow : C.green
  }

  const inputSt: React.CSSProperties = { background: C.card, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 6, fontSize: 13 }
  const tabSt = (t: string): React.CSSProperties => ({
    padding: '10px 18px', cursor: 'pointer', border: 'none', fontWeight: 600, fontSize: 12,
    background: tab === t ? C.gold : 'transparent', color: tab === t ? C.espresso : C.muted,
    borderRadius: '8px 8px 0 0',
  })

  // Funcao para salvar dados manuais
  const saveManual = async () => {
    const grupos: Record<string, number> = {}
    const orcamento: Record<string, number> = {};
    [...GRUPOS_DIRETOS, ...GRUPOS_CIF].forEach(g => {
      grupos[g.campo] = editValues[g.campo] ?? dados[g.campo] ?? 0
      orcamento[g.campo] = 0
    })
    try {
      await fetch('/api/industrial/custos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: empresaSel, periodo, grupos, orcamento, fonte: 'manual', volume_ton: volumeTon }),
      })
      setEditMode(false); loadData(); alert('Custos salvos!')
    } catch (e) { alert('Erro ao salvar') }
  }

  // DRE rows
  const dreLines: DRELine[] = [
    { id: 'h_receita', label: 'RECEITAS', nivel: 0, tipo: 'header', realizado: 0, orcado: 0 },
    { id: 'rec_bruta', label: 'Receita Bruta de Vendas', nivel: 1, tipo: 'valor', realizado: receitaBruta, orcado: receitaBruta * 1.05, editavel: true },
    { id: 'deducoes', label: '(-) Deducoes (impostos, devolucoes)', nivel: 1, tipo: 'valor', realizado: -deducoes, orcado: -deducoes * 0.95 },
    { id: 'rec_liq', label: 'RECEITA LIQUIDA', nivel: 0, tipo: 'subtotal', realizado: recLiquida, orcado: (receitaBruta * 1.05) - (deducoes * 0.95) },
    { id: 'h_cpv', label: 'CUSTO DOS PRODUTOS VENDIDOS (CPV)', nivel: 0, tipo: 'header', realizado: 0, orcado: 0 },
    { id: 'h_cd', label: 'Custos Diretos', nivel: 1, tipo: 'header', realizado: 0, orcado: 0 },
    ...GRUPOS_DIRETOS.map(g => ({ id: g.id, label: '  ' + g.label, nivel: 2, tipo: 'valor' as const, realizado: -(dados[g.campo] || 0), orcado: -(dados[g.campo] || 0) * 0.95 })),
    { id: 'sub_cd', label: 'Subtotal Custos Diretos', nivel: 1, tipo: 'subtotal', realizado: -custoDireto, orcado: -custoDireto * 0.95 },
    { id: 'h_cif', label: 'Custos Indiretos de Fabricacao (CIF)', nivel: 1, tipo: 'header', realizado: 0, orcado: 0 },
    ...GRUPOS_CIF.map(g => ({ id: g.id, label: '  ' + g.label, nivel: 2, tipo: 'valor' as const, realizado: -(dados[g.campo] || 0), orcado: -(dados[g.campo] || 0) * 0.95 })),
    { id: 'sub_cif', label: 'Subtotal CIF', nivel: 1, tipo: 'subtotal', realizado: -cif, orcado: -cif * 0.95 },
    { id: 'cpv_total', label: 'TOTAL CPV', nivel: 0, tipo: 'total', realizado: -cpv, orcado: -cpv * 0.95 },
    { id: 'res_bruto', label: 'RESULTADO BRUTO', nivel: 0, tipo: 'total', realizado: resultBruto, orcado: (receitaBruta * 1.05 - deducoes * 0.95) - cpv * 0.95, pct: margemBruta },
    { id: 'h_desp', label: 'DESPESAS OPERACIONAIS', nivel: 0, tipo: 'header', realizado: 0, orcado: 0 },
    { id: 'desp_adm', label: '  Despesas Administrativas', nivel: 1, tipo: 'valor', realizado: -despAdm, orcado: -despAdm * 0.95 },
    { id: 'desp_com', label: '  Despesas Comerciais', nivel: 1, tipo: 'valor', realizado: -despCom, orcado: -despCom * 0.95 },
    { id: 'desp_fin', label: '  Despesas Financeiras', nivel: 1, tipo: 'valor', realizado: -despFin, orcado: -despFin * 0.95 },
    { id: 'sub_desp', label: 'Total Despesas Operacionais', nivel: 0, tipo: 'subtotal', realizado: -despTotal, orcado: -despTotal * 0.95 },
    { id: 'res_oper', label: 'RESULTADO OPERACIONAL (EBITDA)', nivel: 0, tipo: 'total', realizado: resultOperacional, orcado: ((receitaBruta * 1.05 - deducoes * 0.95) - cpv * 0.95) - despTotal * 0.95, pct: margemOper },
  ]

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.gold, margin: 0 }}>Custos por Absorcao</h1>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Lei 6.404/76 | CPC 16 (IAS 2) | Metodo integral aceito pela Receita Federal</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 9, padding: '4px 10px', borderRadius: 12, fontWeight: 700,
            background: fonteUsada === 'industrial' ? C.teal + '20' : fonteUsada === 'simulado' ? C.yellow + '20' : C.blue + '20',
            color: fonteUsada === 'industrial' ? C.teal : fonteUsada === 'simulado' ? C.yellow : C.blue }}>
            {fonteUsada === 'industrial' ? 'Dados: Modulo Industrial' : fonteUsada === 'simulado' ? 'Dados Simulados' : 'Dados: Lancamentos'}
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={inputSt}>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)} style={inputSt} />
        <button onClick={loadData} style={{ background: C.gold, color: C.espresso, border: 'none', padding: '8px 14px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Atualizar</button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Receita Liquida', value: fmtR(recLiquida), color: C.blue },
          { label: 'CPV Total', value: fmtR(cpv), color: C.red },
          { label: 'Margem Bruta', value: fmtPct(margemBruta), color: margemBruta > 20 ? C.green : margemBruta > 10 ? C.yellow : C.red },
          { label: 'Custo/kg', value: 'R$ ' + custoKg.toFixed(2), color: C.gold },
          { label: 'Resultado Oper.', value: fmtR(resultOperacional), color: resultOperacional > 0 ? C.green : C.red },
          { label: 'Margem Oper.', value: fmtPct(margemOper), color: margemOper > 10 ? C.green : margemOper > 5 ? C.yellow : C.red },
        ].map((s, i) => (
          <div key={i} style={{ background: C.card, borderRadius: 8, padding: 12, borderTop: '3px solid ' + s.color, textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: C.muted }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color, marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid ' + C.border }}>
        <button style={tabSt('dre')} onClick={() => setTab('dre')}>DRE Industrial</button>
        <button style={tabSt('cpv')} onClick={() => setTab('cpv')}>CPV Detalhado</button>
        <button style={tabSt('produto')} onClick={() => setTab('produto')}>Custo por Produto</button>
        <button style={tabSt('manual')} onClick={() => setTab('manual')}>Entrada Manual</button>
      </div>

      {/* TAB: DRE */}
      {tab === 'dre' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 12 }}>
            Demonstracao do Resultado - Custeio por Absorcao
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid ' + C.gold }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: C.gold, width: '45%' }}>Conta</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>Realizado</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>Orcado</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>Var. %</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>AV %</th>
              </tr>
            </thead>
            <tbody>
              {dreLines.map((line) => {
                const isHeader = line.tipo === 'header'
                const isTotal = line.tipo === 'total'
                const isSubtotal = line.tipo === 'subtotal'
                const varPct = line.orcado !== 0 ? ((line.realizado - line.orcado) / Math.abs(line.orcado)) * 100 : 0
                const avPct = recLiquida !== 0 ? (line.realizado / recLiquida) * 100 : 0

                if (isHeader) {
                  return (
                    <tr key={line.id} style={{ borderTop: line.nivel === 0 ? '1px solid ' + C.border : 'none' }}>
                      <td colSpan={5} style={{ padding: '10px 10px 4px', fontWeight: 700, fontSize: line.nivel === 0 ? 12 : 11, color: line.nivel === 0 ? C.gold : C.text }}>
                        {line.label}
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr key={line.id} style={{
                    borderBottom: '1px solid ' + (isTotal ? C.gold : C.border),
                    borderTop: isTotal ? '2px solid ' + C.gold : 'none',
                    background: isTotal ? C.gold + '08' : isSubtotal ? C.border + '30' : 'transparent',
                  }}>
                    <td style={{ padding: '6px 10px', fontWeight: isTotal || isSubtotal ? 700 : 400, fontSize: isTotal ? 12 : 11, color: isTotal ? C.gold : C.text }}>
                      {line.label}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: isTotal || isSubtotal ? 700 : 400, fontFamily: 'monospace',
                      color: line.realizado >= 0 ? (isTotal ? C.green : C.text) : C.red }}>
                      {fmtR(line.realizado)}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.muted }}>
                      {fmtR(line.orcado)}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: semCor(Math.abs(varPct) > 5 ? varPct : 0) }}>
                      {line.realizado !== 0 ? fmtPct(varPct) : '-'}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: C.muted, fontSize: 10 }}>
                      {line.realizado !== 0 && !isHeader ? fmtPct(avPct) : line.pct !== undefined ? fmtPct(line.pct) : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 12, padding: 10, background: C.bg, borderRadius: 6, fontSize: 9, color: C.muted, borderLeft: '3px solid ' + C.gold }}>
            <b style={{ color: C.gold }}>Base legal:</b> Custeio por Absorcao conforme Lei 6.404/76, CPC 16 (R2)/IAS 2, RIR/2018.
            Todos os custos de producao (diretos e indiretos, fixos e variaveis) sao alocados ao CPV.
            AV% = Analise Vertical sobre Receita Liquida.
          </div>
        </div>
      )}

      {/* TAB: CPV Detalhado */}
      {tab === 'cpv' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 12 }}>
            Composicao do CPV por Absorcao
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Table */}
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid ' + C.gold }}>
                    <th style={{ padding: '8px 8px', textAlign: 'left', color: C.gold }}>Grupo de Custo</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', color: C.gold }}>Valor (R$)</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', color: C.gold }}>%CPV</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', color: C.gold }}>R$/kg</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={4} style={{ padding: '8px 8px 4px', fontWeight: 700, color: C.gold, fontSize: 11 }}>CUSTOS DIRETOS</td></tr>
                  {GRUPOS_DIRETOS.map(g => {
                    const val = dados[g.campo] || 0
                    return (
                      <tr key={g.id} style={{ borderBottom: '1px solid ' + C.border }}>
                        <td style={{ padding: '5px 8px', paddingLeft: 20 }}>{g.label}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: C.red }}>{fmtR(val)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: C.muted }}>{cpv > 0 ? fmtPct((val / cpv) * 100) : '-'}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: C.gold }}>{volumeTon > 0 ? (val / (volumeTon * 1000)).toFixed(2) : '-'}</td>
                      </tr>
                    )
                  })}
                  <tr style={{ borderTop: '1px solid ' + C.gold, fontWeight: 600 }}>
                    <td style={{ padding: '6px 8px', color: C.text }}>Subtotal Diretos</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: C.red }}>{fmtR(custoDireto)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: C.muted }}>{cpv > 0 ? fmtPct((custoDireto / cpv) * 100) : '-'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: C.gold }}>{volumeTon > 0 ? (custoDireto / (volumeTon * 1000)).toFixed(2) : '-'}</td>
                  </tr>

                  <tr><td colSpan={4} style={{ padding: '10px 8px 4px', fontWeight: 700, color: C.gold, fontSize: 11 }}>CUSTOS INDIRETOS DE FABRICACAO (CIF)</td></tr>
                  {GRUPOS_CIF.map(g => {
                    const val = dados[g.campo] || 0
                    return (
                      <tr key={g.id} style={{ borderBottom: '1px solid ' + C.border }}>
                        <td style={{ padding: '5px 8px', paddingLeft: 20 }}>{g.label}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: C.red }}>{fmtR(val)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: C.muted }}>{cpv > 0 ? fmtPct((val / cpv) * 100) : '-'}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: C.gold }}>{volumeTon > 0 ? (val / (volumeTon * 1000)).toFixed(2) : '-'}</td>
                      </tr>
                    )
                  })}
                  <tr style={{ borderTop: '1px solid ' + C.gold, fontWeight: 600 }}>
                    <td style={{ padding: '6px 8px', color: C.text }}>Subtotal CIF</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: C.red }}>{fmtR(cif)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: C.muted }}>{cpv > 0 ? fmtPct((cif / cpv) * 100) : '-'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: C.gold }}>{volumeTon > 0 ? (cif / (volumeTon * 1000)).toFixed(2) : '-'}</td>
                  </tr>

                  <tr style={{ borderTop: '3px solid ' + C.gold, fontWeight: 700 }}>
                    <td style={{ padding: '8px 8px', color: C.gold, fontSize: 12 }}>TOTAL CPV</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'monospace', color: C.red, fontSize: 12 }}>{fmtR(cpv)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.gold }}>100%</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.gold, fontSize: 12 }}>{volumeTon > 0 ? (cpv / (volumeTon * 1000)).toFixed(2) : '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Visual */}
            <div>
              <div style={{ fontWeight: 700, color: C.gold, marginBottom: 10, fontSize: 12 }}>Composicao Visual</div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4, fontWeight: 700 }}>
                  <span style={{ color: C.teal }}>Custos Diretos</span>
                  <span style={{ color: C.teal }}>{cpv > 0 ? fmtPct((custoDireto / cpv) * 100) : '-'}</span>
                </div>
                <div style={{ height: 20, background: C.border, borderRadius: 4, overflow: 'hidden', marginBottom: 4 }}>
                  <div style={{ height: '100%', width: (cpv > 0 ? (custoDireto / cpv) * 100 : 0) + '%', background: C.teal, borderRadius: 4 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4, fontWeight: 700 }}>
                  <span style={{ color: C.orange }}>CIF (Indiretos)</span>
                  <span style={{ color: C.orange }}>{cpv > 0 ? fmtPct((cif / cpv) * 100) : '-'}</span>
                </div>
                <div style={{ height: 20, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: (cpv > 0 ? (cif / cpv) * 100 : 0) + '%', background: C.orange, borderRadius: 4 }} />
                </div>
              </div>

              {/* Individual bars */}
              {[...GRUPOS_DIRETOS, ...GRUPOS_CIF].filter(g => (dados[g.campo] || 0) > 0).sort((a, b) => (dados[b.campo] || 0) - (dados[a.campo] || 0)).map(g => {
                const val = dados[g.campo] || 0
                const pct = cpv > 0 ? (val / cpv) * 100 : 0
                return (
                  <div key={g.id} style={{ marginBottom: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 1 }}>
                      <span>{g.label}</span>
                      <span style={{ color: C.gold }}>{fmtPct(pct)}</span>
                    </div>
                    <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: pct + '%', background: pct > 15 ? C.red : pct > 5 ? C.yellow : C.green, borderRadius: 3 }} />
                    </div>
                  </div>
                )
              })}

              <div style={{ marginTop: 14, padding: 10, background: C.bg, borderRadius: 6, fontSize: 9, color: C.muted, borderLeft: '3px solid ' + C.teal }}>
                <b style={{ color: C.teal }}>Criterio de rateio CIF:</b> Proporcional ao volume de producao.
                Para rateio por centro de custo, use o Modulo Rateio.
                Dados alimentados pelo Modulo Industrial ou entrada manual.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: Custo por Produto */}
      {tab === 'produto' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 12 }}>
            Custo Unitario por Linha de Produto (Absorcao)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid ' + C.gold }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: C.gold }}>Linha de Produto</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>Custo Direto</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>CIF Rateado</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>Custo Total</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>R$/kg</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>% Receita</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>Margem</th>
              </tr>
            </thead>
            <tbody>
              {LINHAS_PRODUTO.map(lp => {
                const cd = custoDireto * (lp.pctMP / 100)
                const cifR = cif * (lp.pctVol / 100)
                const total = cd + cifR
                const vol = volumeTon * (lp.pctVol / 100) * 1000
                const custoUn = vol > 0 ? total / vol : 0
                const recProd = recLiquida * (lp.pctMP / 100)
                const margem = recProd > 0 ? ((recProd - total) / recProd) * 100 : 0
                return (
                  <tr key={lp.id} style={{ borderBottom: '1px solid ' + C.border }}>
                    <td style={{ padding: '8px 10px', fontWeight: 500 }}>{lp.label}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtR(cd)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.muted }}>{fmtR(cifR)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.red, fontWeight: 600 }}>{fmtR(total)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: C.gold, fontWeight: 600 }}>R$ {custoUn.toFixed(2)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: C.muted }}>{fmtPct(cpv > 0 ? (total / cpv) * 100 : 0)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: margem > 20 ? C.green : margem > 10 ? C.yellow : C.red }}>{fmtPct(margem)}</td>
                  </tr>
                )
              })}
              <tr style={{ borderTop: '2px solid ' + C.gold, fontWeight: 700 }}>
                <td style={{ padding: '8px 10px', color: C.gold }}>TOTAL</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtR(custoDireto)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.muted }}>{fmtR(cif)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.red }}>{fmtR(cpv)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>R$ {custoKg.toFixed(2)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>100%</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: margemBruta > 20 ? C.green : C.yellow }}>{fmtPct(margemBruta)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 12, padding: 10, background: C.bg, borderRadius: 6, fontSize: 9, color: C.muted, borderLeft: '3px solid ' + C.blue }}>
            <b style={{ color: C.blue }}>Metodologia:</b> Custos diretos alocados proporcionalmente ao consumo de MP por linha.
            CIF rateado por volume de producao. Para rateio por ABC (Activity Based Costing), configure no Modulo Rateio.
          </div>
        </div>
      )}

      {/* TAB: Entrada Manual */}
      {tab === 'manual' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 4 }}>
            Entrada Manual de Custos
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 12 }}>
            Para empresas sem integracao com o Modulo Industrial. Os dados serao salvos e usados em todos os relatorios.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Volume Producao (ton)</div>
              <input type="number" value={volumeTon} onChange={e => setVolumeTon(parseFloat(e.target.value) || 0)} style={{ ...inputSt, width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Receita Bruta (R$)</div>
              <input type="number" value={receitaBruta} onChange={e => setReceitaBruta(parseFloat(e.target.value) || 0)} style={{ ...inputSt, width: '100%' }} />
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid ' + C.gold }}>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: C.gold }}>Grupo</th>
                <th style={{ padding: '6px 8px', textAlign: 'right', color: C.gold }}>Valor (R$)</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={2} style={{ padding: '8px 8px 4px', fontWeight: 700, color: C.teal }}>Custos Diretos</td></tr>
              {GRUPOS_DIRETOS.map(g => (
                <tr key={g.id} style={{ borderBottom: '1px solid ' + C.border }}>
                  <td style={{ padding: '5px 8px', paddingLeft: 16 }}>{g.label}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                    <input type="number" defaultValue={Math.round(dados[g.campo] || 0)}
                      onChange={e => { setEditValues({...editValues, [g.campo]: parseFloat(e.target.value) || 0}); setEditMode(true) }}
                      style={{ width: 120, background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '4px 8px', borderRadius: 4, fontSize: 12, textAlign: 'right' }} />
                  </td>
                </tr>
              ))}
              <tr><td colSpan={2} style={{ padding: '10px 8px 4px', fontWeight: 700, color: C.orange }}>CIF (Custos Indiretos)</td></tr>
              {GRUPOS_CIF.map(g => (
                <tr key={g.id} style={{ borderBottom: '1px solid ' + C.border }}>
                  <td style={{ padding: '5px 8px', paddingLeft: 16 }}>{g.label}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                    <input type="number" defaultValue={Math.round(dados[g.campo] || 0)}
                      onChange={e => { setEditValues({...editValues, [g.campo]: parseFloat(e.target.value) || 0}); setEditMode(true) }}
                      style={{ width: 120, background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '4px 8px', borderRadius: 4, fontSize: 12, textAlign: 'right' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={saveManual} style={{ marginTop: 12, background: C.green, color: '#fff', border: 'none', padding: '12px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', width: '100%', fontSize: 14 }}>
            Salvar Custos
          </button>
        </div>
      )}
    </div>
  )
}
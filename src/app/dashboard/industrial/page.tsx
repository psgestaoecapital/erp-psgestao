'use client'

import React, { useState, useMemo } from 'react'

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════
type Cargo = 'ceo' | 'diretor' | 'gerente' | 'supervisor'
type Especie = 'suinos' | 'bovinos' | 'aves' | 'laticinios' | 'industrializados'
type Setor = 'campo' | 'recebimento' | 'abate' | 'desossa' | 'processamento' | 'embalagem' | 'expedicao' | 'comercial'

interface KPI { nome: string; valor: string; meta: string; status: 'green' | 'yellow' | 'red'; unidade: string }
interface Conector { nome: string; area: string; status: 'ativo' | 'disponivel' | 'planejado'; desc: string }

// ═══════════════════════════════════════════
// COLORS
// ═══════════════════════════════════════════
const C = {
  bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2',
  muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5',
  espresso: '#3D2314', teal: '#009688', purple: '#7E57C2', orange: '#FF9800',
}

// ═══════════════════════════════════════════
// SIMULATED DATA
// ═══════════════════════════════════════════
const CARGOS: Record<Cargo, { label: string; desc: string }> = {
  ceo: { label: 'CEO / Presidente', desc: 'Visao consolidada de todas as unidades e especies' },
  diretor: { label: 'Diretor Industrial', desc: 'Performance por planta e cadeia produtiva' },
  gerente: { label: 'Gerente de Planta', desc: 'KPIs operacionais e eficiencia por setor' },
  supervisor: { label: 'Supervisor de Producao', desc: 'Detalhamento por linha, turno e equipe' },
}

const ESPECIES: Record<Especie, { label: string; icon: string; color: string }> = {
  suinos: { label: 'Suinos', icon: 'S', color: '#E91E63' },
  bovinos: { label: 'Bovinos', icon: 'B', color: '#795548' },
  aves: { label: 'Aves', icon: 'A', color: '#FF9800' },
  laticinios: { label: 'Laticinios', icon: 'L', color: '#2196F3' },
  industrializados: { label: 'Industrializados', icon: 'I', color: '#9C27B0' },
}

const SETORES: { id: Setor; label: string; icon: string }[] = [
  { id: 'campo', label: 'Campo', icon: 'C' },
  { id: 'recebimento', label: 'Recebimento', icon: 'R' },
  { id: 'abate', label: 'Abate', icon: 'A' },
  { id: 'desossa', label: 'Desossa', icon: 'D' },
  { id: 'processamento', label: 'Processamento', icon: 'P' },
  { id: 'embalagem', label: 'Embalagem', icon: 'E' },
  { id: 'expedicao', label: 'Expedicao', icon: 'X' },
  { id: 'comercial', label: 'Comercial', icon: 'V' },
]

const CONECTORES: Conector[] = [
  { nome: 'SAP S/4HANA', area: 'ERP Corporativo', status: 'disponivel', desc: 'Financeiro, fiscal, contabil, compras, vendas' },
  { nome: 'TOTVS Protheus', area: 'ERP Corporativo', status: 'disponivel', desc: 'Modulos industriais, PCP, custos, fiscal' },
  { nome: 'Senior Sistemas', area: 'RH e Folha', status: 'disponivel', desc: 'Gestao de pessoas, folha, ponto, beneficios' },
  { nome: 'Linx', area: 'Comercial', status: 'disponivel', desc: 'PDV, gestao de vendas, fidelizacao' },
  { nome: 'MES (PIMS/Infor)', area: 'Chao de Fabrica', status: 'disponivel', desc: 'Execucao de producao, rastreabilidade, OEE tempo real' },
  { nome: 'WMS (Manhattan/Korber)', area: 'Logistica', status: 'disponivel', desc: 'Gestao de armazem, picking, inventario, FIFO/FEFO' },
  { nome: 'TMS (TOTVS/SAP)', area: 'Transporte', status: 'disponivel', desc: 'Gestao de frota, roteirizacao, custos de frete' },
  { nome: 'SIF/DIPOA (MAPA)', area: 'Inspecao Federal', status: 'ativo', desc: 'Servico de Inspecao Federal, certificacoes sanitarias' },
  { nome: 'Paripassu', area: 'Rastreabilidade', status: 'disponivel', desc: 'Rastreabilidade do campo a mesa, blockchain' },
  { nome: 'Neogrid/VMI', area: 'Supply Chain', status: 'planejado', desc: 'Reposicao automatica, EDI, visibilidade de estoque' },
  { nome: 'SCADA/PLC', area: 'Automacao', status: 'disponivel', desc: 'Supervisorio, CLPs, sensores IoT, temperatura' },
  { nome: 'eNotas/Focus', area: 'NF-e', status: 'planejado', desc: 'Emissao e gestao de notas fiscais eletronicas' },
  { nome: 'Pluggy/Belvo', area: 'Open Banking', status: 'planejado', desc: 'Conciliacao bancaria automatica, fluxo de caixa' },
  { nome: 'LIMS', area: 'Laboratorio', status: 'disponivel', desc: 'Controle de qualidade, analises microbiologicas, laudos' },
  { nome: 'Manusis/SAP PM', area: 'Manutencao', status: 'disponivel', desc: 'Preventiva, preditiva, corretiva, MTBF, MTTR' },
  { nome: 'BI (Power BI/Tableau)', area: 'Analytics', status: 'disponivel', desc: 'Dashboards executivos, relatorios avancados' },
]

function genKPIs(cargo: Cargo, especie: Especie, setor: Setor): KPI[] {
  const r = (min: number, max: number) => (min + Math.random() * (max - min))
  const f = (v: number, d: number = 1) => v.toFixed(d)

  const base: Record<string, KPI[]> = {
    ceo: [
      { nome: 'Faturamento Bruto', valor: 'R$ ' + f(r(180, 320), 0) + 'M', meta: 'R$ 280M', status: r(0,1) > 0.3 ? 'green' : 'yellow', unidade: 'mensal' },
      { nome: 'EBITDA', valor: f(r(8, 18)) + '%', meta: '15%', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '' },
      { nome: 'Margem Liquida', valor: f(r(3, 12)) + '%', meta: '8%', status: r(0,1) > 0.4 ? 'green' : 'red', unidade: '' },
      { nome: 'Custo/kg Produzido', valor: 'R$ ' + f(r(4.5, 9.2)), meta: 'R$ 6.80', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '/kg' },
      { nome: 'Volume Total', valor: f(r(15, 45), 0) + 'K ton', meta: '35K ton', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: 'mensal' },
      { nome: 'Market Share', valor: f(r(8, 22)) + '%', meta: '18%', status: r(0,1) > 0.4 ? 'green' : 'yellow', unidade: '' },
      { nome: 'Plantas Ativas', valor: String(Math.floor(r(4, 12))), meta: '8', status: 'green', unidade: 'unidades' },
      { nome: 'Colaboradores', valor: f(r(3, 15), 0) + 'K', meta: '-', status: 'green', unidade: '' },
    ],
    diretor: [
      { nome: 'OEE Global', valor: f(r(72, 92)) + '%', meta: '85%', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '' },
      { nome: 'Rendimento Carcaca', valor: f(r(48, 56)) + '%', meta: '52%', status: r(0,1) > 0.5 ? 'green' : 'red', unidade: '' },
      { nome: 'Quebra Total', valor: f(r(1.5, 4.5)) + '%', meta: '< 3%', status: r(0,1) > 0.4 ? 'green' : 'red', unidade: '' },
      { nome: 'Custo MP/kg', valor: 'R$ ' + f(r(3.2, 7.8)), meta: 'R$ 5.50', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '/kg' },
      { nome: 'Produtividade MO', valor: f(r(120, 280), 0) + ' kg/h', meta: '200 kg/h', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '' },
      { nome: 'Absenteismo', valor: f(r(2, 8)) + '%', meta: '< 4%', status: r(0,1) > 0.3 ? 'yellow' : 'red', unidade: '' },
      { nome: 'Energia kWh/ton', valor: f(r(80, 180), 0), meta: '120', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: 'kWh/ton' },
      { nome: 'Agua m3/ton', valor: f(r(5, 18)), meta: '10', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: 'm3/ton' },
    ],
    gerente: [
      { nome: 'Cabecas/Dia', valor: f(r(800, 4500), 0), meta: '3.000', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '' },
      { nome: 'OEE Linha Principal', valor: f(r(75, 95)) + '%', meta: '88%', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '' },
      { nome: 'Disponibilidade', valor: f(r(85, 98)) + '%', meta: '95%', status: r(0,1) > 0.5 ? 'green' : 'red', unidade: '' },
      { nome: 'Performance', valor: f(r(80, 96)) + '%', meta: '92%', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '' },
      { nome: 'Qualidade', valor: f(r(92, 99.5)) + '%', meta: '98%', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '' },
      { nome: 'Yield Desossa', valor: f(r(38, 52)) + '%', meta: '45%', status: r(0,1) > 0.5 ? 'green' : 'red', unidade: '' },
      { nome: 'Temp. Camaras', valor: f(r(-2, 4), 1) + ' C', meta: '0-2 C', status: r(0,1) > 0.5 ? 'green' : 'red', unidade: '' },
      { nome: 'NC SIF Mes', valor: String(Math.floor(r(0, 8))), meta: '0', status: r(0,1) > 0.6 ? 'green' : 'red', unidade: '' },
    ],
    supervisor: [
      { nome: 'Producao Turno', valor: f(r(400, 1800), 0) + ' cab', meta: '1.200', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '' },
      { nome: 'Kg/Homem/Hora', valor: f(r(25, 65), 0), meta: '45', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '' },
      { nome: 'Paradas (min)', valor: f(r(5, 90), 0), meta: '< 30', status: r(0,1) > 0.4 ? 'green' : 'red', unidade: 'min' },
      { nome: 'Retrabalho', valor: f(r(0.5, 5)) + '%', meta: '< 2%', status: r(0,1) > 0.4 ? 'green' : 'red', unidade: '' },
      { nome: 'Presentes/Escala', valor: f(r(85, 100), 0) + '%', meta: '95%', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '' },
      { nome: 'Acidentes Turno', valor: String(Math.floor(r(0, 3))), meta: '0', status: r(0,1) > 0.7 ? 'green' : 'red', unidade: '' },
      { nome: 'CQ Aprovacao', valor: f(r(94, 99.8)) + '%', meta: '98%', status: r(0,1) > 0.5 ? 'green' : 'yellow', unidade: '' },
      { nome: 'Temp. Produto', valor: f(r(-1, 7), 1) + ' C', meta: '0-4 C', status: r(0,1) > 0.5 ? 'green' : 'red', unidade: '' },
    ],
  }
  return base[cargo] || base.gerente
}

const CUSTO_GRUPOS = [
  { grupo: 'Materia-Prima / Animal Vivo', pct: 62, valor: 0 },
  { grupo: 'Mao de Obra Direta', pct: 12, valor: 0 },
  { grupo: 'Mao de Obra Indireta', pct: 4, valor: 0 },
  { grupo: 'Embalagens', pct: 5, valor: 0 },
  { grupo: 'Energia Eletrica', pct: 3.5, valor: 0 },
  { grupo: 'Gas / Vapor', pct: 2, valor: 0 },
  { grupo: 'Agua e Efluentes', pct: 1.5, valor: 0 },
  { grupo: 'Manutencao', pct: 2.5, valor: 0 },
  { grupo: 'Logistica Interna', pct: 1.5, valor: 0 },
  { grupo: 'Depreciacao', pct: 2, valor: 0 },
  { grupo: 'Insumos e Quimicos', pct: 1.5, valor: 0 },
  { grupo: 'Servicos Terceirizados', pct: 1.5, valor: 0 },
  { grupo: 'Outros Custos Ind.', pct: 1, valor: 0 },
].map(g => ({ ...g, valor: (g.pct / 100) * (4500000 + Math.random() * 3000000) }))

// ═══════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════
export default function IndustrialPage() {
  const [cargo, setCargo] = useState<Cargo>('ceo')
  const [especie, setEspecie] = useState<Especie>('suinos')
  const [setorSel, setSetorSel] = useState<Setor | null>(null)
  const [tab, setTab] = useState<'kpis' | 'cadeia' | 'custos' | 'conectores'>('kpis')

  const kpis = useMemo(() => genKPIs(cargo, especie, setorSel || 'abate'), [cargo, especie, setorSel])
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const totalCusto = CUSTO_GRUPOS.reduce((s, g) => s + g.valor, 0)

  const statusColor = (s: string) => s === 'green' ? C.green : s === 'yellow' ? C.yellow : C.red
  const statusIcon = (s: string) => s === 'green' ? 'OK' : s === 'yellow' ? 'ATN' : 'CRIT'

  const cargoSt = (c: Cargo): React.CSSProperties => ({
    padding: '10px 16px', borderRadius: 8, cursor: 'pointer', border: 'none', textAlign: 'left' as const,
    background: cargo === c ? C.gold : C.card, color: cargo === c ? C.espresso : C.text,
    fontWeight: cargo === c ? 700 : 400, fontSize: 12, flex: 1, minWidth: 140, transition: '0.15s',
  })

  const especieSt = (e: Especie): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 20, cursor: 'pointer', border: especie === e ? '2px solid ' + ESPECIES[e].color : '2px solid ' + C.border,
    background: especie === e ? ESPECIES[e].color + '20' : 'transparent',
    color: especie === e ? ESPECIES[e].color : C.muted, fontWeight: 600, fontSize: 11,
  })

  const tabSt = (t: string): React.CSSProperties => ({
    padding: '10px 20px', cursor: 'pointer', border: 'none', fontWeight: 600, fontSize: 12,
    background: tab === t ? C.gold : 'transparent', color: tab === t ? C.espresso : C.muted,
    borderRadius: '8px 8px 0 0',
  })

  const connStatus = (s: string) => s === 'ativo' ? C.green : s === 'disponivel' ? C.blue : C.muted
  const connLabel = (s: string) => s === 'ativo' ? 'Ativo' : s === 'disponivel' ? 'Disponivel' : 'Planejado'

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.gold, margin: 0, letterSpacing: '-0.5px' }}>
            Industrial
          </h1>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Cadeia Completa do Agronegocio | Campo ao Comercial</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: C.muted, padding: '4px 10px', background: C.card, borderRadius: 12 }}>
            Dados Simulados | v8.1.0
          </span>
        </div>
      </div>

      {/* CARGO CASCADE */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Nivel Hierarquico</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(Object.keys(CARGOS) as Cargo[]).map(c => (
            <button key={c} onClick={() => setCargo(c)} style={cargoSt(c)}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{CARGOS[c].label}</div>
              <div style={{ fontSize: 9, opacity: 0.7, marginTop: 2 }}>{CARGOS[c].desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ESPECIE SELECTOR */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: C.muted, marginRight: 4, fontWeight: 600 }}>ESPECIE:</span>
        {(Object.keys(ESPECIES) as Especie[]).map(e => (
          <button key={e} onClick={() => setEspecie(e)} style={especieSt(e)}>
            {ESPECIES[e].label}
          </button>
        ))}
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid ' + C.border, marginBottom: 0 }}>
        <button style={tabSt('kpis')} onClick={() => setTab('kpis')}>KPIs Operacionais</button>
        <button style={tabSt('cadeia')} onClick={() => setTab('cadeia')}>Cadeia Produtiva</button>
        <button style={tabSt('custos')} onClick={() => setTab('custos')}>Custos Industriais</button>
        <button style={tabSt('conectores')} onClick={() => setTab('conectores')}>Conectores</button>
      </div>

      {/* TAB: KPIs */}
      {tab === 'kpis' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {kpis.map((k, i) => (
              <div key={i} style={{ background: C.bg, borderRadius: 8, padding: 14, borderLeft: '3px solid ' + statusColor(k.status), position: 'relative' }}>
                <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 9, fontWeight: 700, color: statusColor(k.status), background: statusColor(k.status) + '20', padding: '2px 6px', borderRadius: 8 }}>
                  {statusIcon(k.status)}
                </div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{k.nome}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.text, lineHeight: 1 }}>{k.valor}</div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>Meta: {k.meta} {k.unidade}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: CADEIA PRODUTIVA */}
      {tab === 'cadeia' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 12 }}>
            Cadeia: {ESPECIES[especie].label} | Visao: {CARGOS[cargo].label}
          </div>

          {/* Value Chain Flow */}
          <div style={{ display: 'flex', gap: 0, overflowX: 'auto', paddingBottom: 12, marginBottom: 16 }}>
            {SETORES.map((s, i) => {
              const isSelected = setorSel === s.id
              const oee = (75 + Math.random() * 20).toFixed(1)
              const vol = Math.floor(500 + Math.random() * 3000)
              const statusVal = parseFloat(oee) > 88 ? 'green' : parseFloat(oee) > 78 ? 'yellow' : 'red'
              return (
                <React.Fragment key={s.id}>
                  <button onClick={() => setSetorSel(isSelected ? null : s.id)} style={{
                    background: isSelected ? C.gold : C.bg, color: isSelected ? C.espresso : C.text,
                    border: '1px solid ' + (isSelected ? C.gold : C.border), borderRadius: 8,
                    padding: '12px 14px', minWidth: 110, cursor: 'pointer', textAlign: 'center' as const,
                    flexShrink: 0, transition: '0.15s',
                  }}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: isSelected ? C.espresso : statusColor(statusVal) }}>{oee}%</div>
                    <div style={{ fontSize: 9, color: isSelected ? C.espresso : C.muted, marginTop: 2 }}>{vol} ton/dia</div>
                  </button>
                  {i < SETORES.length - 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', padding: '0 2px', color: C.border, fontSize: 16 }}>{'>'}</div>
                  )}
                </React.Fragment>
              )
            })}
          </div>

          {/* Selected sector detail */}
          {setorSel && (
            <div style={{ background: C.bg, borderRadius: 8, padding: 16, borderLeft: '3px solid ' + C.gold }}>
              <div style={{ fontWeight: 700, color: C.gold, marginBottom: 10 }}>
                Detalhamento: {SETORES.find(s => s.id === setorSel)?.label}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {genKPIs(cargo, especie, setorSel).slice(0, 6).map((k, i) => (
                  <div key={i} style={{ background: C.card, borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 9, color: C.muted }}>{k.nome}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: statusColor(k.status) }}>{k.valor}</div>
                    <div style={{ fontSize: 9, color: C.muted }}>Meta: {k.meta}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: CUSTOS INDUSTRIAIS */}
      {tab === 'custos' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, color: C.gold, fontSize: 14 }}>Composicao de Custo Industrial - {ESPECIES[especie].label}</div>
            <div style={{ fontSize: 11, color: C.muted }}>
              Fonte: {cargo === 'ceo' || cargo === 'diretor' ? 'Consolidado' : 'Planta selecionada'} | Modulo Industrial + Manual
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Cost Table */}
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid ' + C.border }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: C.gold, fontWeight: 600 }}>Grupo</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold, fontWeight: 600 }}>Valor</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', color: C.gold, fontWeight: 600 }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {CUSTO_GRUPOS.map((g, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}>
                      <td style={{ padding: '6px 10px' }}>{g.grupo}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.red }}>{fmt(g.valor)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: C.muted }}>{g.pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid ' + C.gold, fontWeight: 700 }}>
                    <td style={{ padding: '8px 10px', color: C.gold }}>TOTAL</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: C.red }}>{fmt(totalCusto)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: C.gold }}>100%</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Visual bars */}
            <div>
              {CUSTO_GRUPOS.map((g, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                    <span style={{ color: C.text }}>{g.grupo}</span>
                    <span style={{ color: C.gold }}>{g.pct.toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: g.pct + '%', background: g.pct > 10 ? C.red : g.pct > 3 ? C.yellow : C.green, borderRadius: 4, transition: '0.3s' }} />
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 12, padding: 10, background: C.bg, borderRadius: 6, fontSize: 10, color: C.muted }}>
                Dados podem ser alimentados pelo Modulo Industrial (automatico) ou manualmente via Modulo Custo para empresas sem operacao industrial.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: CONECTORES */}
      {tab === 'conectores' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ fontWeight: 700, color: C.gold, marginBottom: 12, fontSize: 14 }}>
            Conectores e Integracoes | Campo ao Comercial
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {CONECTORES.map((c, i) => (
              <div key={i} style={{ background: C.bg, borderRadius: 8, padding: 12, borderLeft: '3px solid ' + connStatus(c.status) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{c.nome}</div>
                  <span style={{ fontSize: 9, fontWeight: 700, color: connStatus(c.status), background: connStatus(c.status) + '20', padding: '2px 8px', borderRadius: 8 }}>
                    {connLabel(c.status)}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: C.gold, marginBottom: 4 }}>{c.area}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{c.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, padding: 12, background: C.bg, borderRadius: 8, borderLeft: '3px solid ' + C.blue, fontSize: 11, color: C.muted }}>
            <b style={{ color: C.blue }}>Arquitetura de Integracao:</b> Todos os conectores seguem padrao REST API + webhooks.
            Dados fluem do sistema de origem para o PS Gestao via ETL agendado ou tempo real,
            alimentando automaticamente os modulos Industrial, Custo, Operacional e Consultor IA.
          </div>
        </div>
      )}
    </div>
  )
}
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import PSGCMetric from '@/components/psgc/PSGCMetric'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import { PSGC_COLORS, PSGC_RADIUS } from '@/lib/psgc-tokens'

const ROTA_AJUDA = '/dashboard/financeiro/fluxo-caixa'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'

type DiaFluxo = {
  data: string
  eh_futuro?: boolean
  recebimentos: number
  pagamentos: number
  recebimentos_previstos?: number
  pagamentos_previstos?: number
  transferencias_entrada: number
  transferencias_saida: number
  movimento_dia: number
  saldo_final: number
}
type FluxoResp = {
  hoje?: string
  conta_id?: string | null
  categoria?: string | null
  saldo_inicial: number
  saldo_final: number
  total_recebimentos: number
  total_pagamentos: number
  total_recebimentos_previstos?: number
  total_pagamentos_previstos?: number
  total_receber_vencido_aberto?: number
  total_pagar_vencido_aberto?: number
  movimento_liquido: number
  dias: DiaFluxo[]
}
type ContaFiltro = { id: string; nome: string }
type Filtros = { contas: ContaFiltro[]; categorias: string[] }

// Entrada/saída exibida por dia: realizado no passado, previsto (por vencimento) no futuro.
const entradaDia = (d: DiaFluxo) => (d.eh_futuro ? (d.recebimentos_previstos ?? 0) : d.recebimentos)
const saidaDia = (d: DiaFluxo) => (d.eh_futuro ? (d.pagamentos_previstos ?? 0) : d.pagamentos)

const brl = (v: number) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const hojeISO = () => new Date().toISOString().slice(0, 10)

export default function FluxoCaixaPage() {
  const router = useRouter()
  const { companyIds } = useCompanyIds()
  const empresaUnica = companyIds.length === 1 ? companyIds[0] : null

  const [periodo, setPeriodo] = useState<7 | 30 | 90>(30)
  const [contaId, setContaId] = useState<string>('')      // '' = todas as contas
  const [categoria, setCategoria] = useState<string>('')  // '' = todas as categorias
  const [filtros, setFiltros] = useState<Filtros>({ contas: [], categorias: [] })
  const [dados, setDados] = useState<FluxoResp | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const filtrandoCategoria = categoria !== ''

  // Opções dos seletores (contas ativas + categorias usadas), uma chamada por empresa.
  useEffect(() => {
    let vivo = true
    if (!empresaUnica) { setFiltros({ contas: [], categorias: [] }); return }
    supabase.rpc('fn_fluxo_caixa_filtros', { p_company_id: empresaUnica }).then(({ data }) => {
      if (vivo && data) setFiltros(data as Filtros)
    })
    return () => { vivo = false }
  }, [empresaUnica])

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    setCarregando(true)
    setErro(null)
    const inicio = new Date()
    inicio.setDate(inicio.getDate() - periodo)
    const fim = new Date()
    fim.setDate(fim.getDate() + periodo)
    const { data, error } = await supabase.rpc('fn_fluxo_caixa_diario', {
      p_company_id: empresaUnica,
      p_data_inicio: inicio.toISOString().slice(0, 10),
      p_data_fim: fim.toISOString().slice(0, 10),
      p_conta_id: contaId || null,
      p_categoria: categoria || null,
    })
    if (error) setErro('Não foi possível carregar o fluxo de caixa agora.')
    else setDados(data as FluxoResp)
    setCarregando(false)
  }, [empresaUnica, periodo, contaId, categoria])

  useEffect(() => { carregar() }, [carregar])

  if (!empresaUnica) {
    return (
      <div style={{ padding: 24, background: PSGC_COLORS.offWhite, minHeight: '100vh' }}>
        <h1 style={{ color: PSGC_COLORS.espresso, fontSize: 20, fontWeight: 700 }}>Fluxo de Caixa</h1>
        <p style={{ color: PSGC_COLORS.espresso, marginTop: 12, opacity: 0.7 }}>
          Selecione uma empresa específica no topo para ver o fluxo de caixa dela.
        </p>
      </div>
    )
  }

  const dias = dados?.dias ?? []
  const saldoHoje = dias.find((d) => d.data === hojeISO())?.saldo_final ?? dados?.saldo_final ?? 0
  const diasComMov = dias.filter((d) =>
    d.movimento_dia !== 0 || d.transferencias_entrada > 0 || d.transferencias_saida > 0,
  )
  const totalTransfEntrada = dias.reduce((s, d) => s + (d.transferencias_entrada ?? 0), 0)
  const totalTransfSaida = dias.reduce((s, d) => s + (d.transferencias_saida ?? 0), 0)
  const HOJE = hojeISO()
  // Realizado (sólido, até hoje) × Previsto (tracejado, de hoje em diante, por vencimento).
  // A linha de saldo é contínua: hoje aparece nos dois para conectar.
  const chartData = dias.map((d) => ({
    data: d.data.slice(5),
    saldoReal: d.data <= HOJE ? Number(d.saldo_final) : null,
    saldoPrevisto: d.data >= HOJE ? Number(d.saldo_final) : null,
    ehHoje: d.data === HOJE,
    entrada: entradaDia(d),
    saida: saidaDia(d),
    movimento: d.movimento_dia,
    futuro: !!d.eh_futuro,
  }))
  const temPrevisto = dias.some((d) => d.eh_futuro)
  const previstoEntrar = dados?.total_recebimentos_previstos ?? 0
  const previstoSair = dados?.total_pagamentos_previstos ?? 0
  // Legibilidade do gráfico (RD-98): com poucos pontos ou saldo quase constante a curva fica
  // "plana"/ilegível. Calcula um domínio com folga, mostra pontos quando são poucos e avisa
  // quando o saldo é estável, em vez de exibir uma linha colada na borda.
  const saldosSerie = dias.map((d) => Number(d.saldo_final))
  const minSaldo = saldosSerie.length ? Math.min(...saldosSerie) : 0
  const maxSaldo = saldosSerie.length ? Math.max(...saldosSerie) : 0
  const spanSaldo = maxSaldo - minSaldo
  const padSaldo = spanSaldo === 0 ? Math.max(Math.abs(maxSaldo) * 0.1, 100) : spanSaldo * 0.15
  const yDomain: [number, number] = [minSaldo - padSaldo, maxSaldo + padSaldo]
  const poucosPontos = chartData.length > 0 && chartData.length <= 8
  const saldoEstavel = chartData.length >= 2 && spanSaldo === 0
  const fmtEixoSaldo = (v: number) => {
    const a = Math.abs(v)
    if (a >= 1000) return `R$${(v / 1000).toFixed(a >= 10000 ? 0 : 1)}k`
    return `R$${Math.round(v)}`
  }

  const nomeContaSel = filtros.contas.find((c) => c.id === contaId)?.nome ?? ''
  const rotuloSaldo = filtrandoCategoria ? 'Acumulado da categoria' : 'Saldo Atual'

  // Exportar o período em CSV (separador ";" = padrão BR, abre direto no Excel).
  const exportarCSV = () => {
    const sep = ';'
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
    const num = (v: number) => (v ?? 0).toFixed(2).replace('.', ',')
    const cab = ['Data', 'Entradas', 'Saidas', 'Transf. entrada', 'Transf. saida', 'Movimento', 'Saldo no dia', 'Previsto']
    const linhas = diasComMov.map((d) =>
      [d.data, num(entradaDia(d)), num(saidaDia(d)), num(d.transferencias_entrada), num(d.transferencias_saida),
        num(d.movimento_dia), num(d.saldo_final), d.eh_futuro ? 'sim' : 'nao'].map(esc).join(sep),
    )
    const ctx = [`Conta${sep}${esc(nomeContaSel || 'Todas as contas')}`, `Categoria${sep}${esc(categoria || 'Todas')}`]
    const csv = '﻿' + [...ctx, '', cab.map(esc).join(sep), ...linhas].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fluxo-caixa_${hojeISO()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ padding: 16, background: PSGC_COLORS.offWhite, minHeight: '100vh' }}>
      <h1 style={{ color: PSGC_COLORS.espresso, fontSize: 22, fontWeight: 800, marginBottom: 4 }}>
        Fluxo de Caixa
      </h1>
      <p style={{ color: PSGC_COLORS.espresso, opacity: 0.65, fontSize: 13, marginBottom: 16 }}>
        Visão diária do seu saldo · entradas e saídas
      </p>

      <div style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(61,35,20,0.6)', marginBottom: 6 }}>
        Período<AjudaCampo chave="ge.fluxo_caixa.periodo" rota={ROTA_AJUDA} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {([7, 30, 90] as const).map((p) => (
          <button key={p} onClick={() => setPeriodo(p)}
            style={{
              flex: 1, padding: '8px 0', borderRadius: PSGC_RADIUS.md,
              border: `1px solid ${PSGC_COLORS.espresso}`,
              background: periodo === p ? PSGC_COLORS.espresso : 'transparent',
              color: periodo === p ? PSGC_COLORS.offWhite : PSGC_COLORS.espresso,
              fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}>
            {p} dias
          </button>
        ))}
      </div>

      {/* Filtros: conta + categoria (RD-99). O seletor de conta usa o fn_fluxo_caixa_diario já corrigido por conta. */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 180px', minWidth: 160 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(61,35,20,0.6)', marginBottom: 6 }}>
            Conta<AjudaCampo chave="ge.fluxo_caixa.filtro_conta" rota={ROTA_AJUDA} />
          </div>
          <select value={contaId} onChange={(e) => setContaId(e.target.value)} style={selectStyle}>
            <option value="">Todas as contas</option>
            {filtros.contas.map((c) => (<option key={c.id} value={c.id}>{c.nome}</option>))}
          </select>
        </div>
        <div style={{ flex: '1 1 180px', minWidth: 160 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(61,35,20,0.6)', marginBottom: 6 }}>
            Categoria<AjudaCampo chave="ge.fluxo_caixa.filtro_categoria" rota={ROTA_AJUDA} />
          </div>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={selectStyle}>
            <option value="">Todas as categorias</option>
            {filtros.categorias.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
      </div>

      {/* Ações: lançar movimentação direto e exportar (RD-98 pilar 2 / RD-99). */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(61,35,20,0.6)' }}>
          Lançar<AjudaCampo chave="ge.fluxo_caixa.nova_movimentacao" rota={ROTA_AJUDA} />
        </div>
        <button onClick={() => router.push('/dashboard/financeiro/nova-receita')}
          style={{ padding: '8px 14px', borderRadius: PSGC_RADIUS.md, border: 'none', background: PSGC_COLORS.dourado, color: PSGC_COLORS.espresso, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          + Lançar receita
        </button>
        <button onClick={() => router.push('/dashboard/financeiro/nova-despesa')}
          style={{ padding: '8px 14px', borderRadius: PSGC_RADIUS.md, border: `1px solid ${PSGC_COLORS.espresso}`, background: 'transparent', color: PSGC_COLORS.espresso, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          − Lançar despesa
        </button>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'inline-flex', alignItems: 'center' }}>
          <button onClick={exportarCSV} disabled={diasComMov.length === 0}
            style={{ padding: '8px 14px', borderRadius: PSGC_RADIUS.md, border: `1px solid ${PSGC_COLORS.espresso}`, background: 'transparent', color: PSGC_COLORS.espresso, fontWeight: 700, fontSize: 13, cursor: diasComMov.length === 0 ? 'not-allowed' : 'pointer', opacity: diasComMov.length === 0 ? 0.45 : 1 }}>
            ↓ Exportar CSV
          </button>
          <AjudaCampo chave="ge.fluxo_caixa.exportar" rota={ROTA_AJUDA} />
        </div>
      </div>

      {filtrandoCategoria && (
        <div style={{ background: '#FFF7ED', border: `1px solid ${PSGC_COLORS.dourado}`, borderRadius: PSGC_RADIUS.md, padding: '10px 12px', marginBottom: 16, fontSize: 12.5, color: PSGC_COLORS.espresso, lineHeight: 1.5 }}>
          Mostrando só o fluxo da categoria <b>{categoria}</b>. O acumulado começa em zero (fluxo líquido da categoria no período) — o saldo bancário não pertence a uma categoria, e transferências não entram neste filtro.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 20 }}>
        <PSGCMetric label={rotuloSaldo} valor={brl(saldoHoje)} destaque
          icon="wallet" cor={PSGC_COLORS.espresso} ajuda="ge.fluxo_caixa.kpi.saldo_atual" ajudaRota={ROTA_AJUDA} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <PSGCMetric label="Entradas realizadas no período" valor={brl(dados?.total_recebimentos ?? 0)}
            icon="arrow-up" cor={PSGC_COLORS.baixa} pequeno ajuda="ge.fluxo_caixa.kpi.entradas" ajudaRota={ROTA_AJUDA} />
          <PSGCMetric label="Saídas realizadas no período" valor={brl(dados?.total_pagamentos ?? 0)}
            icon="arrow-down" cor={PSGC_COLORS.alta} pequeno ajuda="ge.fluxo_caixa.kpi.saidas" ajudaRota={ROTA_AJUDA} />
        </div>
        {(previstoEntrar > 0 || previstoSair > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <PSGCMetric label="Previsto a entrar" valor={brl(previstoEntrar)}
              icon="arrow-up" cor={PSGC_COLORS.dourado} pequeno ajuda="ge.fluxo_caixa.kpi.previsto_entrar" ajudaRota={ROTA_AJUDA} />
            <PSGCMetric label="Previsto a sair" valor={brl(previstoSair)}
              icon="arrow-down" cor={PSGC_COLORS.dourado} pequeno ajuda="ge.fluxo_caixa.kpi.previsto_sair" ajudaRota={ROTA_AJUDA} />
          </div>
        )}
      </div>

      <div style={{ background: '#fff', borderRadius: PSGC_RADIUS.lg, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <p style={{ color: PSGC_COLORS.espresso, fontWeight: 700, fontSize: 14, margin: 0, display: 'inline-flex', alignItems: 'center' }}>
            Saldo dia a dia<AjudaCampo chave="ge.fluxo_caixa.grafico" rota={ROTA_AJUDA} />
          </p>
          {temPrevisto && (
            <div style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, color: 'rgba(61,35,20,0.7)', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={PSGC_COLORS.espresso} strokeWidth="2" /></svg>
                Realizado
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={PSGC_COLORS.espresso} strokeWidth="2" strokeDasharray="5 4" /></svg>
                Previsto
              </span>
              <AjudaCampo chave="ge.fluxo_caixa.legenda_previsto" rota={ROTA_AJUDA} />
            </div>
          )}
        </div>
        {carregando ? (
          <p style={{ color: PSGC_COLORS.espresso, opacity: 0.6, fontSize: 13 }}>Carregando…</p>
        ) : erro ? (
          <p style={{ color: PSGC_COLORS.alta, fontSize: 13 }}>{erro}</p>
        ) : chartData.length < 2 ? (
          <div style={{ padding: '28px 8px', textAlign: 'center', color: PSGC_COLORS.espresso, opacity: 0.6, fontSize: 13, lineHeight: 1.5 }}>
            Ainda não há dias suficientes para traçar a curva do saldo.<br />
            Registre movimentações (ou aumente o período) para ver a evolução aqui.
          </div>
        ) : (
          <>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="gradSaldo" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PSGC_COLORS.dourado} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={PSGC_COLORS.dourado} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="data" tick={{ fontSize: 10, fill: PSGC_COLORS.espresso }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: PSGC_COLORS.espresso }} width={56}
                domain={yDomain} tickFormatter={(v) => fmtEixoSaldo(Number(v))} />
              <Tooltip content={<FluxoTooltip />} />
              <ReferenceLine x={hojeISO().slice(5)} stroke={PSGC_COLORS.dourado} strokeDasharray="4 2" />
              <Area type="monotone" dataKey="saldoReal" stroke={PSGC_COLORS.espresso}
                strokeWidth={2} fill="url(#gradSaldo)" connectNulls
                dot={poucosPontos ? { r: 3, fill: PSGC_COLORS.espresso, strokeWidth: 0 } : false}
                activeDot={{ r: 4 }} />
              <Area type="monotone" dataKey="saldoPrevisto" stroke={PSGC_COLORS.espresso}
                strokeWidth={2} strokeDasharray="5 4" fill="none" connectNulls
                dot={poucosPontos ? { r: 3, fill: '#fff', stroke: PSGC_COLORS.espresso, strokeWidth: 1.5 } : false}
                activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
          {saldoEstavel && (
            <p style={{ color: PSGC_COLORS.espresso, opacity: 0.55, fontSize: 11, marginTop: 6, marginBottom: 0 }}>
              Saldo estável no período — sem variação de um dia para o outro.
            </p>
          )}
          </>
        )}
      </div>

      <div style={{ background: '#fff', borderRadius: PSGC_RADIUS.lg, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <p style={{ color: PSGC_COLORS.espresso, fontWeight: 700, fontSize: 14, margin: 0 }}>
            Movimentações
          </p>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span><span style={{ color: ENTRADA }}>●</span> Entradas</span>
            <span><span style={{ color: SAIDA }}>●</span> Saídas</span>
            <span><span style={{ color: TRANSF_IN }}>●</span> Transf. entrada</span>
            <span><span style={{ color: TRANSF_OUT }}>●</span> Transf. saída</span>
          </div>
        </div>

        {diasComMov.length === 0 ? (
          <div style={{ padding: '8px 0 4px' }}>
            <p style={{ color: PSGC_COLORS.espresso, opacity: 0.6, fontSize: 13, lineHeight: 1.5, marginTop: 0 }}>
              Nenhuma movimentação no período. Registre uma receita ou despesa para começar a ver o fluxo aqui.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button onClick={() => router.push('/dashboard/financeiro/nova-receita')}
                style={{ padding: '9px 16px', borderRadius: PSGC_RADIUS.md, border: 'none', background: PSGC_COLORS.dourado, color: PSGC_COLORS.espresso, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                + Lançar receita
              </button>
              <button onClick={() => router.push('/dashboard/financeiro/nova-despesa')}
                style={{ padding: '9px 16px', borderRadius: PSGC_RADIUS.md, border: `1px solid ${PSGC_COLORS.espresso}`, background: 'transparent', color: PSGC_COLORS.espresso, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                − Lançar despesa
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="fc-table-wrap" style={{ overflowX: 'auto', marginTop: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                <thead style={{ position: 'sticky', top: 0, background: PSGC_COLORS.offWhite, zIndex: 5 }}>
                  <tr>
                    <th style={th}>Data<AjudaCampo chave="ge.fluxo_caixa.col.data" rota={ROTA_AJUDA} /></th>
                    <th style={{ ...th, textAlign: 'right' }}>Entradas<AjudaCampo chave="ge.fluxo_caixa.col.entradas" rota={ROTA_AJUDA} /></th>
                    <th style={{ ...th, textAlign: 'right' }}>Saídas<AjudaCampo chave="ge.fluxo_caixa.col.saidas" rota={ROTA_AJUDA} /></th>
                    <th style={{ ...th, textAlign: 'right' }}>Transf. ↓<AjudaCampo chave="ge.fluxo_caixa.col.transf_entrada" rota={ROTA_AJUDA} /></th>
                    <th style={{ ...th, textAlign: 'right' }}>Transf. ↑<AjudaCampo chave="ge.fluxo_caixa.col.transf_saida" rota={ROTA_AJUDA} /></th>
                    <th style={{ ...th, textAlign: 'right' }}>Movimento<AjudaCampo chave="ge.fluxo_caixa.col.movimento" rota={ROTA_AJUDA} /></th>
                    <th style={{ ...th, textAlign: 'right' }}>Saldo no dia<AjudaCampo chave="ge.fluxo_caixa.col.saldo" rota={ROTA_AJUDA} /></th>
                  </tr>
                </thead>
                <tbody>
                  {diasComMov.map((d) => {
                    const ehHoje = d.data === HOJE
                    const futuro = !!d.eh_futuro
                    const ent = entradaDia(d)
                    const sai = saidaDia(d)
                    const movCor = d.movimento_dia > 0 ? ENTRADA : d.movimento_dia < 0 ? SAIDA : 'rgba(61,35,20,0.5)'
                    const movPrefixo = d.movimento_dia > 0 ? '+' : d.movimento_dia < 0 ? '−' : ''
                    return (
                      <tr key={d.data} style={{ borderTop: '1px solid #f0ebe4', background: ehHoje ? '#FEF3C7' : 'transparent', fontStyle: futuro ? 'italic' : 'normal' }}>
                        <td style={{ ...td, fontWeight: ehHoje ? 700 : 600, color: PSGC_COLORS.espresso }}>
                          {d.data.slice(8, 10)}/{d.data.slice(5, 7)}{ehHoje && ' (hoje)'}
                          {futuro && <span style={{ marginLeft: 6, fontSize: 9, fontStyle: 'normal', fontWeight: 700, color: PSGC_COLORS.dourado, border: `1px solid ${PSGC_COLORS.dourado}`, borderRadius: 4, padding: '1px 4px', verticalAlign: 'middle' }}>previsto</span>}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: ent > 0 ? ENTRADA : 'rgba(61,35,20,0.45)' }}>
                          {ent > 0 ? `+${brl(ent)}` : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: sai > 0 ? SAIDA : 'rgba(61,35,20,0.45)' }}>
                          {sai > 0 ? `−${brl(sai)}` : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: d.transferencias_entrada > 0 ? TRANSF_IN : 'rgba(61,35,20,0.45)' }}>
                          {d.transferencias_entrada > 0 ? `+${brl(d.transferencias_entrada)}` : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: d.transferencias_saida > 0 ? TRANSF_OUT : 'rgba(61,35,20,0.45)' }}>
                          {d.transferencias_saida > 0 ? `−${brl(d.transferencias_saida)}` : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: movCor, fontWeight: 600 }}>
                          {d.movimento_dia !== 0 ? `${movPrefixo}${brl(Math.abs(d.movimento_dia))}` : brl(0)}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: PSGC_COLORS.espresso, fontWeight: 700 }}>
                          {brl(d.saldo_final)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: PSGC_COLORS.offWhite, borderTop: `2px solid ${PSGC_COLORS.espresso}` }}>
                    <td style={{ ...td, fontWeight: 700, color: PSGC_COLORS.espresso }}>Total no período</td>
                    <td style={{ ...td, textAlign: 'right', color: ENTRADA, fontWeight: 700 }}>
                      +{brl((dados?.total_recebimentos ?? 0) + previstoEntrar)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: SAIDA, fontWeight: 700 }}>
                      −{brl((dados?.total_pagamentos ?? 0) + previstoSair)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: TRANSF_IN, fontWeight: 700 }}>
                      {totalTransfEntrada > 0 ? `+${brl(totalTransfEntrada)}` : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: TRANSF_OUT, fontWeight: 700 }}>
                      {totalTransfSaida > 0 ? `−${brl(totalTransfSaida)}` : '—'}
                    </td>
                    <td style={{
                      ...td, textAlign: 'right', fontWeight: 700,
                      color: (dados?.movimento_liquido ?? 0) > 0 ? ENTRADA : (dados?.movimento_liquido ?? 0) < 0 ? SAIDA : 'rgba(61,35,20,0.5)',
                    }}>
                      {(dados?.movimento_liquido ?? 0) > 0 ? '+' : (dados?.movimento_liquido ?? 0) < 0 ? '−' : ''}
                      {brl(Math.abs(dados?.movimento_liquido ?? 0))}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: PSGC_COLORS.espresso, fontWeight: 800 }}>
                      {brl(dados?.saldo_final ?? 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="fc-cards">
              {diasComMov.map((d) => {
                const ehHoje = d.data === HOJE
                const futuro = !!d.eh_futuro
                const ent = entradaDia(d)
                const sai = saidaDia(d)
                const movCor = d.movimento_dia > 0 ? ENTRADA : d.movimento_dia < 0 ? SAIDA : 'rgba(61,35,20,0.5)'
                const movPrefixo = d.movimento_dia > 0 ? '+' : d.movimento_dia < 0 ? '−' : ''
                const temTransf = d.transferencias_entrada > 0 || d.transferencias_saida > 0
                return (
                  <div key={d.data} style={{
                    border: futuro ? `1px dashed ${PSGC_COLORS.dourado}` : '1px solid #f0ebe4',
                    borderRadius: PSGC_RADIUS.md,
                    padding: '10px 12px',
                    marginBottom: 8,
                    background: ehHoje ? '#FEF3C7' : '#fff',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, color: PSGC_COLORS.espresso }}>
                        {d.data.slice(8, 10)}/{d.data.slice(5, 7)}{ehHoje && ' (hoje)'}
                        {futuro && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: PSGC_COLORS.dourado, border: `1px solid ${PSGC_COLORS.dourado}`, borderRadius: 4, padding: '1px 4px' }}>previsto</span>}
                      </span>
                      <span style={{ fontWeight: 700, color: PSGC_COLORS.espresso, fontVariantNumeric: 'tabular-nums' }}>
                        {brl(d.saldo_final)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, fontVariantNumeric: 'tabular-nums', flexWrap: 'wrap' }}>
                      {ent > 0 && <span style={{ color: ENTRADA }}>+{brl(ent)}</span>}
                      {sai > 0 && <span style={{ color: SAIDA }}>−{brl(sai)}</span>}
                      <span style={{ color: movCor, fontWeight: 600 }}>
                        Mov {movPrefixo}{brl(Math.abs(d.movimento_dia))}
                      </span>
                    </div>
                    {temTransf && (
                      <div style={{ fontSize: 11, marginTop: 4, color: 'rgba(61,35,20,0.65)' }}>
                        Transf:
                        {d.transferencias_entrada > 0 && <span style={{ color: TRANSF_IN, marginLeft: 4 }}>↓ {brl(d.transferencias_entrada)}</span>}
                        {d.transferencias_saida > 0 && <span style={{ color: TRANSF_OUT, marginLeft: 4 }}>↑ {brl(d.transferencias_saida)}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {temPrevisto && (
              <p style={{ color: 'rgba(61,35,20,0.6)', fontSize: 11, lineHeight: 1.5, marginTop: 10, marginBottom: 0 }}>
                Dias à frente de hoje (marcados <b>previsto</b>) são projeção pelos vencimentos dos
                títulos em aberto — só entram/saem de fato quando forem pagos.
                {(dados?.total_receber_vencido_aberto ?? 0) > 0 || (dados?.total_pagar_vencido_aberto ?? 0) > 0
                  ? ` Inclui ${brl(dados?.total_receber_vencido_aberto ?? 0)} a receber e ${brl(dados?.total_pagar_vencido_aberto ?? 0)} a pagar já vencidos e em aberto.`
                  : ''}
              </p>
            )}
          </>
        )}
      </div>

      <style>{`
        .fc-cards { display: none; }
        @media (max-width: 767px) {
          .fc-table-wrap { display: none; }
          .fc-cards { display: block; }
        }
      `}</style>
    </div>
  )
}

const ENTRADA = '#16A34A'
const SAIDA = '#DC2626'
const TRANSF_IN = '#3B82F6'
const TRANSF_OUT = '#6B7280'

// Tooltip do gráfico com o detalhamento do dia (entradas, saídas, movimento e saldo).
type TipPayload = { payload: { data: string; entrada: number; saida: number; movimento: number; saldoReal: number | null; saldoPrevisto: number | null; futuro: boolean } }
function FluxoTooltip({ active, payload }: { active?: boolean; payload?: TipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null
  const d = payload[0].payload
  const saldo = d.saldoReal ?? d.saldoPrevisto ?? 0
  const row = (label: string, valor: string, cor: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 12 }}>
      <span style={{ color: 'rgba(61,35,20,0.7)' }}>{label}</span>
      <span style={{ color: cor, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{valor}</span>
    </div>
  )
  return (
    <div style={{ background: '#fff', border: '1px solid #e7ddd2', borderRadius: 8, padding: '8px 10px', boxShadow: '0 4px 14px rgba(61,35,20,0.12)', minWidth: 150 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: PSGC_COLORS.espresso, marginBottom: 4 }}>
        {d.data}{d.futuro ? ' (previsto)' : ''}
      </div>
      {d.entrada > 0 && row('Entradas', `+${brl(d.entrada)}`, ENTRADA)}
      {d.saida > 0 && row('Saídas', `−${brl(d.saida)}`, SAIDA)}
      {row('Movimento', `${d.movimento > 0 ? '+' : d.movimento < 0 ? '−' : ''}${brl(Math.abs(d.movimento))}`, d.movimento > 0 ? ENTRADA : d.movimento < 0 ? SAIDA : 'rgba(61,35,20,0.6)')}
      <div style={{ borderTop: '1px solid #f0ebe4', marginTop: 4, paddingTop: 4 }}>
        {row(d.futuro ? 'Saldo previsto' : 'Saldo', brl(saldo), PSGC_COLORS.espresso)}
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 10px',
  borderRadius: 10,
  border: '1px solid rgba(61,35,20,0.25)',
  background: '#fff',
  color: '#3D2314',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const th: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'rgba(61,35,20,0.6)',
  padding: '8px 6px',
  textAlign: 'left',
  borderBottom: '1px solid #f0ebe4',
}

const td: React.CSSProperties = {
  padding: '8px 6px',
  fontSize: 13,
}

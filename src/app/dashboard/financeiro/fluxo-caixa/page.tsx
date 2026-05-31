'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import PSGCMetric from '@/components/psgc/PSGCMetric'
import { PSGC_COLORS, PSGC_RADIUS } from '@/lib/psgc-tokens'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'

type DiaFluxo = {
  data: string
  recebimentos: number
  pagamentos: number
  transferencias_entrada: number
  transferencias_saida: number
  movimento_dia: number
  saldo_final: number
}
type FluxoResp = {
  saldo_inicial: number
  saldo_final: number
  total_recebimentos: number
  total_pagamentos: number
  movimento_liquido: number
  dias: DiaFluxo[]
}

const brl = (v: number) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const hojeISO = () => new Date().toISOString().slice(0, 10)

export default function FluxoCaixaPage() {
  const { companyIds } = useCompanyIds()
  const empresaUnica = companyIds.length === 1 ? companyIds[0] : null

  const [periodo, setPeriodo] = useState<7 | 30 | 90>(30)
  const [dados, setDados] = useState<FluxoResp | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

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
      p_conta_id: null,
    })
    if (error) setErro('Não foi possível carregar o fluxo de caixa agora.')
    else setDados(data as FluxoResp)
    setCarregando(false)
  }, [empresaUnica, periodo])

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
  const chartData = dias.map((d) => ({
    data: d.data.slice(5),
    saldo: Number(d.saldo_final),
    ehHoje: d.data === hojeISO(),
  }))

  return (
    <div style={{ padding: 16, background: PSGC_COLORS.offWhite, minHeight: '100vh' }}>
      <h1 style={{ color: PSGC_COLORS.espresso, fontSize: 22, fontWeight: 800, marginBottom: 4 }}>
        Fluxo de Caixa
      </h1>
      <p style={{ color: PSGC_COLORS.espresso, opacity: 0.65, fontSize: 13, marginBottom: 16 }}>
        Visão diária do seu saldo · entradas e saídas
      </p>

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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 20 }}>
        <PSGCMetric label="Saldo Atual" valor={brl(saldoHoje)} destaque
          icon="wallet" cor={PSGC_COLORS.espresso} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <PSGCMetric label="Entradas no período" valor={brl(dados?.total_recebimentos ?? 0)}
            icon="arrow-up" cor={PSGC_COLORS.baixa} pequeno />
          <PSGCMetric label="Saídas no período" valor={brl(dados?.total_pagamentos ?? 0)}
            icon="arrow-down" cor={PSGC_COLORS.alta} pequeno />
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: PSGC_RADIUS.lg, padding: 16, marginBottom: 20 }}>
        <p style={{ color: PSGC_COLORS.espresso, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
          Saldo dia a dia
        </p>
        {carregando ? (
          <p style={{ color: PSGC_COLORS.espresso, opacity: 0.6, fontSize: 13 }}>Carregando…</p>
        ) : erro ? (
          <p style={{ color: PSGC_COLORS.alta, fontSize: 13 }}>{erro}</p>
        ) : (
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
                tickFormatter={(v) => `R$${Math.round(Number(v) / 1000)}k`} />
              <Tooltip formatter={(v) => brl(Number(v))} labelStyle={{ color: PSGC_COLORS.espresso }} />
              <ReferenceLine x={hojeISO().slice(5)} stroke={PSGC_COLORS.dourado} strokeDasharray="4 2" />
              <Area type="monotone" dataKey="saldo" stroke={PSGC_COLORS.espresso}
                strokeWidth={2} fill="url(#gradSaldo)" />
            </AreaChart>
          </ResponsiveContainer>
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
          <p style={{ color: PSGC_COLORS.espresso, opacity: 0.6, fontSize: 13, lineHeight: 1.5 }}>
            Nenhuma movimentação no período. Conforme você registrar pagamentos e
            recebimentos, eles aparecem aqui.
          </p>
        ) : (
          <>
            <div className="fc-table-wrap" style={{ overflowX: 'auto', marginTop: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                <thead style={{ position: 'sticky', top: 0, background: PSGC_COLORS.offWhite, zIndex: 5 }}>
                  <tr>
                    <th style={th}>Data</th>
                    <th style={{ ...th, textAlign: 'right' }}>Entradas</th>
                    <th style={{ ...th, textAlign: 'right' }}>Saídas</th>
                    <th style={{ ...th, textAlign: 'right' }}>Transf. ↓</th>
                    <th style={{ ...th, textAlign: 'right' }}>Transf. ↑</th>
                    <th style={{ ...th, textAlign: 'right' }}>Movimento</th>
                    <th style={{ ...th, textAlign: 'right' }}>Saldo no dia</th>
                  </tr>
                </thead>
                <tbody>
                  {diasComMov.map((d) => {
                    const ehHoje = d.data === HOJE
                    const movCor = d.movimento_dia > 0 ? ENTRADA : d.movimento_dia < 0 ? SAIDA : 'rgba(61,35,20,0.5)'
                    const movPrefixo = d.movimento_dia > 0 ? '+' : d.movimento_dia < 0 ? '−' : ''
                    return (
                      <tr key={d.data} style={{ borderTop: '1px solid #f0ebe4', background: ehHoje ? '#FEF3C7' : 'transparent' }}>
                        <td style={{ ...td, fontWeight: ehHoje ? 700 : 600, color: PSGC_COLORS.espresso }}>
                          {d.data.slice(8, 10)}/{d.data.slice(5, 7)}{ehHoje && ' (hoje)'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: d.recebimentos > 0 ? ENTRADA : 'rgba(61,35,20,0.45)' }}>
                          {d.recebimentos > 0 ? `+${brl(d.recebimentos)}` : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: d.pagamentos > 0 ? SAIDA : 'rgba(61,35,20,0.45)' }}>
                          {d.pagamentos > 0 ? `−${brl(d.pagamentos)}` : '—'}
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
                      +{brl(dados?.total_recebimentos ?? 0)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: SAIDA, fontWeight: 700 }}>
                      −{brl(dados?.total_pagamentos ?? 0)}
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
                const movCor = d.movimento_dia > 0 ? ENTRADA : d.movimento_dia < 0 ? SAIDA : 'rgba(61,35,20,0.5)'
                const movPrefixo = d.movimento_dia > 0 ? '+' : d.movimento_dia < 0 ? '−' : ''
                const temTransf = d.transferencias_entrada > 0 || d.transferencias_saida > 0
                return (
                  <div key={d.data} style={{
                    border: '1px solid #f0ebe4',
                    borderRadius: PSGC_RADIUS.md,
                    padding: '10px 12px',
                    marginBottom: 8,
                    background: ehHoje ? '#FEF3C7' : '#fff',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, color: PSGC_COLORS.espresso }}>
                        {d.data.slice(8, 10)}/{d.data.slice(5, 7)}{ehHoje && ' (hoje)'}
                      </span>
                      <span style={{ fontWeight: 700, color: PSGC_COLORS.espresso, fontVariantNumeric: 'tabular-nums' }}>
                        {brl(d.saldo_final)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, fontVariantNumeric: 'tabular-nums', flexWrap: 'wrap' }}>
                      {d.recebimentos > 0 && <span style={{ color: ENTRADA }}>+{brl(d.recebimentos)}</span>}
                      {d.pagamentos > 0 && <span style={{ color: SAIDA }}>−{brl(d.pagamentos)}</span>}
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

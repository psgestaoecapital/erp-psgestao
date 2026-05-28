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
  const diasComMov = dias.filter((d) => d.movimento_dia !== 0)
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
        <p style={{ color: PSGC_COLORS.espresso, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
          Movimentações
        </p>
        {diasComMov.length === 0 ? (
          <p style={{ color: PSGC_COLORS.espresso, opacity: 0.6, fontSize: 13, lineHeight: 1.5 }}>
            Nenhuma movimentação no período. Conforme você registrar pagamentos e
            recebimentos, eles aparecem aqui.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {diasComMov.map((d) => (
              <div key={d.data} style={{
                display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8,
                alignItems: 'center', fontSize: 13, paddingBottom: 8,
                borderBottom: '1px solid #f0ebe4',
              }}>
                <span style={{ color: PSGC_COLORS.espresso, fontWeight: 600 }}>
                  {d.data.slice(8, 10)}/{d.data.slice(5, 7)}
                </span>
                <span style={{ color: PSGC_COLORS.baixa }}>
                  {d.recebimentos > 0 ? `+${brl(d.recebimentos)}` : '—'}
                </span>
                <span style={{ color: PSGC_COLORS.alta }}>
                  {d.pagamentos > 0 ? `−${brl(d.pagamentos)}` : '—'}
                </span>
                <span style={{ color: PSGC_COLORS.espresso, fontWeight: 700, textAlign: 'right' }}>
                  {brl(d.saldo_final)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

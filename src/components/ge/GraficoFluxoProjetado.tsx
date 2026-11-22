'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { PSGC_COLORS } from '@/lib/psgc-tokens'

// Gráfico de evolução do caixa (gap PDCA GE /dashboard/gestao-empresarial, aud8 88/95):
// o hub mostrava só a coluna textual de fluxo + uma sparkline minúscula. Aqui vai um
// gráfico de área prominente da evolução do saldo acumulado — projeção (30 dias) ou
// realizado — consumindo a MESMA RPC já usada pelo hub (fn_gestao_empresarial_widget_fluxo_caixa),
// sem tocar no backend. Verde/vermelho é o uso reservado do design system p/ saldo +/−.

const ROTA_AJUDA = '/dashboard/gestao-empresarial'

interface SparkPoint {
  data: string
  saldo: number
}
interface KpiSec {
  label: string
  valor: number
  valor_formatado?: string
  critico?: boolean
}
interface WidgetData {
  modo?: 'projecao' | 'realizado' | 'empty'
  empty_state?: boolean
  titulo?: string
  subtitulo?: string
  aviso?: string
  kpi_principal?: { label: string; valor: number; valor_formatado?: string; positivo?: boolean }
  kpis_secundarios?: KpiSec[]
  sparkline?: SparkPoint[]
  rota_acao?: string
  cta_label?: string
}

function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function fmtDiaMes(iso: string): string {
  // iso = 'YYYY-MM-DD' — formata sem passar por Date (evita deslocamento de fuso).
  const [, m, d] = iso.split('-')
  if (!m || !d) return iso
  return `${d}/${m}`
}

export default function GraficoFluxoProjetado({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [data, setData] = useState<WidgetData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    ;(async () => {
      setLoading(true)
      const { data: result, error } = await supabase.rpc(
        'fn_gestao_empresarial_widget_fluxo_caixa',
        { p_company_id: companyId },
      )
      if (ignore) return
      if (error) {
        console.error('[GraficoFluxoProjetado] erro RPC:', error.message)
        setData(null)
      } else {
        setData(result as WidgetData)
      }
      setLoading(false)
    })()
    return () => {
      ignore = true
    }
  }, [companyId])

  const pontos = useMemo(() => {
    const sl = data?.sparkline ?? []
    return sl.map((p) => ({ rotulo: fmtDiaMes(p.data), saldo: Number(p.saldo) || 0 }))
  }, [data])

  if (loading) {
    return (
      <section
        aria-busy="true"
        style={{
          background: '#FFFFFF',
          border: `1px solid ${PSGC_COLORS.offWhiteDarker}`,
          borderRadius: 14,
          padding: 20,
          marginBottom: 24,
          minHeight: 260,
        }}
      />
    )
  }

  // Sem série suficiente para um gráfico → não renderiza (o hub já tem a coluna de fluxo).
  if (!data || data.empty_state || pontos.length < 2) return null

  const positivo = data.kpi_principal?.positivo !== false
  const corLinha = positivo ? PSGC_COLORS.baixa : PSGC_COLORS.alta
  const projecao = data.modo !== 'realizado'
  const titulo = projecao ? 'Evolução do caixa — projeção 30 dias' : 'Evolução do caixa — realizado'
  const diasNeg = data.kpis_secundarios?.find((k) => k.label === 'Dias Negativos')
  const temRiscoNegativo = projecao && diasNeg && Number(diasNeg.valor) > 0

  return (
    <section
      style={{
        background: '#FFFFFF',
        border: `1px solid ${PSGC_COLORS.offWhiteDarker}`,
        borderRadius: 14,
        padding: 20,
        marginBottom: 24,
        boxShadow: '0 1px 3px rgba(61,35,20,0.06)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 4,
        }}
      >
        <h2
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 18,
            fontWeight: 400,
            color: PSGC_COLORS.espresso,
            margin: 0,
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {titulo}
          <AjudaCampo chave="ge.hub.fluxo_projecao_grafico" rota={ROTA_AJUDA} />
        </h2>
        {data.kpi_principal && (
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: PSGC_COLORS.espressoLight,
              }}
            >
              {data.kpi_principal.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, color: corLinha }}>
              {data.kpi_principal.valor_formatado ?? fmtBRL(data.kpi_principal.valor)}
            </div>
          </div>
        )}
      </header>

      {data.subtitulo && (
        <p style={{ margin: '0 0 12px', fontSize: 13, color: PSGC_COLORS.espressoLight }}>
          {data.subtitulo}
        </p>
      )}

      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={pontos} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="gradFluxoGE" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={corLinha} stopOpacity={0.22} />
                <stop offset="100%" stopColor={corLinha} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={PSGC_COLORS.offWhiteDarker} vertical={false} />
            <XAxis
              dataKey="rotulo"
              tick={{ fontSize: 11, fill: PSGC_COLORS.espressoLight }}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={{ stroke: PSGC_COLORS.offWhiteDarker }}
            />
            <YAxis
              width={64}
              tick={{ fontSize: 11, fill: PSGC_COLORS.espressoLight }}
              tickFormatter={(v: number) => fmtBRL(v)}
              tickLine={false}
              axisLine={false}
            />
            <ReferenceLine y={0} stroke={PSGC_COLORS.alta} strokeDasharray="3 3" />
            <Tooltip
              formatter={(v) => [fmtBRL(Number(v)), 'Saldo acumulado'] as [string, string]}
              labelFormatter={(l) => `Dia ${String(l ?? '')}`}
              contentStyle={{
                borderRadius: 8,
                border: `1px solid ${PSGC_COLORS.offWhiteDarker}`,
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey="saldo"
              name="Saldo acumulado"
              stroke={corLinha}
              strokeWidth={2}
              fill="url(#gradFluxoGE)"
              dot={{ r: 2, fill: corLinha }}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {temRiscoNegativo && (
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 13,
            fontWeight: 600,
            color: PSGC_COLORS.alta,
          }}
        >
          ⚠ O caixa fica negativo em {Number(diasNeg?.valor)} dia(s) da projeção — antecipe
          recebimentos ou renegocie pagamentos.
        </p>
      )}
      {data.aviso && !temRiscoNegativo && (
        <p style={{ margin: '12px 0 0', fontSize: 13, color: PSGC_COLORS.espressoLight }}>
          {data.aviso}
        </p>
      )}

      {data.rota_acao && (
        <button
          type="button"
          onClick={() => router.push(data.rota_acao as string)}
          style={{
            marginTop: 14,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: PSGC_COLORS.dourado,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {data.cta_label ?? 'Ver projeção completa →'}
        </button>
      )}
    </section>
  )
}

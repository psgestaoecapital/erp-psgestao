'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, TrendingDown, TrendingUp, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  PSGC_COLORS,
  PSGC_RADIUS,
  PSGC_BORDER_PREMIUM,
  PSGC_SHADOW_PREMIUM,
  PSGC_SPACING_PREMIUM,
  typoToStyle,
} from '@/lib/psgc-tokens'

interface KpiPrincipal {
  label: string
  valor: number
  valor_formatado: string
  positivo: boolean
}

interface KpiSecundario {
  label: string
  valor: number
  valor_formatado?: string
  critico?: boolean
}

interface SparkPoint {
  data: string
  saldo: number
}

interface WidgetData {
  empty_state: boolean
  titulo?: string
  subtitulo?: string
  mensagem?: string
  sub_mensagem?: string
  kpi_principal?: KpiPrincipal
  kpis_secundarios?: KpiSecundario[]
  sparkline?: SparkPoint[]
  rota_acao: string
  cta_label?: string
}

// Verde/vermelho permitidos aqui: kpi_principal sinaliza performance financeira
// (saldo positivo/negativo) — exatamente o uso reservado pelo design system.
function corSaldo(positivo: boolean) {
  return positivo ? PSGC_COLORS.baixa : PSGC_COLORS.alta
}

function Sparkline({ pontos, positivo }: { pontos: SparkPoint[]; positivo: boolean }) {
  if (pontos.length < 2) return null
  const w = 100
  const h = 28
  const ys = pontos.map((p) => p.saldo)
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  const range = max - min || 1
  const stepX = w / (pontos.length - 1)
  const norm = (v: number) => h - ((v - min) / range) * h
  const path = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(2)} ${norm(p.saldo).toFixed(2)}`).join(' ')
  const area = `${path} L ${w} ${h} L 0 ${h} Z`
  const stroke = positivo ? PSGC_COLORS.baixa : PSGC_COLORS.dourado
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={h} aria-hidden="true">
      <path d={area} fill={stroke} fillOpacity={0.08} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function FluxoCaixaWidget({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [data, setData] = useState<WidgetData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      setLoading(true)
      const { data: result, error } = await supabase.rpc(
        'fn_gestao_empresarial_widget_fluxo_caixa',
        { p_company_id: companyId },
      )
      if (ignore) return
      if (error) {
        console.error('[FluxoCaixaWidget] erro RPC:', error.message)
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

  const containerStyle: React.CSSProperties = {
    backgroundColor: 'white',
    border: PSGC_BORDER_PREMIUM.subtle,
    borderRadius: PSGC_RADIUS.xl,
    padding: PSGC_SPACING_PREMIUM.cardPadding,
    boxShadow: hover ? PSGC_SHADOW_PREMIUM.cardHover : PSGC_SHADOW_PREMIUM.card,
    cursor: 'pointer',
    transition: 'box-shadow 0.15s, border-color 0.15s, transform 0.15s',
    transform: hover ? 'translateY(-1px)' : 'translateY(0)',
    borderColor: hover ? PSGC_COLORS.dourado : PSGC_COLORS.offWhiteDarker,
  }

  if (loading) {
    return (
      <div style={{ ...containerStyle, cursor: 'default', minHeight: 220 }}>
        <div style={{ fontSize: 13, color: PSGC_COLORS.espressoLight }}>Carregando fluxo de caixa…</div>
      </div>
    )
  }

  if (!data) return null

  const go = () => router.push(data.rota_acao)

  return (
    <div
      onClick={go}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          go()
        }
      }}
      role="link"
      tabIndex={0}
      style={containerStyle}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Banknote size={28} color={PSGC_COLORS.dourado} aria-hidden />
        <div>
          <h3
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 20,
              fontWeight: 500,
              color: PSGC_COLORS.espresso,
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            {data.titulo ?? 'Fluxo de Caixa'}
          </h3>
          {!data.empty_state && data.subtitulo && (
            <p style={{ ...typoToStyle('caption'), color: PSGC_COLORS.espressoLight, margin: '2px 0 0' }}>
              {data.subtitulo}
            </p>
          )}
        </div>
      </div>

      {/* Empty state */}
      {data.empty_state && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ ...typoToStyle('bodyPremium'), color: PSGC_COLORS.espresso, margin: 0 }}>
            {data.mensagem}
          </p>
          {data.sub_mensagem && (
            <p style={{ ...typoToStyle('caption'), color: PSGC_COLORS.espressoLight, margin: '6px 0 0' }}>
              {data.sub_mensagem}
            </p>
          )}
        </div>
      )}

      {/* KPI principal + KPIs secundários + sparkline */}
      {!data.empty_state && data.kpi_principal && (
        <>
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                ...typoToStyle('numberHero'),
                color: corSaldo(data.kpi_principal.positivo),
                lineHeight: 1.05,
              }}
            >
              {data.kpi_principal.valor_formatado}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              {data.kpi_principal.positivo ? (
                <TrendingUp size={14} color={PSGC_COLORS.baixa} aria-hidden />
              ) : (
                <TrendingDown size={14} color={PSGC_COLORS.alta} aria-hidden />
              )}
              <span style={{ ...typoToStyle('caption'), color: PSGC_COLORS.espressoLight }}>
                {data.kpi_principal.label}
              </span>
            </div>
          </div>

          {data.kpis_secundarios && data.kpis_secundarios.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${data.kpis_secundarios.length}, 1fr)`,
                gap: 12,
                marginBottom: 16,
              }}
            >
              {data.kpis_secundarios.map((kpi, idx) => {
                const critico = !!kpi.critico
                return (
                  <div
                    key={`${kpi.label}-${idx}`}
                    style={{
                      backgroundColor: 'rgba(61, 35, 20, 0.04)',
                      borderRadius: PSGC_RADIUS.md,
                      padding: 12,
                    }}
                  >
                    <div style={{ ...typoToStyle('label'), color: PSGC_COLORS.espressoLight }}>{kpi.label}</div>
                    <div
                      style={{
                        ...typoToStyle('numberSmall'),
                        color: critico ? PSGC_COLORS.alta : PSGC_COLORS.espresso,
                        marginTop: 4,
                      }}
                    >
                      {kpi.valor_formatado ?? kpi.valor}
                      {critico && <span style={{ marginLeft: 6 }}>🔴</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {data.sparkline && data.sparkline.length >= 2 && (
            <div style={{ marginBottom: 16 }}>
              <Sparkline pontos={data.sparkline} positivo={data.kpi_principal.positivo} />
            </div>
          )}
        </>
      )}

      {/* CTA */}
      <div
        style={{
          ...typoToStyle('caption'),
          color: PSGC_COLORS.dourado,
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {data.cta_label ?? 'Ver fluxo completo'}
        <ArrowRight size={14} aria-hidden />
      </div>
    </div>
  )
}

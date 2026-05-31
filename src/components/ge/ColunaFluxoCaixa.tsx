'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Widget {
  empty_state: boolean
  titulo?: string
  subtitulo?: string
  mensagem?: string
  sub_mensagem?: string
  kpi_principal?: { label: string; valor: number; valor_formatado: string; positivo: boolean }
  kpis_secundarios?: Array<{ label: string; valor: number; valor_formatado?: string; critico?: boolean }>
  sparkline?: Array<{ data: string; saldo: number }>
  rota_acao: string
  cta_label?: string
  sem_plano?: boolean
}

export default function ColunaFluxoCaixa({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [data, setData] = useState<Widget | null>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: result } = await supabase.rpc('fn_gestao_empresarial_widget_fluxo_caixa', { p_company_id: companyId })
      if (!ignore) setData(result as Widget)
    })()
    return () => { ignore = true }
  }, [companyId])

  if (!data || data.sem_plano) return null

  const go = () => data.rota_acao && router.push(data.rota_acao)
  const corHero = data.kpi_principal?.positivo ? '#3B6D11' : '#A32D2D'

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '18px 20px', cursor: 'pointer' }} onClick={go} role="link" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
          Fluxo de Caixa
        </span>
        {!data.empty_state && data.subtitulo && (
          <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)' }}>{data.subtitulo}</span>
        )}
      </div>

      {data.empty_state && (
        <div style={{ paddingBottom: 6 }}>
          <p style={{ margin: 0, fontSize: 14, color: '#3D2314' }}>{data.mensagem}</p>
          {data.sub_mensagem && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'rgba(61,35,20,0.6)' }}>{data.sub_mensagem}</p>
          )}
        </div>
      )}

      {!data.empty_state && data.kpi_principal && (
        <>
          <div style={{ fontSize: 24, fontWeight: 700, color: corHero, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, marginBottom: 4 }}>
            {data.kpi_principal.valor_formatado}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginBottom: 14 }}>{data.kpi_principal.label}</div>

          {data.kpis_secundarios && data.kpis_secundarios.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.kpis_secundarios.length}, 1fr)`, gap: 8, marginBottom: 12 }}>
              {data.kpis_secundarios.map((k, i) => (
                <div key={`${k.label}-${i}`} style={{ background: 'rgba(61,35,20,0.04)', borderRadius: 6, padding: 8 }}>
                  <div style={{ fontSize: 9, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>{k.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: k.critico ? '#A32D2D' : '#3D2314', fontVariantNumeric: 'tabular-nums' }}>
                    {k.valor_formatado ?? k.valor}
                    {k.critico && <span style={{ marginLeft: 4 }}>🔴</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.sparkline && data.sparkline.length >= 2 && <Sparkline pontos={data.sparkline} positivo={data.kpi_principal.positivo} />}
        </>
      )}

      <div style={{ marginTop: 12, fontSize: 12, color: '#C8941A', fontWeight: 600 }}>
        {data.cta_label ?? 'Ver fluxo completo →'}
      </div>
    </div>
  )
}

function Sparkline({ pontos, positivo }: { pontos: Array<{ data: string; saldo: number }>; positivo: boolean }) {
  if (pontos.length < 2) return null
  const w = 100
  const h = 26
  const ys = pontos.map((p) => p.saldo)
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  const range = max - min || 1
  const stepX = w / (pontos.length - 1)
  const norm = (v: number) => h - ((v - min) / range) * h
  const path = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(2)} ${norm(p.saldo).toFixed(2)}`).join(' ')
  const stroke = positivo ? '#3B6D11' : '#C8941A'
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={h} aria-hidden>
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill={stroke} fillOpacity={0.08} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

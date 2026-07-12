'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface BreakdownItem { categoria: string; valor: number }

interface Kpi {
  valor: number
  qtd?: number
  restante_mes?: number
  dias_max_atraso?: number
  limite_credito?: number
  disponivel_total?: number
  qtd_contas?: number
  breakdown?: BreakdownItem[]
}

interface Data {
  sem_plano?: boolean
  kpi_receber_vencido?: Kpi
  kpi_vencem_hoje?: Kpi
  kpi_vencer_mes?: Kpi
  kpi_pagar_vencido?: Kpi
  kpi_saldo_total?: Kpi
}

function fmt(n: number | undefined | null): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function KpisDashboard({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  useEffect(() => {
    let ignore = false
    ;(async () => {
      setLoading(true)
      const { data: result } = await supabase.rpc('fn_ge_kpis_dashboard', { p_company_id: companyId })
      if (!ignore) {
        setData(result as Data)
        setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [companyId])

  function toggle(key: string) {
    const ns = new Set(expandidos)
    if (ns.has(key)) ns.delete(key); else ns.add(key)
    setExpandidos(ns)
  }

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 40,
    alignItems: 'flex-start',
  }

  if (loading) {
    return (
      <div style={gridStyle}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ background: 'rgba(61,35,20,0.05)', border: '0.5px solid rgba(61,35,20,0.08)', borderRadius: 8, height: 88 }} />
        ))}
      </div>
    )
  }
  if (!data || data.sem_plano) return null

  const recVen = data.kpi_receber_vencido
  const venHoje = data.kpi_vencem_hoje
  const venMes = data.kpi_vencer_mes
  const pagVen = data.kpi_pagar_vencido
  const saldo = data.kpi_saldo_total

  return (
    <div style={gridStyle}>
      <KpiCard chave="receber_vencido" cor="#A32D2D" label="A receber vencido" valor={recVen?.valor ?? 0}
        sublabel={`${recVen?.qtd ?? 0} contas em atraso`}
        breakdown={recVen?.breakdown}
        expandido={expandidos.has('receber_vencido')}
        onToggle={() => toggle('receber_vencido')}
        onClick={() => router.push('/dashboard/contas-receber?filtro=vencido')} />
      <KpiCard chave="vencem_hoje" cor="#BA7517" label="Vencem hoje" valor={venHoje?.valor ?? 0}
        sublabel={`Restante: R$ ${fmt(venHoje?.restante_mes)}`}
        breakdown={venHoje?.breakdown}
        expandido={expandidos.has('vencem_hoje')}
        onToggle={() => toggle('vencem_hoje')}
        onClick={() => router.push('/dashboard/contas-receber?filtro=hoje')} />
      <KpiCard chave="vencer_mes" cor="rgba(61,35,20,0.3)" label="A vencer este mês" valor={venMes?.valor ?? 0}
        sublabel={`${venMes?.qtd ?? 0} lançamentos`}
        breakdown={venMes?.breakdown}
        expandido={expandidos.has('vencer_mes')}
        onToggle={() => toggle('vencer_mes')}
        onClick={() => router.push('/dashboard/contas-receber?filtro=mes')} />
      <KpiCard chave="pagar_vencido" cor="#A32D2D" label="A pagar vencido" valor={pagVen?.valor ?? 0}
        sublabel={(pagVen?.dias_max_atraso ?? 0) > 0 ? `Atrasado ${pagVen?.dias_max_atraso} dias` : `${pagVen?.qtd ?? 0} contas`}
        breakdown={pagVen?.breakdown}
        expandido={expandidos.has('pagar_vencido')}
        onToggle={() => toggle('pagar_vencido')}
        onClick={() => router.push('/dashboard/contas-pagar?filtro=vencido')} />
      <KpiCard chave="saldo_total" cor={(saldo?.valor ?? 0) < 0 ? '#A32D2D' : '#3B6D11'} label="Saldo total" valor={saldo?.valor ?? 0}
        sublabel={`${saldo?.qtd_contas ?? 0} contas`}
        breakdown={saldo?.breakdown}
        expandido={expandidos.has('saldo_total')}
        onToggle={() => toggle('saldo_total')}
        onClick={() => router.push('/dashboard/contas-bancarias')} />
    </div>
  )
}

function KpiCard({ chave, cor, label, valor, sublabel, breakdown, expandido, onToggle, onClick }: {
  chave: string
  cor: string
  label: string
  valor: number
  sublabel: string
  breakdown?: BreakdownItem[]
  expandido: boolean
  onToggle: () => void
  onClick: () => void
}) {
  const corValor = cor === '#3B6D11' || cor === '#A32D2D' ? cor : '#3D2314'
  const temBreakdown = !!breakdown && breakdown.length > 0
  const top3 = (breakdown ?? []).slice(0, 3)
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '0.5px solid rgba(61,35,20,0.12)',
        borderLeft: `3px solid ${cor}`,
        borderRadius: 8,
        padding: '14px 16px',
        textAlign: 'left',
      }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label} · abrir lista`}
        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', width: '100%' }}
      >
        <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: corValor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>R$ {fmt(valor)}</div>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 4 }}>{sublabel}</div>
      </button>

      {temBreakdown && (
        <>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expandido}
            aria-controls={`kpi-breakdown-${chave}`}
            style={{ background: 'transparent', color: 'rgba(61,35,20,0.6)', border: 'none', padding: '6px 0 0', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {expandido ? '▲ ocultar detalhes' : '▼ ver detalhes'}
          </button>
          {expandido && (
            <ul id={`kpi-breakdown-${chave}`} style={{ listStyle: 'none', margin: '6px 0 0', padding: '6px 0 0', borderTop: '0.5px solid rgba(61,35,20,0.08)' }}>
              {top3.map((item, i) => (
                <li key={`${item.categoria}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0', fontSize: 11 }}>
                  <span style={{ color: '#3D2314', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{item.categoria}</span>
                  <span style={{ color: corValor, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(item.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

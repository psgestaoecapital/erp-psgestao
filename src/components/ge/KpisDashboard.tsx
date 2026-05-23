'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Kpi {
  valor: number
  qtd?: number
  restante_mes?: number
  dias_max_atraso?: number
  limite_credito?: number
  disponivel_total?: number
  qtd_contas?: number
  breakdown?: Array<{ categoria: string; valor: number }>
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

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 40,
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
      <KpiCard cor="#A32D2D" label="A receber vencido" valor={recVen?.valor ?? 0}
        sublabel={`${recVen?.qtd ?? 0} contas em atraso`}
        onClick={() => router.push('/dashboard/contas-receber?filtro=vencido')} />
      <KpiCard cor="#BA7517" label="Vencem hoje" valor={venHoje?.valor ?? 0}
        sublabel={`Restante: R$ ${fmt(venHoje?.restante_mes)}`}
        onClick={() => router.push('/dashboard/contas-receber?filtro=hoje')} />
      <KpiCard cor="rgba(61,35,20,0.3)" label="A vencer este mês" valor={venMes?.valor ?? 0}
        sublabel={`${venMes?.qtd ?? 0} lançamentos`}
        onClick={() => router.push('/dashboard/contas-receber?filtro=mes')} />
      <KpiCard cor="#A32D2D" label="A pagar vencido" valor={pagVen?.valor ?? 0}
        sublabel={(pagVen?.dias_max_atraso ?? 0) > 0 ? `Atrasado ${pagVen?.dias_max_atraso} dias` : `${pagVen?.qtd ?? 0} contas`}
        onClick={() => router.push('/dashboard/contas-pagar?filtro=vencido')} />
      <KpiCard cor="#3B6D11" label="Saldo total" valor={saldo?.valor ?? 0}
        sublabel={`${saldo?.qtd_contas ?? 0} contas`}
        onClick={() => router.push('/dashboard/contas-bancarias')} />
    </div>
  )
}

function KpiCard({ cor, label, valor, sublabel, onClick }: { cor: string; label: string; valor: number; sublabel: string; onClick: () => void }) {
  const corValor = cor === '#3B6D11' || cor === '#A32D2D' ? cor : '#3D2314'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: '#FFFFFF',
        border: '0.5px solid rgba(61,35,20,0.12)',
        borderLeft: `3px solid ${cor}`,
        borderRadius: 8,
        padding: '14px 16px',
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
      }}
    >
      <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: corValor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>R$ {fmt(valor)}</div>
      <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 4 }}>{sublabel}</div>
    </button>
  )
}

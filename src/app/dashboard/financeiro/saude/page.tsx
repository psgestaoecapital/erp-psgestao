'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

interface SaudeData {
  score: number
  classificacao: string
  cor_semaforo: 'verde' | 'amarelo' | 'vermelho'
  meses_caixa: number
  saldo_total: number
  inadimplencia_pct: number
  inadimplencia_qtd: number
  inadimplencia_valor: number
  concentracao_pct: number
  top_cliente_nome: string | null
  frases: string[]
  sem_plano?: boolean
}

const COR = {
  verde: { fg: '#3B6D11', bg: '#EAF3DE' },
  amarelo: { fg: '#BA7517', bg: '#FAEEDA' },
  vermelho: { fg: '#A32D2D', bg: '#FCEBEB' },
}

function fmt(n: number | undefined | null): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function SaudeFinanceiraPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [data, setData] = useState<SaudeData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) { setLoading(false); return }
    ;(async () => {
      setLoading(true)
      const { data: result } = await supabase.rpc('fn_ge_saude_financeira', { p_company_id: empresaUnica })
      if (!ignore) { setData(result as SaudeData); setLoading(false) }
    })()
    return () => { ignore = true }
  }, [empresaUnica])

  if (!empresaUnica) {
    return <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh', color: '#3D2314' }}>
      Selecione uma empresa para ver a saúde financeira.
    </div>
  }
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh', color: 'rgba(61,35,20,0.65)' }}>Carregando…</div>
  }
  if (!data || data.sem_plano) {
    return <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh', color: '#3D2314' }}>
      Plano Gestão Empresarial Pró necessário.
    </div>
  }

  const tone = COR[data.cor_semaforo] ?? COR.amarelo

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '32px 24px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/gestao-empresarial')} style={{ background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.55)', fontSize: 12, cursor: 'pointer', marginBottom: 16, padding: 0 }}>
          ← Painel Gestão Empresarial
        </button>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>Saúde Financeira</h1>
        <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, marginBottom: 28 }}>Termômetro consolidado e drill-down dos indicadores</p>

        <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '24px 28px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ width: 112, height: 112, borderRadius: '50%', background: tone.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', flexShrink: 0 }}>
            <div style={{ fontSize: 32, fontWeight: 600, color: tone.fg, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{data.score}</div>
            <div style={{ fontSize: 10, color: tone.fg, marginTop: 2 }}>/100</div>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 6 }}>Classificação geral</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: tone.fg, marginBottom: 12 }}>{data.classificacao}</div>
            {(data.frases ?? []).filter(Boolean).map((f, i) => (
              <div key={i} style={{ fontSize: 13, color: 'rgba(61,35,20,0.85)', marginBottom: 4 }}>· {f}</div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
          <Indicador label="Saldo em caixa" valor={`R$ ${fmt(data.saldo_total)}`} cor="#3B6D11" />
          <Indicador label="Meses de caixa" valor={`${data.meses_caixa.toLocaleString('pt-BR')} m`} cor={data.meses_caixa >= 3 ? '#3B6D11' : '#A32D2D'} />
          <Indicador label="Inadimplência" valor={`${data.inadimplencia_qtd} · R$ ${fmt(data.inadimplencia_valor)}`} cor={data.inadimplencia_qtd > 0 ? '#A32D2D' : '#3B6D11'} sublabel={`${data.inadimplencia_pct}% da carteira`} />
          <Indicador label="Concentração receita" valor={data.top_cliente_nome ? `${data.concentracao_pct}%` : '—'} cor={data.concentracao_pct >= 50 ? '#A32D2D' : data.concentracao_pct >= 30 ? '#BA7517' : '#3B6D11'} sublabel={data.top_cliente_nome ?? 'sem dados ainda'} />
        </div>

        <button onClick={() => router.push('/dashboard/consultor-ia?contexto=saude')} style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '12px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Falar com Consultor IA
        </button>
      </div>
    </div>
  )
}

function Indicador({ label, valor, cor, sublabel }: { label: string; valor: string; cor: string; sublabel?: string }) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderLeft: `3px solid ${cor}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: cor, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {sublabel && <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 4 }}>{sublabel}</div>}
    </div>
  )
}

// src/app/dashboard/compliance/epi/page.tsx
// Dashboard EPI: KPIs + graficos (recharts) consumindo v_epi_dashboard.

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const C = {
  espresso: '#3D2314',
  espressoLt: '#5D4534',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#16a34a',
  yellow: '#eab308',
  red: '#dc2626',
}

interface DashRow {
  company_id: string
  total_funcionarios: number | null
  total_epis_catalogo: number | null
  total_fichas_em_uso: number | null
  movimentacoes_30d: number | null
  alertas_ativos: number | null
  alertas_criticos: number | null
  estoque_critico: number | null
  trocas_atrasadas: number | null
  por_categoria: Array<{ categoria: string; total: number }> | null
  movimentacoes_6m: Array<{ mes: string; total: number }> | null
}

const PIE_COLORS = ['#3D2314', '#C8941A', '#16a34a', '#5D4534', '#eab308', '#9F6E1F', '#1f2937', '#a16207']

export default function EpiDashboardPage() {
  const { companyIds } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])

  const [dados, setDados] = useState<DashRow[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyIdsKey) return
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey.split(',').filter(Boolean)
      const { data, error } = await supabase
        .from('v_epi_dashboard')
        .select('*')
        .in('company_id', ids)
      if (error) throw error
      setDados((data || []) as DashRow[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar dashboard')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  // Agregar valores de todas as empresas selecionadas
  const agregado = useMemo(() => {
    const sum = (k: keyof DashRow) => dados.reduce((acc, d) => acc + (Number((d as any)[k]) || 0), 0)
    const porCategoria: Record<string, number> = {}
    const movimentacoesMes: Record<string, number> = {}
    for (const d of dados) {
      for (const c of d.por_categoria || []) porCategoria[c.categoria] = (porCategoria[c.categoria] || 0) + (c.total || 0)
      for (const m of d.movimentacoes_6m || []) movimentacoesMes[m.mes] = (movimentacoesMes[m.mes] || 0) + (m.total || 0)
    }
    const piedata = Object.entries(porCategoria).map(([name, value]) => ({ name, value }))
    const bardata = Object.entries(movimentacoesMes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, total]) => ({ mes, total }))
    return {
      total_funcionarios: sum('total_funcionarios'),
      total_epis_catalogo: sum('total_epis_catalogo'),
      total_fichas_em_uso: sum('total_fichas_em_uso'),
      movimentacoes_30d: sum('movimentacoes_30d'),
      alertas_ativos: sum('alertas_ativos'),
      alertas_criticos: sum('alertas_criticos'),
      estoque_critico: sum('estoque_critico'),
      trocas_atrasadas: sum('trocas_atrasadas'),
      piedata,
      bardata,
    }
  }, [dados])

  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {/* Header */}
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>Compliance · EPI</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Gestão de EPI</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>NR-6 · Lei 14.063/2020 · eSocial</p>
          </div>
          <Link href="/dashboard/compliance" style={btnSec}>← Compliance</Link>
        </header>

        {erro && <Erro msg={erro} />}

        {/* Atalhos rapidos */}
        <section style={{ marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <BotaoNav href="/dashboard/compliance/epi/catalogo" titulo="Catálogo" icone="📋" />
            <BotaoNav href="/dashboard/compliance/epi/estoque" titulo="Estoque" icone="📦" />
            <BotaoNav href="/dashboard/compliance/epi/fichas" titulo="Fichas" icone="📄" />
            <BotaoNav href="/dashboard/compliance/epi/alertas" titulo="Alertas" icone="⚠️" badge={agregado.alertas_ativos} />
          </div>
        </section>

        {/* KPIs */}
        <section style={{ marginBottom: 24 }}>
          <h2 style={subTitulo}>Visão geral</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Kpi label="Total funcionários" valor={agregado.total_funcionarios} />
            <Kpi label="EPIs no catálogo" valor={agregado.total_epis_catalogo} />
            <Kpi label="Fichas em uso" valor={agregado.total_fichas_em_uso} />
            <Kpi label="Movimentações 30d" valor={agregado.movimentacoes_30d} />
          </div>
        </section>

        {/* Alertas + estoque */}
        <section style={{ marginBottom: 24 }}>
          <h2 style={subTitulo}>Pontos de atenção</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Kpi label="Alertas ativos" valor={agregado.alertas_ativos} cor={agregado.alertas_ativos > 0 ? C.gold : undefined} />
            <Kpi label="Alertas críticos" valor={agregado.alertas_criticos} cor={agregado.alertas_criticos > 0 ? C.red : undefined} />
            <Kpi label="Estoque crítico" valor={agregado.estoque_critico} cor={agregado.estoque_critico > 0 ? C.yellow : undefined} />
            <Kpi label="Trocas atrasadas" valor={agregado.trocas_atrasadas} cor={agregado.trocas_atrasadas > 0 ? C.red : undefined} />
          </div>
        </section>

        {/* Graficos */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 24 }}>
          <Card titulo="Distribuição EPIs por categoria">
            {agregado.piedata.length === 0 ? (
              <Vazio msg="Sem dados de catálogo ainda" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={agregado.piedata} dataKey="value" nameKey="name" innerRadius={48} outerRadius={88} paddingAngle={2}>
                    {agregado.piedata.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card titulo="Movimentações últimos 6 meses">
            {agregado.bardata.length === 0 ? (
              <Vazio msg="Sem movimentações ainda" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={agregado.bardata}>
                  <XAxis dataKey="mes" stroke={C.espressoLt} fontSize={11} />
                  <YAxis stroke={C.espressoLt} fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="total" fill={C.gold} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </section>

        {loading && <p style={{ textAlign: 'center', color: C.muted }}>Carregando…</p>}
      </div>
    </div>
  )
}

function Kpi({ label, valor, cor }: { label: string; valor: number; cor?: string }) {
  return (
    <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', borderTop: `3px solid ${cor || C.gold}` }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, margin: 0 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 700, color: cor || C.espresso, margin: '6px 0 0', fontFeatureSettings: '"tnum"' }}>{valor}</p>
    </div>
  )
}

function BotaoNav({ href, titulo, icone, badge }: { href: string; titulo: string; icone: string; badge?: number }) {
  return (
    <Link href={href} style={{ display: 'block', textDecoration: 'none', position: 'relative' }}>
      <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 18, textAlign: 'center', boxShadow: '0 1px 3px rgba(61,35,20,0.06)', border: `1px solid ${C.borderLt}`, transition: 'transform 150ms' }}>
        <div style={{ fontSize: 28, marginBottom: 4 }}>{icone}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.espresso }}>{titulo}</div>
        {!!badge && badge > 0 && (
          <span style={{ position: 'absolute', top: 8, right: 8, padding: '2px 8px', borderRadius: 12, background: C.red, color: '#FFFFFF', fontSize: 11, fontWeight: 700 }}>{badge}</span>
        )}
      </div>
    </Link>
  )
}

function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(61,35,20,0.06)' }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: C.espresso, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 12px' }}>{titulo}</h3>
      {children}
    </div>
  )
}

function Vazio({ msg }: { msg: string }) {
  return <div style={{ textAlign: 'center', padding: 32, color: C.muted, fontSize: 13 }}>{msg}</div>
}

function Erro({ msg }: { msg: string }) {
  return <div style={{ background: '#fce8e8', color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{msg}</div>
}

const subTitulo: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: C.muted,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginTop: 0,
  marginBottom: 12,
}

const btnSec: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #ece3d2',
  background: '#FFFFFF',
  color: '#3D2314',
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
}

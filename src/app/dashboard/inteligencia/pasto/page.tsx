'use client'

// BI Agro · Pasto e lotação. Lê fn_agro_pasto(company).
import { useCallback, useEffect, useState } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { BiScaffold, KpiRow, Kpi, Bloco, Grade, EmBreve, Carregando, SemEmpresa, PALETA, GOLD, MUT, LINE, ESP, fmtInt, fmtDec } from '../_bi'

type Dados = {
  kpis: { ha_total: number; capacidade_ua: number; ua_atual: number; lotacao_ua_ha: number; ocupacao_pct: number; pastos: number }
  por_pasto: { nome: string; area_ha: number; capacidade_ua: number }[]
  propria_vs_arrendada: { tipo: string; ha: number }[]
}

export default function PastoPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [d, setD] = useState<Dados | null>(null)
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.rpc('fn_agro_pasto', { p_company_id: companyId })
    setD((data ?? null) as Dados | null); setLoading(false)
  }, [companyId])
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => { void carregar() }, [carregar])

  if (!companyId) return <SemEmpresa />
  if (loading || !d) return <Carregando />

  const gauge = [{ name: 'Ocupação', value: d.kpis.ocupacao_pct, fill: GOLD }]

  return (
    <BiScaffold area="agro" kicker="🌱 Inteligência (BI) · agro · pecuária" titulo="Pasto e lotação">
      <KpiRow>
        <Kpi label="Área total" valor={`${fmtInt(d.kpis.ha_total)} ha`} sub={`${fmtInt(d.kpis.pastos)} pastos`} />
        <Kpi label="Lotação" valor={`${fmtDec(d.kpis.lotacao_ua_ha)} UA/ha`} />
        <Kpi label="Ocupação" valor={`${fmtInt(d.kpis.ocupacao_pct)}%`} sub={`${fmtInt(d.kpis.ua_atual)} de ${fmtInt(d.kpis.capacidade_ua)} UA`} />
        <Kpi label="Capacidade" valor={`${fmtInt(d.kpis.capacidade_ua)} UA`} />
      </KpiRow>

      <Grade>
        <Bloco titulo="Ocupação (rebanho × capacidade)">
          <ResponsiveContainer width="100%" height={240}>
            <RadialBarChart innerRadius="70%" outerRadius="100%" data={gauge} startAngle={210} endAngle={-30}>
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="value" cornerRadius={8} background={{ fill: LINE }} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div style={{ textAlign: 'center', marginTop: -140, marginBottom: 100, fontSize: 30, fontWeight: 700, color: ESP }}>{fmtInt(d.kpis.ocupacao_pct)}%</div>
        </Bloco>

        <Bloco titulo="Própria × arrendada (ha)">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={d.propria_vs_arrendada} dataKey="ha" nameKey="tipo" cx="50%" cy="50%" outerRadius={90} label={(props) => { const p = props as unknown as { tipo?: string; ha?: number }; return `${p.tipo ?? ''} (${fmtInt(p.ha ?? 0)} ha)` }}>
                {d.propria_vs_arrendada.map((_, i) => <Cell key={i} fill={PALETA[i % PALETA.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => `${fmtInt(Number(v))} ha`} />
            </PieChart>
          </ResponsiveContainer>
        </Bloco>

        <Bloco titulo="Capacidade por pasto (UA)" span>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={d.por_pasto} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
              <XAxis dataKey="nome" tick={{ fontSize: 9, fill: MUT }} interval={0} angle={-30} textAnchor="end" height={70} />
              <YAxis tick={{ fontSize: 11, fill: MUT }} />
              <Tooltip formatter={(v) => [`${fmtInt(Number(v))} UA`, 'Capacidade']} />
              <Bar dataKey="capacidade_ua" fill={PALETA[0]} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Bloco>
      </Grade>

      <div style={{ marginTop: 12 }}>
        <EmBreve titulo="Ocupação por pasto e oferta de forragem" motivo="Depende de vincular animal→pasto e da avaliação de pasto (altura/massa de forragem). Com isso, a lotação por piquete e a oferta de forragem acendem aqui." />
      </div>
    </BiScaffold>
  )
}

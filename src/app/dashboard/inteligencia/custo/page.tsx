'use client'

// BI Agro · Custo e resultado — o financeiro que o Ivan pediu. Lê fn_agro_custo_resultado(company).
// Pilar 1: só LÊ de erp_pagar (GE), não duplica lançamento.
import { useCallback, useEffect, useState } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { BiScaffold, KpiRow, Kpi, Bloco, Grade, EmBreve, Carregando, SemEmpresa, PALETA, GOLD, MUT, LINE, ESP, fmtBRL, fmtInt } from '../_bi'

type Dados = {
  kpis: { custo_total: number; custo_dir_gado: number; ua_total: number; cabecas: number; custo_por_ua: number; custo_por_cabeca: number }
  por_centro: { centro_custo: string; total: number }[]
  por_categoria: { categoria: string; total: number }[]
  por_mes: { mes: string; total: number }[]
}
const CENTRO_LABEL: Record<string, string> = { DIR_GADO: 'Gado', DIR_SOJA: 'Soja', COMUM: 'Estrutura (comum)', EXTRA: 'Extra' }

export default function CustoPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [d, setD] = useState<Dados | null>(null)
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.rpc('fn_agro_custo_resultado', { p_company_id: companyId })
    setD((data ?? null) as Dados | null); setLoading(false)
  }, [companyId])
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => { void carregar() }, [carregar])

  if (!companyId) return <SemEmpresa />
  if (loading || !d) return <Carregando />

  const centros = d.por_centro.map((c) => ({ nome: CENTRO_LABEL[c.centro_custo] ?? c.centro_custo, total: c.total }))
  const cats = d.por_categoria.map((c) => ({ nome: c.categoria, total: c.total }))

  return (
    <BiScaffold area="agro" kicker="💰 Inteligência (BI) · agro · pecuária" titulo="Custo e resultado">
      <KpiRow>
        <Kpi label="Custo total" valor={fmtBRL(d.kpis.custo_total)} sub="todas as despesas (GE)" />
        <Kpi label="Custo / UA" valor={fmtBRL(d.kpis.custo_por_ua)} sub={`${fmtInt(d.kpis.ua_total)} UA`} />
        <Kpi label="Custo / cabeça" valor={fmtBRL(d.kpis.custo_por_cabeca)} sub={`${fmtInt(d.kpis.cabecas)} cabeças`} />
        <Kpi label="Custo direto do gado" valor={fmtBRL(d.kpis.custo_dir_gado)} sub="centro DIR_GADO" />
      </KpiRow>

      <Grade>
        <Bloco titulo="Composição de custos (por categoria)">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={cats} dataKey="total" nameKey="nome" cx="50%" cy="50%" outerRadius={90} label={(props) => { const p = props as unknown as { nome?: string }; return String(p.nome ?? '').split(' - ')[0] }}>
                {cats.map((_, i) => <Cell key={i} fill={PALETA[i % PALETA.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => fmtBRL(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </Bloco>

        <Bloco titulo="Resultado por divisão (DRE divisional)">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={centros} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
              <XAxis dataKey="nome" tick={{ fontSize: 11, fill: MUT }} />
              <YAxis tick={{ fontSize: 11, fill: MUT }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v) => fmtBRL(Number(v))} />
              <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                {centros.map((_, i) => <Cell key={i} fill={PALETA[i % PALETA.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Bloco>

        <Bloco titulo="Custo por mês (competência)" span>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={d.por_mes} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
              <XAxis dataKey="mes" tick={{ fontSize: 10, fill: MUT }} />
              <YAxis tick={{ fontSize: 11, fill: MUT }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v) => fmtBRL(Number(v))} />
              <Line type="monotone" dataKey="total" stroke={GOLD} strokeWidth={2} dot={{ r: 2, fill: ESP }} />
            </LineChart>
          </ResponsiveContainer>
        </Bloco>
      </Grade>

      <div style={{ marginTop: 12 }}>
        <EmBreve titulo="Custo por lote e margem por lote" motivo="Depende de alocar o custo ao rebanho (erp_pec_custo_lancamento). Assim que os lançamentos forem rateados por lote, o custo/@ e a margem por lote acendem aqui." />
      </div>
    </BiScaffold>
  )
}

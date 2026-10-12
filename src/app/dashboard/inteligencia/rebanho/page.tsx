'use client'

// BI Agro · Rebanho e inventário. Lê fn_agro_rebanho(company). Pirâmide etária e evolução só renderizam
// com lastro (RD-58): hoje data_nascimento vazio e movimentação em 1 mês → empty state honesto.
import { useCallback, useEffect, useState } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { BiScaffold, KpiRow, Kpi, Bloco, Grade, EmBreve, Carregando, SemEmpresa, PALETA, MUT, LINE, VERDE, fmtInt } from '../_bi'

type Dados = {
  kpis: { cabecas: number; ua_total: number; lotes: number; categorias: number }
  por_categoria: { categoria: string; qt: number }[]
  por_sexo: { sexo: string; qt: number }[]
  por_lote: { rotulo: string; qt: number }[]
  piramide_etaria: { faixa: string; qt: number }[]
  evolucao: { mes: string; entradas: number; saidas: number; saldo: number }[]
}
const SEXO_LABEL: Record<string, string> = { F: 'Fêmeas', M: 'Machos' }

export default function RebanhoPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [d, setD] = useState<Dados | null>(null)
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.rpc('fn_agro_rebanho', { p_company_id: companyId })
    setD((data ?? null) as Dados | null); setLoading(false)
  }, [companyId])
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => { void carregar() }, [carregar])

  if (!companyId) return <SemEmpresa />
  if (loading || !d) return <Carregando />

  const cats = d.por_categoria.map((c) => ({ nome: c.categoria, qt: c.qt }))
  const sexos = d.por_sexo.map((s) => ({ nome: SEXO_LABEL[s.sexo] ?? s.sexo, qt: s.qt }))

  return (
    <BiScaffold area="agro" kicker="🐂 Inteligência (BI) · agro · pecuária" titulo="Rebanho e inventário">
      <KpiRow>
        <Kpi label="Cabeças" valor={fmtInt(d.kpis.cabecas)} />
        <Kpi label="UA total" valor={fmtInt(d.kpis.ua_total)} sub="unidades animais" />
        <Kpi label="Lotes" valor={fmtInt(d.kpis.lotes)} />
        <Kpi label="Categorias" valor={fmtInt(d.kpis.categorias)} />
      </KpiRow>

      <Grade>
        <Bloco titulo="Composição do rebanho (categoria)">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={cats} dataKey="qt" nameKey="nome" cx="50%" cy="50%" outerRadius={90} label={(props) => { const p = props as unknown as { nome?: string; qt?: number }; return `${p.nome ?? ''} (${p.qt ?? 0})` }}>
                {cats.map((_, i) => <Cell key={i} fill={PALETA[i % PALETA.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => `${fmtInt(Number(v))} cab`} />
            </PieChart>
          </ResponsiveContainer>
        </Bloco>

        <Bloco titulo="Por sexo">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={sexos} dataKey="qt" nameKey="nome" cx="50%" cy="50%" innerRadius={45} outerRadius={90} label={(props) => { const p = props as unknown as { nome?: string; qt?: number }; return `${p.nome ?? ''} (${p.qt ?? 0})` }}>
                {sexos.map((_, i) => <Cell key={i} fill={PALETA[i % PALETA.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => `${fmtInt(Number(v))} cab`} />
            </PieChart>
          </ResponsiveContainer>
        </Bloco>

        <Bloco titulo="Rebanho por lote" span>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={d.por_lote} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: MUT }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11, fill: MUT }} />
              <Tooltip formatter={(v) => `${fmtInt(Number(v))} cab`} />
              <Bar dataKey="qt" fill={PALETA[0]} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Bloco>

        {d.evolucao.length >= 2 ? (
          <Bloco titulo="Evolução do rebanho (entradas × saídas)" span>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={d.evolucao} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
                <XAxis dataKey="mes" tick={{ fontSize: 10, fill: MUT }} />
                <YAxis tick={{ fontSize: 11, fill: MUT }} />
                <Tooltip /><Legend />
                <Line type="monotone" dataKey="entradas" stroke={VERDE} strokeWidth={2} />
                <Line type="monotone" dataKey="saidas" stroke="#A0522D" strokeWidth={2} />
                <Line type="monotone" dataKey="saldo" stroke={PALETA[0]} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Bloco>
        ) : null}
      </Grade>

      <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
        {d.piramide_etaria.length === 0 && (
          <EmBreve titulo="Pirâmide etária" motivo="Depende da data de nascimento dos animais (ainda não informada no cadastro). Assim que houver, as faixas de idade acendem aqui." />
        )}
        {d.evolucao.length < 2 && (
          <EmBreve titulo="Evolução do rebanho" motivo="As movimentações ainda estão concentradas em transferências internas (um período). Com compras/vendas/nascimentos ao longo dos meses, a curva de entradas × saídas acende aqui." />
        )}
      </div>
    </BiScaffold>
  )
}

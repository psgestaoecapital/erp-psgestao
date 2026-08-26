'use client'

// DASHBOARD-AGRO (Sprint 1) · tela inicial do módulo Agro, genérica e multi-tenant.
// RD-51/RD-58: NADA hardcoded — atividades/cores/números vêm de fn_agro_dashboard(company_id, ...)
// e fn_bem_indicadores(company_id). Adapta-se ao que a empresa tem (1 atividade ou 10; com/sem pecuária).

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/lib/agro/usePecuaria'
import PeriodoSelector, { type SelecaoPeriodo, type Periodo } from '@/components/dashboard/PeriodoSelector'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.6)'
const GREEN = '#3B6D11', RED = '#A32D2D'
const PALETA = ['#3B6D11', '#BA7517', '#8B5CF6', '#2F5AA8', '#A32D2D', '#0D9488', '#C8941A', '#6B5D4F']

const brl = (n: number | null | undefined) =>
  'R$ ' + Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const mesLabel = (ym: string) => { const [y, m] = ym.split('-'); return `${m}/${y.slice(2)}` }

interface Atividade { name: string; cor: string | null; type?: string | null; receita: number; despesa: number; resultado: number }
interface Cat { categoria: string; valor: number }
interface SerieMes { mes: string; receita: number; despesa: number; resultado: number }
interface SerieAtiv { name: string; cor: string | null; pontos: { mes: string; receita: number }[] }
interface SerieReb { mes: string; liquido: number; acumulado: number }
interface Dash {
  sem_acesso?: boolean
  periodo?: { inicio: string; fim: string }
  resultado_fazenda?: { receita: number; despesa: number; resultado: number }
  por_atividade?: Atividade[]
  receitas_por_categoria?: Cat[]
  despesas_por_categoria?: Cat[]
  series_mensais?: SerieMes[]
  series_por_atividade?: SerieAtiv[]
  tem_pecuaria?: boolean
  series_rebanho?: SerieReb[]
}
interface Bens { total_imobilizado?: number; total_terras?: number; total_maquinas?: number; depreciacao_periodo?: number; qtd_bens?: number; [k: string]: unknown }

function selToRange(sel: SelecaoPeriodo): { inicio: string; fim: string } {
  if (sel.modo === 'custom') return { inicio: sel.data_inicio, fim: sel.data_fim }
  const ini = new Date(Date.UTC(sel.ano, sel.mes - 1, 1))
  const fim = new Date(Date.UTC(sel.ano, sel.mes, 0))
  return { inicio: ini.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) }
}

export default function DashboardAgroPage() {
  const { companyId } = useEmpresaSelecionada()
  const companyIds = useMemo(() => (companyId ? [companyId] : []), [companyId])
  const [selecao, setSelecao] = useState<SelecaoPeriodo | null>(null)
  const [dash, setDash] = useState<Dash | null>(null)
  const [bens, setBens] = useState<Bens | null>(null)
  const [loading, setLoading] = useState(false)

  // auto-select do último período com dados (o PeriodoSelector delega ao pai)
  const onPeriodos = useCallback((ps: Periodo[]) => {
    setSelecao((cur) => {
      if (cur) return cur
      const ult = ps.find((p) => p.is_ultimo_com_dados) ?? ps[0]
      return ult ? { modo: 'mes', ano: ult.ano, mes: ult.mes } : cur
    })
  }, [])

  useEffect(() => {
    if (!companyId || !selecao) return
    let alive = true
    const { inicio, fim } = selToRange(selecao)
    ;(async () => {
      setLoading(true)
      const [d, b] = await Promise.all([
        supabase.rpc('fn_agro_dashboard', { p_company_id: companyId, p_data_inicio: inicio, p_data_fim: fim }),
        supabase.rpc('fn_bem_indicadores', { p_company_id: companyId }),
      ])
      if (!alive) return
      setDash((d.data as Dash) ?? null)
      setBens((b.data as Bens) ?? null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [companyId, selecao])

  const rf = dash?.resultado_fazenda
  const atividades = dash?.por_atividade ?? []
  const series = dash?.series_mensais ?? []
  const seriesAtiv = dash?.series_por_atividade ?? []
  const temBens = !!bens && Number(bens.total_imobilizado ?? 0) > 0

  // Pivot séries por atividade p/ o recharts (uma coluna por atividade, X=mes)
  const pivotAtiv = useMemo(() => {
    const meses = new Map<string, Record<string, number | string>>()
    for (const s of dash?.series_por_atividade ?? []) for (const p of s.pontos) {
      const row = meses.get(p.mes) ?? { mes: p.mes }
      row[s.name] = p.receita
      meses.set(p.mes, row)
    }
    return Array.from(meses.values()).sort((a, b) => String(a.mes).localeCompare(String(b.mes)))
  }, [dash])

  if (!companyId) return <Wrap><Info>Selecione uma empresa específica para abrir o Dashboard do Agro.</Info></Wrap>

  return (
    <Wrap>
      <header className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: GOLD }}>🌾 Agro</div>
          <h1 className="text-2xl sm:text-3xl mt-1" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600, color: ESP }}>Dashboard da Fazenda</h1>
          <p className="text-[13px] mt-1" style={{ color: ESP60 }}>Todas as atividades da empresa, por competência. Ajuste o período.</p>
        </div>
        <PeriodoSelector companyIds={companyIds} selecao={selecao} onChange={setSelecao} onPeriodosCarregados={onPeriodos} />
      </header>

      {loading && <Info>Carregando…</Info>}
      {!loading && dash?.sem_acesso && <Info>Sem acesso a esta empresa.</Info>}

      {!loading && dash && !dash.sem_acesso && (
        <div className="space-y-4">
          {/* 3.1 Resultado da fazenda */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kpi label="Receita (período)" value={brl(rf?.receita)} color={GREEN} />
            <Kpi label="Despesa (período)" value={brl(rf?.despesa)} color={RED} />
            <Kpi label="Resultado (período)" value={brl(rf?.resultado)} color={(rf?.resultado ?? 0) >= 0 ? GREEN : RED} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Apurar titulo="Variação de rebanho (R$)" />
            <Apurar titulo="Valorização de terras (R$)" />
          </div>

          {/* Indicadores rápidos */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Mini label="Atividades" value={String(atividades.length)} />
            <Mini label="Melhor resultado" value={atividades[0]?.name ?? '—'} />
            <Mini label="Margem geral" value={rf && rf.receita > 0 ? `${Math.round((rf.resultado / rf.receita) * 100)}%` : '—'} />
            <Mini label="Pecuária" value={dash.tem_pecuaria ? 'sim' : 'não'} />
          </div>

          {/* 3.2 Resultado por atividade */}
          <Section titulo="Resultado por atividade">
            {atividades.length === 0 ? <Vazio>Nenhuma atividade cadastrada nesta empresa.</Vazio> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {atividades.map((a, i) => (
                  <div key={a.name} className="rounded-xl p-3" style={{ background: '#fff', border: `1px solid ${LINE}`, borderLeft: `4px solid ${a.cor || PALETA[i % PALETA.length]}` }}>
                    <div className="font-semibold text-[14px]" style={{ color: ESP }}>{a.name}</div>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-[12px]">
                      <div><div style={{ color: ESP60 }}>Receita</div><div style={{ color: GREEN, fontWeight: 600 }}>{brl(a.receita)}</div></div>
                      <div><div style={{ color: ESP60 }}>Despesa</div><div style={{ color: RED, fontWeight: 600 }}>{brl(a.despesa)}</div></div>
                      <div><div style={{ color: ESP60 }}>Resultado</div><div style={{ color: a.resultado >= 0 ? GREEN : RED, fontWeight: 700 }}>{brl(a.resultado)}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 3.3 Categorias */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Section titulo="Receitas por categoria"><CatList itens={dash.receitas_por_categoria ?? []} cor={GREEN} /></Section>
            <Section titulo="Despesas por categoria"><CatList itens={dash.despesas_por_categoria ?? []} cor={RED} /></Section>
          </div>

          {/* 3.4 Patrimônio (só se tem bens) */}
          {temBens && (
            <Section titulo="Patrimônio">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Mini label="Imobilizado" value={brl(Number(bens?.total_imobilizado ?? 0))} />
                <Mini label="Terras" value={brl(Number(bens?.total_terras ?? 0))} />
                <Mini label="Máquinas/Equip." value={brl(Number(bens?.total_maquinas ?? 0))} />
                <Mini label="Depreciação (período)" value={brl(Number(bens?.depreciacao_periodo ?? 0))} />
              </div>
            </Section>
          )}

          {/* 3.5 Gráficos temporais */}
          <Section titulo="Receita × Despesa (12 meses)">
            <ChartBox>
              <ComposedChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
                <XAxis dataKey="mes" tickFormatter={mesLabel} tick={{ fontSize: 11, fill: ESP60 }} />
                <YAxis tick={{ fontSize: 11, fill: ESP60 }} width={70} tickFormatter={(v) => (v / 1000).toFixed(0) + 'k'} />
                <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(l) => mesLabel(String(l))} />
                <Legend />
                <Bar dataKey="receita" name="Receita" fill={GREEN} />
                <Bar dataKey="despesa" name="Despesa" fill={RED} />
                <Line type="monotone" dataKey="resultado" name="Resultado" stroke={GOLD} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ChartBox>
          </Section>

          <Section titulo="Resultado mensal">
            <ChartBox>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
                <XAxis dataKey="mes" tickFormatter={mesLabel} tick={{ fontSize: 11, fill: ESP60 }} />
                <YAxis tick={{ fontSize: 11, fill: ESP60 }} width={70} tickFormatter={(v) => (v / 1000).toFixed(0) + 'k'} />
                <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(l) => mesLabel(String(l))} />
                <Line type="monotone" dataKey="resultado" name="Resultado" stroke={GOLD} strokeWidth={2} />
              </LineChart>
            </ChartBox>
          </Section>

          {seriesAtiv.length > 0 && (
            <Section titulo="Receita por atividade ao longo do tempo">
              <ChartBox>
                <LineChart data={pivotAtiv}>
                  <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
                  <XAxis dataKey="mes" tickFormatter={mesLabel} tick={{ fontSize: 11, fill: ESP60 }} />
                  <YAxis tick={{ fontSize: 11, fill: ESP60 }} width={70} tickFormatter={(v) => (v / 1000).toFixed(0) + 'k'} />
                  <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(l) => mesLabel(String(l))} />
                  <Legend />
                  {seriesAtiv.map((s, i) => (
                    <Line key={s.name} type="monotone" dataKey={s.name} name={s.name} stroke={s.cor || PALETA[i % PALETA.length]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ChartBox>
            </Section>
          )}

          {dash.tem_pecuaria && (dash.series_rebanho ?? []).some((r) => r.liquido !== 0) && (
            <Section titulo="Evolução do rebanho (líquido acumulado)">
              <ChartBox>
                <LineChart data={dash.series_rebanho}>
                  <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
                  <XAxis dataKey="mes" tickFormatter={mesLabel} tick={{ fontSize: 11, fill: ESP60 }} />
                  <YAxis tick={{ fontSize: 11, fill: ESP60 }} width={50} />
                  <Tooltip labelFormatter={(l) => mesLabel(String(l))} />
                  <Line type="monotone" dataKey="acumulado" name="Cabeças (líq. acum.)" stroke={GREEN} strokeWidth={2} />
                </LineChart>
              </ChartBox>
            </Section>
          )}
        </div>
      )}
    </Wrap>
  )
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div style={{ background: BG, minHeight: '100%' }} className="p-4 sm:p-6"><div className="max-w-6xl mx-auto">{children}</div></div>
}
function Info({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl p-6 text-sm text-center" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP60 }}>{children}</div>
}
function Section({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="text-sm font-semibold mb-3" style={{ color: ESP }}>{titulo}</div>
      {children}
    </section>
  )
}
function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: ESP60 }}>{label}</div>
    </div>
  )
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="text-[15px] font-bold truncate" style={{ color: ESP }}>{value}</div>
      <div className="text-[11px] mt-0.5" style={{ color: ESP60 }}>{label}</div>
    </div>
  )
}
function Apurar({ titulo }: { titulo: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: '#FBF4E4', border: `1px dashed ${GOLD}` }}>
      <div className="text-[13px] font-semibold" style={{ color: '#8A5A0B' }}>{titulo}</div>
      <div className="text-[12px] mt-1" style={{ color: ESP60 }}>a apurar (Sprint 3)</div>
    </div>
  )
}
function Vazio({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] py-4 text-center" style={{ color: ESP60 }}>{children}</div>
}
function CatList({ itens, cor }: { itens: Cat[]; cor: string }) {
  if (itens.length === 0) return <Vazio>Sem lançamentos no período.</Vazio>
  const max = Math.max(...itens.map((i) => Math.abs(i.valor)), 1)
  return (
    <div className="space-y-1.5">
      {itens.slice(0, 12).map((c) => (
        <div key={c.categoria} className="text-[12.5px]">
          <div className="flex justify-between" style={{ color: ESP }}>
            <span className="truncate pr-2">{c.categoria}</span>
            <span className="font-semibold tabular-nums" style={{ color: cor }}>{brl(c.valor)}</span>
          </div>
          <div style={{ height: 4, background: LINE, borderRadius: 2, marginTop: 2 }}>
            <div style={{ height: 4, width: `${(Math.abs(c.valor) / max) * 100}%`, background: cor, borderRadius: 2 }} />
          </div>
        </div>
      ))}
    </div>
  )
}
function ChartBox({ children }: { children: React.ReactElement }) {
  return <div style={{ width: '100%', height: 280 }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
}

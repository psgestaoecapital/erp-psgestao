'use client'
// BI do P&M · home da agência (rota_raiz /dashboard/pm). KPIs operacionais + 6 indicadores do moat
// (lidos do catálogo area_indicadores_mestres, valor calculado nas RPCs) + gráficos + alertas.
// RD-51: indicador sem dado → "em cálculo" (não zero falso). Pilar 2: RPCs filtram company_id.
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { PSGC_COLORS as C, PSGC_RADIUS as R, fmtR } from '@/lib/psgc-tokens'

const SEM: Record<string, string> = { verde: '#16a34a', amarelo: '#eab308', vermelho: '#dc2626', em_calculo: '#9C8E80' }
const nf = (n: number) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })

type Kpis = { empty_state?: boolean; mrr?: number; clientes_ativos?: number; jobs_andamento?: number; horas_mes?: number; comissao_pagar?: number; receber_vencido?: number }
type Ind = { sigla: string; nome: string; meta_numerica: number | null; meta_unidade: string | null; direcao_boa: string; valor_calculado: number | null; status_semaforo: string }
type Serie = { empty_state?: boolean; receita_12m?: { mes: string; valor: number }[]; margem_clientes?: { cliente: string; receita: number; custo: number; margem: number }[]; top_clientes?: { cliente: string; mrr: number }[]; alertas?: { jobs_atrasados: number; contratos_renovar_60d: number; titulos_vencidos: number } }

export default function PmBiPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const key = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [inds, setInds] = useState<Ind[]>([])
  const [serie, setSerie] = useState<Serie | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const ids = key ? key.split(',').filter(Boolean) : []
    if (ids.length === 0) { setLoading(false); return }
    let alive = true
    void (async () => {
      setLoading(true); setErro(null)
      const [k, i, s] = await Promise.all([
        supabase.rpc('fn_pm_bi_kpis', { p_company_ids: ids }),
        supabase.rpc('fn_pm_bi_indicadores', { p_company_ids: ids }),
        supabase.rpc('fn_pm_bi_series', { p_company_ids: ids }),
      ])
      if (!alive) return
      if (k.error || i.error || s.error) { setErro((k.error || i.error || s.error)?.message ?? 'erro'); setLoading(false); return }
      setKpis(k.data as Kpis); setInds((i.data ?? []) as Ind[]); setSerie(s.data as Serie); setLoading(false)
    })()
    return () => { alive = false }
  }, [key])

  const vazio = !kpis || kpis.empty_state
  const maxReceita = Math.max(1, ...(serie?.receita_12m ?? []).map((x) => x.valor))
  const maxMrr = Math.max(1, ...(serie?.top_clientes ?? []).map((x) => x.mrr))
  const maxMargem = Math.max(1, ...(serie?.margem_clientes ?? []).map((x) => Math.abs(x.margem)))
  const al = serie?.alertas

  return (
    <div style={{ background: C.offWhite, minHeight: '100vh', color: C.espresso }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 20px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: C.dourado, margin: 0 }}>P&amp;M · Painel</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 4px' }}>BI da Agência</h1>
            <p style={{ margin: 0, fontSize: 13, color: C.espressoLight }}>{selInfo.tipo === 'empresa' ? selInfo.nome : 'Indicadores da agência — receita, operação e moat.'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/dashboard/pm/comercial" style={btnGhost}>Comercial</Link>
            <Link href="/dashboard/pm/leads" style={btnGhost}>+ Novo lead</Link>
            <Link href="/dashboard/pm/propostas" style={btnPri}>+ Nova proposta</Link>
          </div>
        </header>

        {loading ? <Box>Carregando indicadores…</Box>
          : erro ? <Box cor="#7A1F1F">Erro ao carregar: {erro}</Box>
          : vazio ? (
            <Box>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, marginBottom: 6 }}>Ainda sem dados suficientes</div>
              <div style={{ fontSize: 13, color: C.espressoLight }}>Cadastre clientes/contratos e aponte horas para os indicadores da agência aparecerem.</div>
            </Box>
          ) : (
            <>
              {/* Faixa 1 — KPIs operacionais */}
              <section style={grid(200)}>
                <Kpi l="MRR (receita recorrente)" v={fmtR(kpis!.mrr ?? 0)} destaque />
                <Kpi l="Clientes ativos" v={String(kpis!.clientes_ativos ?? 0)} />
                <Kpi l="Jobs em andamento" v={String(kpis!.jobs_andamento ?? 0)} />
                <Kpi l="Horas no mês" v={nf(kpis!.horas_mes ?? 0)} />
                <Kpi l="Comissão a pagar" v={fmtR(kpis!.comissao_pagar ?? 0)} />
                <Kpi l="A receber vencido" v={fmtR(kpis!.receber_vencido ?? 0)} cor={(kpis!.receber_vencido ?? 0) > 0 ? '#dc2626' : undefined} />
              </section>

              {/* Faixa 2 — Indicadores do moat */}
              <SecTitle>Indicadores do moat</SecTitle>
              <section style={grid(220)}>
                {inds.map((ind) => {
                  const cor = SEM[ind.status_semaforo] ?? SEM.em_calculo
                  const emCalc = ind.status_semaforo === 'em_calculo' || ind.valor_calculado == null
                  return (
                    <div key={ind.sigla} style={{ background: '#fff', border: `1px solid ${C.offWhiteDarker}`, borderRadius: R.xl, padding: 14, borderLeft: `4px solid ${cor}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5, color: C.espresso }}>{ind.sigla}</span>
                        <span style={{ fontSize: 10, color: C.espressoLight }}>meta {nf(Number(ind.meta_numerica ?? 0))} {ind.meta_unidade}</span>
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: emCalc ? C.espressoLight : cor, marginTop: 6 }}>
                        {emCalc ? 'em cálculo' : `${nf(Number(ind.valor_calculado))}${ind.meta_unidade === '%' ? '%' : ''}`}
                      </div>
                      <div style={{ fontSize: 11, color: C.espressoLight, marginTop: 2 }}>{ind.nome}</div>
                    </div>
                  )
                })}
              </section>

              {/* Faixa 3 — Gráficos */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px,1fr))', gap: 12, marginTop: 8 }}>
                <Card titulo="Receita (12 meses)">
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
                    {(serie?.receita_12m ?? []).map((x) => (
                      <div key={x.mes} title={`${x.mes}: ${fmtR(x.valor)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <div style={{ width: '100%', height: `${(x.valor / maxReceita) * 100}%`, minHeight: x.valor > 0 ? 3 : 0, background: C.dourado, borderRadius: 3 }} />
                        <span style={{ fontSize: 8, color: C.espressoLight }}>{x.mes.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card titulo="Top clientes por MRR">
                  {(serie?.top_clientes ?? []).length === 0 ? <Vazinho /> : (serie?.top_clientes ?? []).map((x) => (
                    <BarRow key={x.cliente} label={x.cliente} valor={fmtR(x.mrr)} pct={(x.mrr / maxMrr) * 100} cor={C.espresso} />
                  ))}
                </Card>
                <Card titulo="Margem por cliente (fee − custo)">
                  {(serie?.margem_clientes ?? []).length === 0 ? <Vazinho /> : (serie?.margem_clientes ?? []).map((x) => (
                    <BarRow key={x.cliente} label={x.cliente} valor={fmtR(x.margem)} pct={(Math.abs(x.margem) / maxMargem) * 100} cor={x.margem < 0 ? '#dc2626' : '#16a34a'} />
                  ))}
                </Card>
              </div>

              {/* Faixa 4 — Alertas */}
              <SecTitle>Alertas</SecTitle>
              <section style={grid(220)}>
                <Alerta n={al?.jobs_atrasados ?? 0} l="Jobs atrasados" bom={0} />
                <Alerta n={al?.titulos_vencidos ?? 0} l="Títulos vencidos (a receber)" bom={0} />
                <Alerta n={al?.contratos_renovar_60d ?? 0} l="Contratos a renovar (60d)" bom={0} neutro />
              </section>
            </>
          )}
      </div>
    </div>
  )
}

function Kpi({ l, v, cor, destaque }: { l: string; v: string; cor?: string; destaque?: boolean }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.offWhiteDarker}`, borderRadius: R.xl, padding: 14, boxShadow: destaque ? `0 0 0 2px ${C.dourado}22` : undefined }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: C.espressoLight, fontWeight: 700 }}>{l}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? (destaque ? C.dourado : C.espresso), marginTop: 4 }}>{v}</div>
    </div>
  )
}
function Alerta({ n, l, bom, neutro }: { n: number; l: string; bom: number; neutro?: boolean }) {
  const ruim = n > bom
  const cor = neutro ? C.dourado : ruim ? '#dc2626' : '#16a34a'
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.offWhiteDarker}`, borderRadius: R.xl, padding: 14, borderLeft: `4px solid ${cor}` }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: cor }}>{n}</div>
      <div style={{ fontSize: 12, color: C.espressoLight, marginTop: 2 }}>{l}</div>
    </div>
  )
}
function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.offWhiteDarker}`, borderRadius: R.xl, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: C.espressoLight, marginBottom: 12 }}>{titulo}</div>
      {children}
    </div>
  )
}
function BarRow({ label, valor, pct, cor }: { label: string; valor: string; pct: number; cor: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}><span style={{ color: C.espresso, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{label}</span><span style={{ color: C.espressoLight }}>{valor}</span></div>
      <div style={{ height: 8, background: C.offWhiteDark, borderRadius: 4 }}><div style={{ width: `${Math.max(2, Math.min(100, pct))}%`, height: '100%', background: cor, borderRadius: 4 }} /></div>
    </div>
  )
}
function SecTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 400, margin: '22px 0 10px' }}>{children}</h2>
}
function Box({ children, cor }: { children: React.ReactNode; cor?: string }) {
  return <div style={{ padding: 40, textAlign: 'center', background: '#fff', borderRadius: R.xl, border: `1px solid ${C.offWhiteDarker}`, color: cor ?? C.espressoLight, fontSize: 14 }}>{children}</div>
}
function Vazinho() { return <div style={{ fontSize: 12, color: C.espressoLight }}>Sem dados ainda.</div> }
const grid = (min: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 })
const btnPri: React.CSSProperties = { border: 'none', background: C.dourado, color: '#fff', borderRadius: R.md, padding: '10px 16px', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }
const btnGhost: React.CSSProperties = { border: `1px solid ${C.offWhiteDarker}`, background: '#fff', color: C.espresso, borderRadius: R.md, padding: '10px 16px', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }

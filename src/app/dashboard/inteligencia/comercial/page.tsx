'use client'
// SPEC · BI Comercial Frioeste — Fase 1 (ATAK, dado já no banco). Painel DEDICADO sobre o raw ind_atak_fato
// (dom='comercial_vendas'), NÃO o motor genérico do canônico: precisa do LUCRO do raw + RBAC por login.
// RPCs: fn_bi_comercial_kpis/_serie/_pareto/_ranking_vendedores. Gating fail-closed no servidor (RD-41):
//   vendedor logado só vê o dele (p_vendedor é IGNORADO no servidor); diretor/assistente veem global ou 1 vendedor.
// LUCRO da origem ATAK está corrompido → KPI Lucro/Margem vem null + lucro_status='aguardando_dado_confiavel';
// o card mostra "aguardando dado confiável" honesto (RD-58/RD-51), sem número falso. Vira sozinho quando a origem corrigir.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { TrendingUp, Clock, ChevronDown, ArrowUp, ArrowDown } from 'lucide-react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', GREEN = '#166534', RED = '#A32D2D'
const brl = (n: number | null) => n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const nf = (n: number | null, d = 0) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })
const iso = (d: Date) => d.toISOString().slice(0, 10)
const perLabel = (s: string, gran: string) => { try { const d = new Date(s + 'T00:00:00'); if (gran === 'ano') return String(d.getFullYear()); if (gran === 'trimestre') return `T${Math.floor(d.getMonth() / 3) + 1}/${String(d.getFullYear()).slice(2)}`; if (gran === 'mes') return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) } catch { return s } }

type Kpis = { ok: boolean; erro?: string; escopo?: string; vendedor?: string | null; volume_kg: number; faturamento: number; clientes: number; ticket_kg: number | null; ticket_cliente: number | null; lucro: number | null; margem_pct: number | null; lucro_status: string }
type SerieP = { periodo: string; volume_kg: number; faturamento: number; margem_pct: number | null }
type Serie = { ok: boolean; granularidade: string; serie: SerieP[]; lucro_status: string }
type ParetoItem = { rotulo: string; valor: number; pct: number; pct_acumulado: number }
type Pareto = { ok: boolean; dimensao: string; itens: ParetoItem[] }
type RankItem = { cod_vend_comp: string; vendedor: string; volume_kg: number; faturamento: number; clientes: number; lucro: number | null; margem_pct: number | null }
type Ranking = { ok: boolean; erro?: string; ranking: RankItem[]; lucro_status: string }

const GRANS = [{ v: 'dia', l: 'Dia' }, { v: 'semana', l: 'Semana' }, { v: 'mes', l: 'Mês' }, { v: 'trimestre', l: 'Trimestre' }, { v: 'ano', l: 'Ano' }]
const DIMS = [{ v: 'cliente', l: 'Cliente' }, { v: 'vendedor', l: 'Vendedor' }, { v: 'supervisor', l: 'Supervisor' }, { v: 'filial', l: 'Filial' }]

const addD = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const som = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const sow = (d: Date) => addD(d, -((d.getDay() + 6) % 7))
type Preset = { v: string; l: string; range: () => { de: string; ate: string; gran: string } }
const PRESETS: Preset[] = [
  { v: 'mes', l: 'Mês atual', range: () => { const h = new Date(); return { de: iso(som(h)), ate: iso(h), gran: 'dia' } } },
  { v: 'hoje', l: 'Hoje', range: () => { const h = new Date(); return { de: iso(h), ate: iso(h), gran: 'dia' } } },
  { v: 'semana', l: 'Semana atual', range: () => { const h = new Date(); return { de: iso(sow(h)), ate: iso(h), gran: 'dia' } } },
  { v: 'd30', l: 'Últimos 30 dias', range: () => { const h = new Date(); return { de: iso(addD(h, -29)), ate: iso(h), gran: 'dia' } } },
  { v: 'd90', l: 'Últimos 90 dias', range: () => { const h = new Date(); return { de: iso(addD(h, -89)), ate: iso(h), gran: 'semana' } } },
  { v: 'tri', l: 'Trimestre', range: () => { const h = new Date(); const q = Math.floor(h.getMonth() / 3) * 3; return { de: iso(new Date(h.getFullYear(), q, 1)), ate: iso(h), gran: 'mes' } } },
  { v: 'ano', l: 'Ano atual', range: () => { const h = new Date(); return { de: iso(new Date(h.getFullYear(), 0, 1)), ate: iso(h), gran: 'mes' } } },
]
function rangeLabel(de: string, ate: string): string {
  const [ay, am, ad] = de.split('-'), [by, bm, bd] = ate.split('-')
  if (de === ate) return `${ad}/${am}/${ay}`
  if (ay === by && am === bm) return `${ad}–${bd}/${bm}/${by}`
  if (ay === by) return `${ad}/${am}–${bd}/${bm}/${by}`
  return `${ad}/${am}/${ay}–${bd}/${bm}/${by}`
}
// período anterior de mesmo comprimento (comparativo)
function prior(de: string, ate: string): { de: string; ate: string } {
  const a = new Date(de + 'T00:00:00'), b = new Date(ate + 'T00:00:00')
  const dias = Math.round((b.getTime() - a.getTime()) / 86400000) + 1
  const pAte = addD(a, -1), pDe = addD(pAte, -(dias - 1))
  return { de: iso(pDe), ate: iso(pAte) }
}

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => { if (typeof window === 'undefined') return null; const v = localStorage.getItem('ps_empresa_sel'); return (!v || v === 'consolidado' || v.startsWith('group_')) ? null : v }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(read()); const t = setInterval(() => { const v = read(); setId(p => p === v ? p : v) }, 800); return () => clearInterval(t)
  }, [])
  return id
}

export default function ComercialBIPage() {
  return <Suspense fallback={<div style={{ background: BG, minHeight: '100vh', padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const router = useRouter()
  const sp = useSearchParams()
  const area = sp.get('area') === 'agro' ? 'agro' : 'industrial'
  const companyId = useCompanyId()
  const [de, setDe] = useState(() => PRESETS[0].range().de)
  const [ate, setAte] = useState(() => PRESETS[0].range().ate)
  const [gran, setGran] = useState(() => PRESETS[0].range().gran)
  const [preset, setPreset] = useState('mes')
  const [dim, setDim] = useState('cliente')
  const [metrica, setMetrica] = useState<'faturamento' | 'volume_kg'>('faturamento')
  const [vendedor, setVendedor] = useState<string | null>(null) // p_vendedor (só efetivo p/ líder)
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [kpisAnt, setKpisAnt] = useState<Kpis | null>(null)
  const [serie, setSerie] = useState<Serie | null>(null)
  const [pareto, setPareto] = useState<Pareto | null>(null)
  const [ranking, setRanking] = useState<Ranking | null>(null)
  const [loading, setLoading] = useState(true)

  const ehLider = ranking?.ok === true // ranking só volta ok p/ diretor/assistente/admin
  const escopo = kpis?.escopo

  const aplicarPreset = (p: string) => {
    const found = PRESETS.find(x => x.v === p)
    if (!found) { setPreset('custom'); return }
    const r = found.range(); setDe(r.de); setAte(r.ate); setGran(r.gran); setPreset(p)
  }

  const carregar = useCallback(async (cid: string) => {
    setLoading(true)
    const pv = vendedor // servidor ignora p/ vendedor logado; efetivo só p/ líder
    const ant = prior(de, ate)
    const [k, ka, s, p, r] = await Promise.all([
      supabase.rpc('fn_bi_comercial_kpis', { p_company_id: cid, p_dt_ini: de, p_dt_fim: ate, p_vendedor: pv }),
      supabase.rpc('fn_bi_comercial_kpis', { p_company_id: cid, p_dt_ini: ant.de, p_dt_fim: ant.ate, p_vendedor: pv }),
      supabase.rpc('fn_bi_comercial_serie', { p_company_id: cid, p_dt_ini: de, p_dt_fim: ate, p_granularidade: gran, p_vendedor: pv }),
      supabase.rpc('fn_bi_comercial_pareto', { p_company_id: cid, p_dt_ini: de, p_dt_fim: ate, p_dimensao: dim, p_vendedor: pv }),
      supabase.rpc('fn_bi_comercial_ranking_vendedores', { p_company_id: cid, p_dt_ini: de, p_dt_fim: ate }),
    ])
    setKpis(k.data as Kpis | null); setKpisAnt(ka.data as Kpis | null)
    setSerie(s.data as Serie | null); setPareto(p.data as Pareto | null)
    setRanking(r.data as Ranking | null); setLoading(false)
  }, [de, ate, gran, dim, vendedor])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (companyId) void carregar(companyId) }, [companyId, carregar])

  const maxSerie = useMemo(() => Math.max(1, ...(serie?.serie ?? []).map(s => s[metrica] ?? 0)), [serie, metrica])
  const lucroConfiavel = kpis?.lucro_status === 'ok'
  const nomeVend = ehLider && vendedor ? (ranking?.ranking.find(x => x.cod_vend_comp === vendedor)?.vendedor ?? vendedor) : null

  // delta comparativo
  const delta = (cur: number | null | undefined, ant: number | null | undefined): { pct: number; up: boolean } | null => {
    if (cur == null || ant == null || ant === 0) return null
    const p = (cur - ant) / Math.abs(ant) * 100
    return { pct: Math.abs(p), up: p >= 0 }
  }

  if (!companyId) return <Shell {...{ area, router }}><Vazio t="Escolha uma empresa" l="Selecione uma empresa industrial específica no topo do menu." /></Shell>
  if (kpis && kpis.ok === false) return <Shell {...{ area, router }}><Vazio t="Sem acesso comercial" l="Seu login não está mapeado como vendedor nem tem papel de diretor/assistente de vendas. Fale com o gestor para liberar o acesso." /></Shell>

  return (
    <Shell {...{ area, router }}>
      {/* presets */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 8, overflowX: 'auto', paddingBottom: 2, WebkitOverflowScrolling: 'touch' }}>
        {PRESETS.map(p => <button key={p.v} onClick={() => aplicarPreset(p.v)} style={{ ...chip(preset === p.v), flex: '0 0 auto' }}>{p.l}</button>)}
        <button onClick={() => aplicarPreset('custom')} style={{ ...chip(preset === 'custom'), flex: '0 0 auto' }}>Personalizado</button>
      </div>

      {/* granularidade + datas/range + (líder) seletor de vendedor */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'inline-flex', gap: 3, background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: 3 }}>
          {GRANS.map(g => <button key={g.v} onClick={() => { setGran(g.v); setPreset('custom') }} style={pill(gran === g.v)}>{g.l}</button>)}
        </div>
        {ehLider && (
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <select value={vendedor ?? ''} onChange={e => setVendedor(e.target.value || null)} style={{ appearance: 'none', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: '7px 28px 7px 12px', fontSize: 12.5, fontWeight: 600, color: ESP, background: '#fff', cursor: 'pointer' }}>
              <option value="">Todos os vendedores</option>
              {(ranking?.ranking ?? []).map(v => <option key={v.cod_vend_comp} value={v.cod_vend_comp}>{v.vendedor || v.cod_vend_comp}</option>)}
            </select>
            <ChevronDown size={14} style={{ position: 'absolute', right: 9, color: MUT, pointerEvents: 'none' }} />
          </span>
        )}
        {escopo === 'vendedor' && <span style={{ fontSize: 11.5, fontWeight: 600, color: GOLD, background: '#F3E6C9', borderRadius: 999, padding: '5px 11px' }}>Vendo apenas minhas vendas</span>}
        <span style={{ flex: 1 }} />
        {preset === 'custom' ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: MUT, fontSize: 12 }}>De</span>
            <input type="date" value={de} onChange={e => setDe(e.target.value)} style={inpDataSm} />
            <span style={{ color: MUT, fontSize: 12 }}>até</span>
            <input type="date" value={ate} onChange={e => setAte(e.target.value)} style={inpDataSm} />
          </span>
        ) : <span style={{ fontSize: 12, fontWeight: 600, color: ESP, whiteSpace: 'nowrap' }}>{rangeLabel(de, ate)}</span>}
      </div>

      {nomeVend && <div style={{ fontSize: 12.5, color: ESP, marginBottom: 10 }}>Filtrando por <strong>{nomeVend}</strong> · <button onClick={() => setVendedor(null)} style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontWeight: 700, padding: 0 }}>ver todos</button></div>}

      {loading && !kpis ? <div style={{ color: MUT, fontSize: 13 }}>Carregando os números…</div> : (
        <>
          {/* KPIs — comparativo vs período anterior */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
            <KpiCard label="Faturamento" valor={brl(kpis?.faturamento ?? null)} d={delta(kpis?.faturamento, kpisAnt?.faturamento)} />
            <KpiCard label="Volume" valor={`${nf(kpis?.volume_kg ?? null, 0)} kg`} d={delta(kpis?.volume_kg, kpisAnt?.volume_kg)} />
            <KpiCard label="Clientes" valor={nf(kpis?.clientes ?? null, 0)} d={delta(kpis?.clientes, kpisAnt?.clientes)} />
            <KpiCard label="Ticket / kg" valor={kpis?.ticket_kg != null ? `${brl(kpis.ticket_kg)}/kg` : '—'} d={delta(kpis?.ticket_kg, kpisAnt?.ticket_kg)} />
            <KpiCard label="Ticket / cliente" valor={brl(kpis?.ticket_cliente ?? null)} d={delta(kpis?.ticket_cliente, kpisAnt?.ticket_cliente)} />
            {lucroConfiavel ? <>
              <KpiCard label="Lucro" valor={brl(kpis?.lucro ?? null)} d={delta(kpis?.lucro, kpisAnt?.lucro)} />
              <KpiCard label="Margem" valor={kpis?.margem_pct != null ? `${nf(kpis.margem_pct, 1)}%` : '—'} d={delta(kpis?.margem_pct, kpisAnt?.margem_pct)} />
            </> : <>
              <KpiPendente label="Lucro" />
              <KpiPendente label="Margem" />
            </>}
          </div>

          {/* Série temporal */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Série · {metrica === 'faturamento' ? 'Faturamento' : 'Volume (kg)'} ({GRANS.find(g => g.v === gran)?.l})</span>
              <div style={{ display: 'inline-flex', gap: 3, background: BG, borderRadius: 999, padding: 2 }}>
                <button onClick={() => setMetrica('faturamento')} style={pill(metrica === 'faturamento')}>R$</button>
                <button onClick={() => setMetrica('volume_kg')} style={pill(metrica === 'volume_kg')}>kg</button>
              </div>
            </div>
            {(serie?.serie ?? []).length === 0 ? <div style={{ color: MUT, fontSize: 12.5, padding: '10px 0' }}>Sem movimento no período.</div> : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 160, overflowX: 'auto' }}>
                {(serie?.serie ?? []).map((s, i) => { const v = s[metrica] ?? 0; return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 36 }}>
                    <div style={{ fontSize: 8.5, color: MUT, whiteSpace: 'nowrap' }}>{v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}</div>
                    <div title={`${perLabel(s.periodo, gran)}: ${metrica === 'faturamento' ? brl(v) : nf(v, 0) + ' kg'}`} style={{ width: 24, height: `${Math.max(3, (v / maxSerie) * 118)}px`, background: GOLD, borderRadius: '4px 4px 0 0' }} />
                    <div style={{ fontSize: 8.5, color: MUT, whiteSpace: 'nowrap' }}>{perLabel(s.periodo, gran)}</div>
                  </div>) })}
              </div>
            )}
          </Card>

          {/* Pareto (cliente/vendedor/supervisor/filial) com % acumulado */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Concentração (Pareto) por {DIMS.find(x => x.v === dim)?.l}</span>
              <div style={{ display: 'inline-flex', gap: 3, background: BG, borderRadius: 999, padding: 2 }}>
                {DIMS.map(x => <button key={x.v} onClick={() => setDim(x.v)} style={pill(dim === x.v)}>{x.l}</button>)}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {(pareto?.itens ?? []).slice(0, 15).map((p, i) => (
                <div key={p.rotulo + i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 18, fontSize: 11, color: MUT, textAlign: 'right' }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12.5, color: ESP, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.rotulo}</span>
                      <span style={{ fontSize: 12.5, color: ESP, fontWeight: 700, whiteSpace: 'nowrap' }}>{brl(p.valor)} <span style={{ color: MUT, fontWeight: 500 }}>· {nf(p.pct, 1)}%</span></span>
                    </div>
                    <div style={{ position: 'relative', height: 6, borderRadius: 999, background: LINE, marginTop: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, p.pct)}%`, height: '100%', background: GOLD }} />
                    </div>
                    <div style={{ fontSize: 10, color: MUT, marginTop: 1 }}>acumulado {nf(p.pct_acumulado, 1)}%</div>
                  </div>
                </div>
              ))}
              {(pareto?.itens ?? []).length === 0 && <div style={{ color: MUT, fontSize: 12.5 }}>Sem movimento no período.</div>}
            </div>
          </Card>

          {/* Ranking de vendedores (só líder) */}
          {ehLider && (ranking?.ranking ?? []).length > 0 && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 10 }}>Ranking de vendedores</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr style={{ color: MUT, textAlign: 'right' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Vendedor</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600 }}>Faturamento</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600 }}>Volume</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600 }}>Clientes</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600 }}>Margem</th>
                  </tr></thead>
                  <tbody>
                    {(ranking?.ranking ?? []).map((v, i) => (
                      <tr key={v.cod_vend_comp} style={{ borderTop: `0.5px solid ${LINE}`, cursor: 'pointer' }} onClick={() => setVendedor(v.cod_vend_comp)}>
                        <td style={{ textAlign: 'left', padding: '6px 8px', color: ESP, fontWeight: 600 }}>{i + 1}. {v.vendedor || v.cod_vend_comp}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px', color: ESP, fontWeight: 700 }}>{brl(v.faturamento)}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px', color: MUT }}>{nf(v.volume_kg, 0)} kg</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px', color: MUT }}>{nf(v.clientes, 0)}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px', color: MUT }}>{v.margem_pct != null ? `${nf(v.margem_pct, 1)}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ranking?.lucro_status !== 'ok' && <div style={{ fontSize: 10.5, color: MUT, marginTop: 6 }}>Margem por vendedor aguardando dado confiável de lucro na origem.</div>}
            </Card>
          )}

          {/* Cards honestos "aguardando dados" (RD-58/RD-51) — nada de "Previsto" fake */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8, marginTop: 4 }}>
            <TierCard titulo="Cidades atendidas" motivo="Aguardando cidade/UF do cliente no conector ATAK." />
            <TierCard titulo="Pareto por cidade" motivo="Aguardando o cadastro de cidade do cliente no conector." />
            <TierCard titulo="KG e R$/kg por produto" motivo="Aguardando o faturamento por produto (linha-a-linha) no conector." />
          </div>
        </>
      )}
    </Shell>
  )
}

function KpiCard({ label, valor, d }: { label: string; valor: string; d: { pct: number; up: boolean } | null }) {
  return (
    <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: '13px 15px' }}>
      <div style={{ fontSize: 19, fontWeight: 700, color: ESP, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 3 }}>
        <span style={{ fontSize: 11.5, color: MUT }}>{label}</span>
        {d && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10.5, fontWeight: 700, color: d.up ? GREEN : RED }}>{d.up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{nf(d.pct, 1)}%</span>}
      </div>
    </div>
  )
}
function KpiPendente({ label }: { label: string }) {
  return (
    <div style={{ background: '#FBF3DE', border: `0.5px dashed ${GOLD}`, borderRadius: 12, padding: '13px 15px' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 800, color: '#8A6A1E', textTransform: 'uppercase', letterSpacing: 0.3 }}><Clock size={11} /> aguardando</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 10.5, color: MUT, marginTop: 2 }}>LUCRO da origem ATAK inconsistente — sem número falso.</div>
    </div>
  )
}
function TierCard({ titulo, motivo }: { titulo: string; motivo: string }) {
  return (
    <div style={{ background: '#FBF3DE', border: `0.5px dashed ${GOLD}`, borderRadius: 12, padding: 13 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: '#8A6A1E', textTransform: 'uppercase', letterSpacing: 0.4 }}><Clock size={12} /> aguardando dados</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginTop: 5 }}>{titulo}</div>
      <div style={{ fontSize: 11.5, color: MUT, marginTop: 2 }}>{motivo}</div>
    </div>
  )
}

function Shell({ children, area, router }: { children: React.ReactNode; area: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px clamp(14px, 4vw, 40px)' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <button onClick={() => router.push(`/dashboard/inteligencia?area=${area}`)} style={{ background: 'transparent', border: 'none', color: MUT, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 12 }}>← Análise de dados</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: '#F3E6C9', color: GOLD, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><TrendingUp size={20} /></span>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, color: ESP, margin: 0 }}>Comercial</h1>
            <div style={{ fontSize: 11.5, color: MUT }}>Faturamento · volume · clientes · concentração — dados ATAK</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
function Card({ children }: { children: React.ReactNode }) { return <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>{children}</div> }
function Vazio({ t, l }: { t: string; l: string }) { return <div style={{ background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 14, padding: '30px 20px', textAlign: 'center' }}><div style={{ fontSize: 15, fontWeight: 600, color: ESP }}>{t}</div><div style={{ fontSize: 13, color: MUT, marginTop: 4 }}>{l}</div></div> }
const pill = (on: boolean): React.CSSProperties => ({ fontSize: 11.5, fontWeight: 700, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', border: 'none', background: on ? GOLD : 'transparent', color: on ? '#fff' : MUT })
const chip = (on: boolean): React.CSSProperties => ({ fontSize: 11.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', border: `0.5px solid ${on ? GOLD : LINE}`, background: on ? GOLD : '#fff', color: on ? '#fff' : ESP })
const inpDataSm: React.CSSProperties = { border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '5px 8px', fontSize: 12.5, color: ESP, background: '#fff', width: 140, maxWidth: '40vw' }

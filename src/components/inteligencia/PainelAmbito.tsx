'use client'
// SPEC · Painel GENÉRICO de âmbito do BI — serve todos os boxes (comercial, abate, …) com um só código.
// Lê fn_ind_ambito_painel (KPIs + série + pivot, sobre a fonte canônica do âmbito, respeitando escopo) +
// fn_ind_ambito_metas (semáforo). Tiers "aguardando dados" honestos (RD-51). Design #819, mobile.
// FIX #933: presets de período (default "Mês atual"), layout full-width, indicadores fiéis ao Excel.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { RefreshCw, Target, BarChart3, Clock } from 'lucide-react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', GREEN = '#166534', RED = '#A32D2D', AMBER = '#B45309'
const brl = (n: number | null) => n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const nf = (n: number | null, d = 0) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: d })
const iso = (d: Date) => d.toISOString().slice(0, 10)
const perLabel = (s: string, gran: string) => { try { const d = new Date(s + 'T00:00:00'); if (gran === 'ano') return String(d.getFullYear()); if (gran === 'mes') return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) } catch { return s } }
function fmt(v: number | null, un: string | null): string {
  if (v == null) return '—'
  const u = un || ''
  if (u.startsWith('BRL')) return u === 'BRL/kg' ? `${brl(v)}/kg` : brl(v)
  if (u === 'kg') return `${nf(v, 0)} kg`
  if (u === '%') return `${nf(v, 1)}%`
  if (u === '@') return `${nf(v, 1)} @`
  if (u === 'cabeças' || u === 'un' || u === 'cab/h' || u === 'contagem') return nf(v, 0)
  return nf(v, 2)
}

type Kpi = { codigo: string; nome: string; sigla: string; unidade: string | null; direcao_boa: string | null; valor: number | null }
type SerieP = { periodo: string; valor: number | null }
type Pivot = { chave: string; nome: string; valor: number | null; pct: number }
type DimOpt = { v: string; l: string }
type Painel = { ok?: boolean; erro?: string; gran: string; dim: string; dims: DimOpt[]; indicador_serie: string; unidade_serie: string | null; kpis: Kpi[]; serie: SerieP[]; pivot: Pivot[] }
type Meta = { codigo: string; nome: string; sigla: string; unidade: string | null; direcao_boa: string | null; realizado: number | null; meta: number | null; semaforo: string }
export type TierAguardando = { titulo: string; motivo: string }

const GRANS = [{ v: 'dia', l: 'Dia' }, { v: 'semana', l: 'Semana' }, { v: 'mes', l: 'Mês' }, { v: 'ano', l: 'Ano' }]
const semCor: Record<string, string> = { verde: GREEN, amarelo: AMBER, vermelho: RED, neutro: MUT, sem_meta: MUT }

// Presets de período (FIX ponto 1): default "Mês atual", granularidade coerente a cada atalho.
const addD = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const som = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const sow = (d: Date) => addD(d, -((d.getDay() + 6) % 7)) // segunda-feira
type Preset = { v: string; l: string; range: () => { de: string; ate: string; gran: string } }
const PRESETS: Preset[] = [
  { v: 'mes', l: 'Mês atual', range: () => { const h = new Date(); return { de: iso(som(h)), ate: iso(h), gran: 'dia' } } },
  { v: 'hoje', l: 'Hoje', range: () => { const h = new Date(); return { de: iso(h), ate: iso(h), gran: 'dia' } } },
  { v: 'semana', l: 'Semana atual', range: () => { const h = new Date(); return { de: iso(sow(h)), ate: iso(h), gran: 'dia' } } },
  { v: 'd7', l: 'Últimos 7 dias', range: () => { const h = new Date(); return { de: iso(addD(h, -6)), ate: iso(h), gran: 'dia' } } },
  { v: 'd30', l: 'Últimos 30 dias', range: () => { const h = new Date(); return { de: iso(addD(h, -29)), ate: iso(h), gran: 'dia' } } },
  { v: 'd90', l: 'Últimos 90 dias', range: () => { const h = new Date(); return { de: iso(addD(h, -89)), ate: iso(h), gran: 'semana' } } },
  { v: 'ano', l: 'Ano atual', range: () => { const h = new Date(); return { de: iso(new Date(h.getFullYear(), 0, 1)), ate: iso(h), gran: 'mes' } } },
]
// Rótulo compacto do intervalo aplicado (FIX v2): "01–10/08/2026" · sem timezone (lê o ISO direto).
function rangeLabel(de: string, ate: string): string {
  const [ay, am, ad] = de.split('-'), [by, bm, bd] = ate.split('-')
  if (de === ate) return `${ad}/${am}/${ay}`
  if (ay === by && am === bm) return `${ad}–${bd}/${bm}/${by}`
  if (ay === by) return `${ad}/${am}–${bd}/${bm}/${by}`
  return `${ad}/${am}/${ay}–${bd}/${bm}/${by}`
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

export function PainelAmbito(props: { ambito: string; titulo: string; subtitulo: string; icone: React.ReactNode; tiers?: TierAguardando[]; podeSync?: boolean }) {
  return <Suspense fallback={<div style={{ background: BG, minHeight: '100vh', padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>}><Inner {...props} /></Suspense>
}

function Inner({ ambito, titulo, subtitulo, icone, tiers = [], podeSync }: { ambito: string; titulo: string; subtitulo: string; icone: React.ReactNode; tiers?: TierAguardando[]; podeSync?: boolean }) {
  const router = useRouter()
  const sp = useSearchParams()
  const area = sp.get('area') === 'agro' ? 'agro' : 'industrial'
  const companyId = useCompanyId()
  const [de, setDe] = useState(() => PRESETS[0].range().de)
  const [ate, setAte] = useState(() => PRESETS[0].range().ate)
  const [gran, setGran] = useState(() => PRESETS[0].range().gran)
  const [preset, setPreset] = useState('mes')
  const [dim, setDim] = useState<string | null>(null)
  const [indicador, setIndicador] = useState<string | null>(null)
  const [d, setD] = useState<Painel | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'painel' | 'metas'>('painel')
  const [sinc, setSinc] = useState(false)

  const aplicarPreset = (p: string) => {
    const found = PRESETS.find(x => x.v === p)
    if (!found) { setPreset('custom'); return }
    const r = found.range(); setDe(r.de); setAte(r.ate); setGran(r.gran); setPreset(p)
  }

  const carregar = useCallback(async (cid: string) => {
    setLoading(true)
    const { data } = await supabase.rpc('fn_ind_ambito_painel', { p_company_id: cid, p_ambito: ambito, p_de: de, p_ate: ate, p_gran: gran, p_dim: dim, p_indicador: indicador })
    setD(data as Painel | null); setLoading(false)
  }, [ambito, de, ate, gran, dim, indicador])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (companyId) void carregar(companyId) }, [companyId, carregar])

  const sincronizar = async () => { if (!companyId) return; setSinc(true); await supabase.rpc('fn_ind_venda_sync', { p_company_id: companyId }); setSinc(false); void carregar(companyId) }

  const maxSerie = useMemo(() => Math.max(1, ...(d?.serie ?? []).map(s => s.valor ?? 0)), [d])
  const serieKpi = (d?.kpis ?? []).find(k => k.codigo === d?.indicador_serie)

  if (!companyId) return <Shell {...{ area, router, titulo, subtitulo, icone }}><Vazio t="Escolha uma empresa" l="Selecione uma empresa industrial específica no topo do menu." /></Shell>
  if (d && d.ok === false) return <Shell {...{ area, router, titulo, subtitulo, icone }}><Vazio t="Sem acesso a este setor" l="Você não tem escopo para este âmbito. Fale com o gestor para liberar (escopo por setor)." /></Shell>

  const semDados = d && (d.kpis ?? []).length > 0 && (d.kpis ?? []).every(k => (k.valor ?? 0) === 0)

  return (
    <Shell {...{ area, router, titulo, subtitulo, icone }}>
      {/* Linha 1 · presets (chips) — scrolláveis no mobile, cabem no desktop (FIX v2) */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 8, overflowX: 'auto', paddingBottom: 2, WebkitOverflowScrolling: 'touch' }}>
        {PRESETS.map(p => <button key={p.v} onClick={() => aplicarPreset(p.v)} style={{ ...chip(preset === p.v), flex: '0 0 auto' }}>{p.l}</button>)}
        <button onClick={() => aplicarPreset('custom')} style={{ ...chip(preset === 'custom'), flex: '0 0 auto' }}>Personalizado</button>
      </div>

      {/* Linha 2 · granularidade + (só em Personalizado) datas compactas / senão rótulo do range + Atualizar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'inline-flex', gap: 3, background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: 3 }}>
          {GRANS.map(g => <button key={g.v} onClick={() => { setGran(g.v); setPreset('custom') }} style={pill(gran === g.v)}>{g.l}</button>)}
        </div>
        <span style={{ flex: 1 }} />
        {preset === 'custom' ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: MUT, fontSize: 12 }}>De</span>
            <input type="date" value={de} onChange={e => setDe(e.target.value)} style={inpDataSm} />
            <span style={{ color: MUT, fontSize: 12 }}>até</span>
            <input type="date" value={ate} onChange={e => setAte(e.target.value)} style={inpDataSm} />
          </span>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: ESP, whiteSpace: 'nowrap' }}>{rangeLabel(de, ate)}</span>
        )}
        {podeSync && <button onClick={() => void sincronizar()} disabled={sinc} title="Reprocessar o canônico a partir do conector" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: '6px 11px', fontSize: 12, fontWeight: 600, color: ESP, cursor: 'pointer' }}><RefreshCw size={13} style={sinc ? { animation: 'spin 1s linear infinite' } : undefined} /> Atualizar</button>}
      </div>

      {/* abas Painel/Metas — segmentadas, compactas */}
      <div style={{ display: 'inline-flex', gap: 3, background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: 3, marginBottom: 12 }}>
        <button onClick={() => setTab('painel')} style={seg(tab === 'painel')}><BarChart3 size={13} /> Painel</button>
        <button onClick={() => setTab('metas')} style={seg(tab === 'metas')}><Target size={13} /> Metas</button>
      </div>

      {loading && !d ? <div style={{ color: MUT, fontSize: 13 }}>Carregando os números…</div>
      : semDados ? <Vazio t="Sem dados no período" l="Ajuste o período ou verifique o conector." />
      : tab === 'painel' ? (
        <>
          {/* KPIs — grade que preenche a largura (FIX ponto 2) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
            {(d?.kpis ?? []).map(k => (
              <button key={k.codigo} onClick={() => setIndicador(k.codigo)} style={{ all: 'unset', cursor: 'pointer', background: '#fff', border: `0.5px solid ${d?.indicador_serie === k.codigo ? GOLD : LINE}`, borderRadius: 12, padding: '13px 15px' }}>
                <div style={{ fontSize: 19, fontWeight: 700, color: ESP, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{fmt(k.valor, k.unidade)}</div>
                <div style={{ fontSize: 11.5, color: MUT, marginTop: 3 }}>{k.nome}</div>
              </button>
            ))}
          </div>

          {/* Série + Concentração lado a lado quando couber (FIX ponto 2) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 10 }}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 10 }}>Série · {serieKpi?.nome ?? d?.indicador_serie} ({GRANS.find(g => g.v === gran)?.l})</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150, overflowX: 'auto' }}>
                {(d?.serie ?? []).map((s, i) => { const v = s.valor ?? 0; return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 34 }}>
                    <div style={{ fontSize: 8.5, color: MUT, whiteSpace: 'nowrap' }}>{v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}</div>
                    <div title={`${perLabel(s.periodo, gran)}: ${fmt(v, d?.unidade_serie ?? null)}`} style={{ width: 22, height: `${Math.max(3, (v / maxSerie) * 112)}px`, background: GOLD, borderRadius: '4px 4px 0 0' }} />
                    <div style={{ fontSize: 8.5, color: MUT, whiteSpace: 'nowrap' }}>{perLabel(s.periodo, gran)}</div>
                  </div>) })}
              </div>
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Concentração por {(d?.dims ?? []).find(x => x.v === d?.dim)?.l ?? d?.dim}</span>
                <div style={{ display: 'inline-flex', gap: 3, background: BG, borderRadius: 999, padding: 2 }}>
                  {(d?.dims ?? []).map(x => <button key={x.v} onClick={() => setDim(x.v)} style={pill(d?.dim === x.v)}>{x.l}</button>)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(d?.pivot ?? []).map((p, i) => (
                  <div key={p.chave + i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 18, fontSize: 11, color: MUT, textAlign: 'right' }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 12.5, color: ESP, fontWeight: 600 }} className="truncate">{p.nome}</span>
                        <span style={{ fontSize: 12.5, color: ESP, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(p.valor, serieKpi?.unidade ?? d?.unidade_serie ?? null)} <span style={{ color: MUT, fontWeight: 500 }}>· {p.pct}%</span></span>
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: LINE, marginTop: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, p.pct)}%`, height: '100%', background: GOLD }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {tiers.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8, marginTop: 10 }}>
              {tiers.map((t, i) => (
                <div key={i} style={{ background: '#FBF3DE', border: `0.5px dashed ${GOLD}`, borderRadius: 12, padding: 13 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: '#8A6A1E', textTransform: 'uppercase', letterSpacing: 0.4 }}><Clock size={12} /> aguardando dados</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginTop: 5 }}>{t.titulo}</div>
                  <div style={{ fontSize: 11.5, color: MUT, marginTop: 2 }}>{t.motivo}</div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : <MetasTab companyId={companyId} ambito={ambito} />}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </Shell>
  )
}

function MetasTab({ companyId, ambito }: { companyId: string; ambito: string }) {
  const now = new Date()
  const [ano, setAno] = useState(now.getFullYear())
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [metas, setMetas] = useState<Meta[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Record<string, string>>({})
  const carregar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('fn_ind_ambito_metas', { p_company_id: companyId, p_ambito: ambito, p_ano: ano, p_mes: mes })
    setMetas((data as Meta[] | null) ?? []); setLoading(false)
  }, [companyId, ambito, ano, mes])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  const salvar = async (codigo: string) => {
    const v = Number((edit[codigo] ?? '').replace(/\./g, '').replace(',', '.'))
    if (!isFinite(v)) return
    await supabase.rpc('fn_ind_meta_salvar', { p_company_id: companyId, p_codigo: codigo, p_ano: ano, p_mes: mes, p_meta: v })
    setEdit(s => { const n = { ...s }; delete n[codigo]; return n }); void carregar()
  }
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <select value={mes} onChange={e => setMes(Number(e.target.value))} style={inpData}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2000, i, 1).toLocaleDateString('pt-BR', { month: 'long' })}</option>)}</select>
        <select value={ano} onChange={e => setAno(Number(e.target.value))} style={inpData}>{[now.getFullYear(), now.getFullYear() - 1].map(a => <option key={a} value={a}>{a}</option>)}</select>
      </div>
      {loading ? <div style={{ color: MUT, fontSize: 13 }}>Carregando…</div> : metas.length === 0 ? <Vazio t="Sem indicadores com dado" l="Os indicadores com fonte de dado aparecem aqui para cadastrar meta." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 8 }}>
          {metas.map(m => (
            <Card key={m.codigo}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>{m.nome} <span style={{ fontSize: 11, color: MUT }}>({m.unidade || '—'})</span></div>
                  <div style={{ fontSize: 12, color: MUT }}>Realizado: <strong style={{ color: ESP }}>{fmt(m.realizado, m.unidade)}</strong>{m.meta != null ? ` · meta ${fmt(m.meta, m.unidade)}` : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 999, background: semCor[m.semaforo] ?? MUT }} title={m.semaforo} />
                  <input value={edit[m.codigo] ?? (m.meta != null ? String(m.meta) : '')} onChange={e => setEdit(s => ({ ...s, [m.codigo]: e.target.value }))} placeholder="meta" inputMode="decimal" style={{ width: 90, border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '6px 8px', fontSize: 13, color: ESP, textAlign: 'right' }} />
                  <button onClick={() => void salvar(m.codigo)} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Salvar</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function Shell({ children, area, router, titulo, subtitulo, icone }: { children: React.ReactNode; area: string; router: ReturnType<typeof useRouter>; titulo: string; subtitulo: string; icone: React.ReactNode }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px clamp(14px, 4vw, 40px)' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <button onClick={() => router.push(`/dashboard/inteligencia?area=${area}`)} style={{ background: 'transparent', border: 'none', color: MUT, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 12 }}>← Análise de dados</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: '#F3E6C9', color: GOLD, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{icone}</span>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, color: ESP, margin: 0 }}>{titulo}</h1>
            <div style={{ fontSize: 11.5, color: MUT }}>{subtitulo}</div>
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
const seg = (on: boolean): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, padding: '6px 14px', borderRadius: 999, cursor: 'pointer', border: 'none', background: on ? GOLD : 'transparent', color: on ? '#fff' : MUT })
const inpData: React.CSSProperties = { border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, color: ESP, background: '#fff' }
const inpDataSm: React.CSSProperties = { border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '5px 8px', fontSize: 12.5, color: ESP, background: '#fff', width: 140, maxWidth: '40vw' }

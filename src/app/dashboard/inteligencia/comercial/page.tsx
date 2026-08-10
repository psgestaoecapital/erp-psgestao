'use client'
// SPEC · BI Comercial (piloto do motor genérico). Fonte-agnóstico: lê o CANÔNICO ind_venda (não o
// ind_atak_fato). Período honesto por box (comercial começa em dia), pivots por vendedor/supervisor/filial,
// aba Metas com semáforo, escopo RBAC (fail-closed) e Tiers 2/3 "aguardando dados" (RD-51). Design #819.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { TrendingUp, RefreshCw, Target, BarChart3, Clock } from 'lucide-react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', GREEN = '#166534', RED = '#A32D2D', AMBER = '#B45309'
const brl = (n: number | null) => n == null ? '—' : (n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const kg = (n: number | null) => n == null ? '—' : `${(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`
const num = (n: number | null, d = 0) => n == null ? '—' : (n).toLocaleString('pt-BR', { maximumFractionDigits: d })
const iso = (d: Date) => d.toISOString().slice(0, 10)
const perLabel = (s: string, gran: string) => { try { const d = new Date(s + 'T00:00:00'); if (gran === 'ano') return String(d.getFullYear()); if (gran === 'mes') return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) } catch { return s } }

type Kpis = { kg: number; rs: number; clientes: number; lucro: number; rs_kg: number | null; margem: number | null; ticket: number | null; mix: number; n_vendas: number }
type SerieP = { periodo: string; kg: number; rs: number }
type Pivot = { chave: string; nome: string; kg: number; rs: number; lucro: number; clientes: number; pct_kg: number; pct_rs: number }
type Painel = { ok?: boolean; erro?: string; kpis: Kpis; serie: SerieP[]; pivot: Pivot[] }
type Meta = { codigo: string; nome: string; sigla: string; unidade: string | null; direcao_boa: string | null; realizado: number | null; meta: number | null; semaforo: string }

const GRANS = [{ v: 'dia', l: 'Dia' }, { v: 'semana', l: 'Semana' }, { v: 'mes', l: 'Mês' }, { v: 'ano', l: 'Ano' }]
const DIMS = [{ v: 'vendedor', l: 'Vendedor' }, { v: 'supervisor', l: 'Supervisor' }, { v: 'filial', l: 'Filial' }]
const semCor: Record<string, string> = { verde: GREEN, amarelo: AMBER, vermelho: RED, neutro: MUT, sem_meta: MUT }

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
  return <Suspense fallback={<div style={{ background: BG, minHeight: '100vh', padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>}><Comercial /></Suspense>
}

function Comercial() {
  const router = useRouter()
  const sp = useSearchParams()
  const area = sp.get('area') === 'agro' ? 'agro' : 'industrial'
  const companyId = useCompanyId()
  const hoje = new Date()
  const [de, setDe] = useState(iso(new Date(hoje.getFullYear() - 1, hoje.getMonth(), 1)))
  const [ate, setAte] = useState(iso(hoje))
  const [gran, setGran] = useState('mes')
  const [dim, setDim] = useState('vendedor')
  const [metric, setMetric] = useState<'rs' | 'kg'>('rs')
  const [tab, setTab] = useState<'painel' | 'metas'>('painel')
  const [d, setD] = useState<Painel | null>(null)
  const [loading, setLoading] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)

  const carregar = useCallback(async (cid: string) => {
    setLoading(true)
    const { data } = await supabase.rpc('fn_ind_comercial_painel', { p_company_id: cid, p_de: de, p_ate: ate, p_gran: gran, p_dim: dim })
    setD(data as Painel | null); setLoading(false)
  }, [de, ate, gran, dim])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (companyId) void carregar(companyId) }, [companyId, carregar])

  const sincronizar = async () => {
    if (!companyId) return
    setSincronizando(true)
    await supabase.rpc('fn_ind_venda_sync', { p_company_id: companyId })
    setSincronizando(false); void carregar(companyId)
  }

  const maxSerie = useMemo(() => Math.max(1, ...(d?.serie ?? []).map(s => metric === 'rs' ? s.rs : s.kg)), [d, metric])

  if (!companyId) return <Shell area={area} router={router}><Vazio t="Escolha uma empresa" l="Selecione uma empresa industrial específica no topo do menu." /></Shell>
  if (d && d.ok === false) return <Shell area={area} router={router}><Vazio t="Sem acesso a este setor" l="Você não tem escopo para o Comercial. Fale com o gestor para liberar (escopo por setor)." /></Shell>

  const k = d?.kpis
  const semDados = k && k.n_vendas === 0

  return (
    <Shell area={area} router={router}>
      {/* período + ações */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'inline-flex', gap: 3, background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: 3 }}>
          {GRANS.map(g => <button key={g.v} onClick={() => setGran(g.v)} style={pill(gran === g.v)}>{g.l}</button>)}
        </div>
        <span style={{ flex: 1 }} />
        <input type="date" value={de} onChange={e => setDe(e.target.value)} style={inpData} />
        <span style={{ color: MUT, fontSize: 12 }}>até</span>
        <input type="date" value={ate} onChange={e => setAte(e.target.value)} style={inpData} />
        <button onClick={() => void sincronizar()} disabled={sincronizando} title="Reprocessar o canônico a partir do conector ATAK" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: '7px 12px', fontSize: 12, fontWeight: 600, color: ESP, cursor: 'pointer' }}>
          <RefreshCw size={13} style={sincronizando ? { animation: 'spin 1s linear infinite' } : undefined} /> Atualizar
        </button>
      </div>

      {/* abas */}
      <div style={{ display: 'inline-flex', gap: 4, marginBottom: 14 }}>
        <button onClick={() => setTab('painel')} style={aba(tab === 'painel')}><BarChart3 size={14} /> Painel</button>
        <button onClick={() => setTab('metas')} style={aba(tab === 'metas')}><Target size={14} /> Metas</button>
      </div>

      {loading && !d ? <div style={{ color: MUT, fontSize: 13 }}>Carregando os números…</div>
      : semDados ? <Vazio t="Sem vendas no período" l="Ajuste o período ou clique em Atualizar para reprocessar o conector." />
      : tab === 'painel' ? (
        <>
          {/* KPIs Tier 1 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, marginBottom: 14 }}>
            <Kpi v={kg(k?.kg ?? 0)} l="Volume (KG)" />
            <Kpi v={brl(k?.rs ?? 0)} l="Faturamento" cor={GOLD} />
            <Kpi v={num(k?.clientes ?? 0)} l="Clientes" />
            <Kpi v={k?.rs_kg != null ? brl(k.rs_kg) : '—'} l="R$/kg" />
            <Kpi v={brl(k?.lucro ?? 0)} l="Lucro" />
            <Kpi v={k?.margem != null ? `${k.margem}%` : '—'} l="Margem" />
            <Kpi v={k?.ticket != null ? brl(k.ticket) : '—'} l="Ticket/cliente" />
            <Kpi v={num(k?.mix ?? 0, 2)} l="Mix" />
          </div>

          {/* série */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Série ({GRANS.find(g => g.v === gran)?.l})</span>
              <div style={{ display: 'inline-flex', gap: 3, background: BG, borderRadius: 999, padding: 2 }}>
                {(['rs', 'kg'] as const).map(m => <button key={m} onClick={() => setMetric(m)} style={pill(metric === m)}>{m === 'rs' ? 'R$' : 'KG'}</button>)}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 130, overflowX: 'auto' }}>
              {(d?.serie ?? []).map((s, i) => { const val = metric === 'rs' ? s.rs : s.kg; return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 34 }}>
                  <div style={{ fontSize: 8.5, color: MUT, whiteSpace: 'nowrap' }}>{metric === 'rs' ? (val >= 1000 ? `${Math.round(val / 1000)}k` : Math.round(val)) : Math.round(val)}</div>
                  <div title={`${perLabel(s.periodo, gran)}: ${metric === 'rs' ? brl(val) : kg(val)}`} style={{ width: 22, height: `${Math.max(3, (val / maxSerie) * 96)}px`, background: GOLD, borderRadius: '4px 4px 0 0' }} />
                  <div style={{ fontSize: 8.5, color: MUT, whiteSpace: 'nowrap' }}>{perLabel(s.periodo, gran)}</div>
                </div>) })}
            </div>
          </Card>

          {/* pivot */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Concentração por dimensão</span>
              <div style={{ display: 'inline-flex', gap: 3, background: BG, borderRadius: 999, padding: 2 }}>
                {DIMS.map(x => <button key={x.v} onClick={() => setDim(x.v)} style={pill(dim === x.v)}>{x.l}</button>)}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(d?.pivot ?? []).map((p, i) => (
                <div key={p.chave} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 18, fontSize: 11, color: MUT, textAlign: 'right' }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12.5, color: ESP, fontWeight: 600 }} className="truncate">{p.nome}</span>
                      <span style={{ fontSize: 12.5, color: ESP, fontWeight: 700, whiteSpace: 'nowrap' }}>{brl(p.rs)} <span style={{ color: MUT, fontWeight: 500 }}>· {p.pct_rs}%</span></span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: LINE, marginTop: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, p.pct_rs)}%`, height: '100%', background: GOLD }} />
                    </div>
                    <div style={{ fontSize: 10.5, color: MUT, marginTop: 2 }}>{kg(p.kg)} · {p.clientes} cliente(s)</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Tiers aguardando */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>
            <Aguardando titulo="Por cidade / cliente (apelido)" motivo="Aguardando o cadastro de clientes no conector (Tier 2)." />
            <Aguardando titulo="KG e R$/kg por produto" motivo="Aguardando o faturamento linha-a-linha (Tier 3)." />
          </div>
        </>
      ) : (
        <MetasTab companyId={companyId} />
      )}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </Shell>
  )
}

function MetasTab({ companyId }: { companyId: string }) {
  const now = new Date()
  const [ano, setAno] = useState(now.getFullYear())
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [metas, setMetas] = useState<Meta[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Record<string, string>>({})

  const carregar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('fn_ind_comercial_metas', { p_company_id: companyId, p_ano: ano, p_mes: mes })
    setMetas((data as Meta[] | null) ?? []); setLoading(false)
  }, [companyId, ano, mes])
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
      {loading ? <div style={{ color: MUT, fontSize: 13 }}>Carregando…</div> : metas.length === 0 ? <Vazio t="Sem indicadores com dado" l="Os indicadores comerciais com fonte de dado aparecem aqui para cadastrar meta." /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {metas.map(m => (
            <Card key={m.codigo}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>{m.nome} <span style={{ fontSize: 11, color: MUT }}>({m.unidade || '—'})</span></div>
                  <div style={{ fontSize: 12, color: MUT }}>Realizado: <strong style={{ color: ESP }}>{m.realizado == null ? '—' : num(m.realizado, 2)}</strong>{m.meta != null ? ` · meta ${num(m.meta, 2)}` : ''}</div>
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

function Shell({ children, area, router }: { children: React.ReactNode; area: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <button onClick={() => router.push(`/dashboard/inteligencia?area=${area}`)} style={{ background: 'transparent', border: 'none', color: MUT, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 12 }}>← Análise de dados</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: '#F3E6C9', color: GOLD, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><TrendingUp size={20} /></span>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, color: ESP, margin: 0 }}>Comercial</h1>
            <div style={{ fontSize: 11.5, color: MUT }}>Volume · faturamento · clientes · concentração — do canônico de vendas</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function Kpi({ v, l, cor }: { v: string; l: string; cor?: string }) {
  return <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: '11px 13px' }}>
    <div style={{ fontSize: 17, fontWeight: 700, color: cor || ESP, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
    <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>{l}</div>
  </div>
}
function Card({ children }: { children: React.ReactNode }) { return <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>{children}</div> }
function Vazio({ t, l }: { t: string; l: string }) { return <div style={{ background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 14, padding: '30px 20px', textAlign: 'center' }}><div style={{ fontSize: 15, fontWeight: 600, color: ESP }}>{t}</div><div style={{ fontSize: 13, color: MUT, marginTop: 4 }}>{l}</div></div> }
function Aguardando({ titulo, motivo }: { titulo: string; motivo: string }) {
  return <div style={{ background: '#FBF3DE', border: `0.5px dashed ${GOLD}`, borderRadius: 12, padding: 13 }}>
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: '#8A6A1E', textTransform: 'uppercase', letterSpacing: 0.4 }}><Clock size={12} /> aguardando dados</div>
    <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginTop: 5 }}>{titulo}</div>
    <div style={{ fontSize: 11.5, color: MUT, marginTop: 2 }}>{motivo}</div>
  </div>
}

const pill = (on: boolean): React.CSSProperties => ({ fontSize: 11.5, fontWeight: 700, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', border: 'none', background: on ? GOLD : 'transparent', color: on ? '#fff' : MUT })
const aba = (on: boolean): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 999, cursor: 'pointer', border: `0.5px solid ${on ? GOLD : LINE}`, background: on ? GOLD : '#fff', color: on ? '#fff' : ESP })
const inpData: React.CSSProperties = { border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, color: ESP, background: '#fff' }

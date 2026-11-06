'use client'
// SPEC · BI Comercial Frioeste — PR 2 (ATAK, dado já no banco). Painel DEDICADO sobre o raw ind_atak_fato
// (dom='comercial_venda_item') via a view bi_comercial_item_mv (AO VIVO, refresh a cada 30 min).
// ESTRUTURA DE ABAS (protótipo aprovado CEO 06/11): Visão geral · Vendedores · Clientes · Cidades · Produtos ·
//   Flex · Logística (placeholder) · Metas (placeholder). Cada aba abre com 1 frase de leitura automática,
//   MOSTRA TUDO (sem top-N: rolagem interna + cabeçalho fixo + busca + ordenação) e permite DRILL.
// RPCs: fn_bi_comercial_kpis/_serie/_pareto/_ranking_vendedores/_produtos/_status (Visão geral) e
//   fn_bi_comercial_analise (abas de análise). Gating fail-closed no servidor (RD-41): vendedor logado só vê o dele.
// LUCRO/MARGEM da origem ATAK está corrompido → não exibimos (RD-58). FLEX = % praticado abaixo do preço de tabela.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { TrendingUp, Clock, ChevronDown, ArrowUp, ArrowDown, Search, ArrowUpDown, Users, Building2, MapPin, Package, Percent, Truck, Target, ChevronRight } from 'lucide-react'

const ROTA = '/dashboard/inteligencia/comercial'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', GREEN = '#166534', RED = '#A32D2D', AMBER = '#B8860B'
const brl = (n: number | null) => n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const nf = (n: number | null, d = 0) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })
const brlCompact = (n: number | null) => n == null ? '—' : n >= 1e6 ? `R$ ${nf(n / 1e6, 1)} mi` : n >= 1e3 ? `R$ ${nf(n / 1e3, 0)} mil` : brl(n)
// Frescor do BI: a view materializada é recalculada a cada 30 min (cron bi_comercial_item_refresh). Mostramos a hora da
// última atualização para o gestor saber que o número é vivo (e não dado antigo). Hoje → "às HH:MM"; outro dia → data + hora.
const fmtAtualizado = (s: string | null): string | null => {
  if (!s) return null
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return null
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    const hoje = new Date()
    const mesmoDia = d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth() && d.getDate() === hoje.getDate()
    return mesmoDia ? `Atualizado às ${hora}` : `Atualizado em ${d.toLocaleDateString('pt-BR')} ${hora}`
  } catch { return null }
}
const iso = (d: Date) => d.toISOString().slice(0, 10)
const perLabel = (s: string, gran: string) => { try { const d = new Date(s + 'T00:00:00'); if (gran === 'ano') return String(d.getFullYear()); if (gran === 'trimestre') return `T${Math.floor(d.getMonth() / 3) + 1}/${String(d.getFullYear()).slice(2)}`; if (gran === 'mes') return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) } catch { return s } }
const diasAtras = (s: string | null): number | null => { if (!s) return null; try { const d = new Date(s + 'T00:00:00'); const h = new Date(); h.setHours(0, 0, 0, 0); return Math.max(0, Math.round((h.getTime() - d.getTime()) / 86400000)) } catch { return null } }
const dataBr = (s: string | null) => { if (!s) return '—'; try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') } catch { return s } }

type Kpis = { ok: boolean; erro?: string; escopo?: string; vendedor?: string | null; volume_kg: number; faturamento: number; clientes: number; cidades?: number; ticket_kg: number | null; ticket_cliente: number | null; faturamento_com_selecao?: number; volume_kg_com_selecao?: number; ticket_kg_com_selecao?: number | null; lucro: number | null; margem_pct: number | null; lucro_status: string }
type SerieP = { periodo: string; volume_kg: number; faturamento: number; margem_pct: number | null }
type Serie = { ok: boolean; granularidade: string; serie: SerieP[]; lucro_status: string }
type ParetoItem = { rotulo: string; valor: number; pct: number; pct_acumulado: number }
type Pareto = { ok: boolean; dimensao: string; itens: ParetoItem[] }
type RankItem = { cod_vend_comp: string; vendedor: string; volume_kg: number; faturamento: number; clientes: number; lucro: number | null; margem_pct: number | null }
type Ranking = { ok: boolean; erro?: string; ranking: RankItem[]; lucro_status: string }
type ProdStatus = 'entra' | 'fora' | 'a_classificar'
type Produto = { cod_produto: string; desc_produto: string; status: ProdStatus; kg: number; valor_total: number }
// aba de análise (fn_bi_comercial_analise)
type AnaliseItem = { rotulo: string | null; chave: string; kg: number; faturamento: number; rpkg: number | null; n_clientes: number; n_produtos: number; uf: string | null; ultima_compra: string | null; flex_pct: number | null; cargo?: string | null; filial?: string | null }
type Analise = { ok: boolean; erro?: string; dimensao: string; escopo?: string; itens: AnaliseItem[]; total: { n?: number; kg?: number; faturamento?: number; rpkg?: number | null; flex_pct?: number | null } }

// heurística: despojo/não comestível → candidato a "fora" (só sugere; a decisão é do usuário)
const RE_DESPOJO = /DESPOJO|COURO|SANGUE|DESCARTAD|RES[IÍ]DUO|SEBO|OSSO|GORDURA|VISCERA|V[IÍ]SCERA|UNHA|CASCO|CHIFRE|PENA|BUCHO|N[AÃ]O\s*COMEST/i
const ehDespojo = (d: string) => RE_DESPOJO.test(d || '')
const STATUS_LABEL: Record<ProdStatus, string> = { entra: 'Entra', a_classificar: 'A classificar', fora: 'Fora' }

const GRANS = [{ v: 'dia', l: 'Dia' }, { v: 'semana', l: 'Semana' }, { v: 'mes', l: 'Mês' }, { v: 'trimestre', l: 'Trimestre' }, { v: 'ano', l: 'Ano' }]
const DIMS = [{ v: 'cliente', l: 'Cliente' }, { v: 'cidade', l: 'Cidade' }, { v: 'produto', l: 'Produto' }, { v: 'vendedor', l: 'Vendedor' }, { v: 'supervisor', l: 'Supervisor' }, { v: 'filial', l: 'Filial' }]

// abas da tela (CEO 06/11)
type Aba = 'geral' | 'vendedores' | 'clientes' | 'cidades' | 'produtos' | 'flex' | 'logistica' | 'metas'
const ABAS: { v: Aba; l: string; icon: typeof Users }[] = [
  { v: 'geral', l: 'Visão geral', icon: TrendingUp },
  { v: 'vendedores', l: 'Vendedores', icon: Users },
  { v: 'clientes', l: 'Clientes', icon: Building2 },
  { v: 'cidades', l: 'Cidades', icon: MapPin },
  { v: 'produtos', l: 'Produtos', icon: Package },
  { v: 'flex', l: 'Flex', icon: Percent },
  { v: 'logistica', l: 'Logística', icon: Truck },
  { v: 'metas', l: 'Metas', icon: Target },
]

// Flex (% abaixo da tabela): positivo = vendeu abaixo da tabela (desconto). Semáforo pela magnitude do desconto.
const flexCor = (f: number | null | undefined): string => f == null ? MUT : f <= 1.5 ? GREEN : f <= 4 ? AMBER : RED
const flexTxt = (f: number | null | undefined): string => f == null ? '—' : f < 0 ? `${nf(Math.abs(f), 1)}% acima` : `${nf(f, 1)}% abaixo`

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
  const [aba, setAba] = useState<Aba>('geral')
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
  const [produtos, setProdutos] = useState<Produto[] | null>(null)
  const [salvandoCod, setSalvandoCod] = useState<string | null>(null)
  const [painelAberto, setPainelAberto] = useState(false)
  const [loading, setLoading] = useState(true)
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null) // hora do último refresh da MV (fn_bi_comercial_status)
  // Pareto MOSTRA TUDO (CEO): busca por rótulo + ordenação maior↔menor sobre a lista COMPLETA (sem top-N)
  const [paretoBusca, setParetoBusca] = useState('')
  const [paretoOrdem, setParetoOrdem] = useState<'desc' | 'asc'>('desc')

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
    const [k, ka, s, p, r, st] = await Promise.all([
      supabase.rpc('fn_bi_comercial_kpis', { p_company_id: cid, p_dt_ini: de, p_dt_fim: ate, p_vendedor: pv }),
      supabase.rpc('fn_bi_comercial_kpis', { p_company_id: cid, p_dt_ini: ant.de, p_dt_fim: ant.ate, p_vendedor: pv }),
      supabase.rpc('fn_bi_comercial_serie', { p_company_id: cid, p_dt_ini: de, p_dt_fim: ate, p_granularidade: gran, p_vendedor: pv }),
      supabase.rpc('fn_bi_comercial_pareto', { p_company_id: cid, p_dt_ini: de, p_dt_fim: ate, p_dimensao: dim, p_vendedor: pv }),
      supabase.rpc('fn_bi_comercial_ranking_vendedores', { p_company_id: cid, p_dt_ini: de, p_dt_fim: ate }),
      supabase.rpc('fn_bi_comercial_status', { p_company_id: cid }),
    ])
    setKpis(k.data as Kpis | null); setKpisAnt(ka.data as Kpis | null)
    setSerie(s.data as Serie | null); setPareto(p.data as Pareto | null)
    setRanking(r.data as Ranking | null)
    setAtualizadoEm((st.data as { ok?: boolean; atualizado_em?: string | null } | null)?.atualizado_em ?? null)
    setLoading(false)
  }, [de, ate, gran, dim, vendedor])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (companyId) void carregar(companyId) }, [companyId, carregar])

  // painel "Produtos no cálculo" — só para o líder (config da empresa); vendedor vê só os números
  const carregarProdutos = useCallback(async (cid: string) => {
    const { data } = await supabase.rpc('fn_bi_comercial_produtos', { p_company_id: cid, p_de: de, p_ate: ate })
    const d = data as { ok?: boolean; produtos?: Produto[] } | null
    setProdutos(d?.ok ? (d.produtos ?? []) : [])
  }, [de, ate])
  useEffect(() => { if (companyId && ehLider) void carregarProdutos(companyId) }, [companyId, ehLider, carregarProdutos])

  const classificar = useCallback(async (cod: string, status: ProdStatus) => {
    if (!companyId) return
    setSalvandoCod(cod)
    try {
      await supabase.rpc('fn_bi_comercial_produto_classificar', { p_company_id: companyId, p_cod_produto: cod, p_status: status })
      await Promise.all([carregar(companyId), carregarProdutos(companyId)]) // totais/KPIs e lista refletem a mudança
    } finally { setSalvandoCod(null) }
  }, [companyId, carregar, carregarProdutos])

  const aClassificar = (produtos ?? []).filter(p => p.status === 'a_classificar').length

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
      {/* frescor do BI: recalculado a cada 30 min; a hora prova ao gestor que o número é vivo (não dado antigo) */}
      {atualizadoEm && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <span
            title={`Os números são recalculados automaticamente a cada 30 minutos a partir da origem ATAK. Última atualização: ${(() => { try { return new Date(atualizadoEm).toLocaleString('pt-BR') } catch { return atualizadoEm } })()}.`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: MUT, background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: '4px 11px', cursor: 'default' }}
          >
            <Clock size={12} /> {fmtAtualizado(atualizadoEm)}
          </span>
        </div>
      )}

      {/* ABAS (CEO 06/11) — navegação no topo; rolagem horizontal no celular */}
      <div role="tablist" aria-label="Análises comerciais" style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 6, marginBottom: 12, borderBottom: `1px solid ${LINE}`, WebkitOverflowScrolling: 'touch' }}>
        {ABAS.map(a => { const Icon = a.icon; const on = aba === a.v; return (
          <button key={a.v} role="tab" aria-selected={on} onClick={() => setAba(a.v)}
            style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, padding: '8px 13px', borderRadius: '10px 10px 0 0', border: 'none', cursor: 'pointer', color: on ? ESP : MUT, background: on ? '#fff' : 'transparent', borderBottom: on ? `2px solid ${GOLD}` : '2px solid transparent', marginBottom: -1 }}>
            <Icon size={14} style={{ color: on ? GOLD : MUT }} /> {a.l}
          </button>
        ) })}
      </div>

      {/* FILTROS (valem em todas as abas): período + granularidade (série) + (líder) vendedor */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 8, overflowX: 'auto', paddingBottom: 2, WebkitOverflowScrolling: 'touch' }}>
        {PRESETS.map(p => <button key={p.v} onClick={() => aplicarPreset(p.v)} style={{ ...chip(preset === p.v), flex: '0 0 auto' }}>{p.l}</button>)}
        <button onClick={() => aplicarPreset('custom')} style={{ ...chip(preset === 'custom'), flex: '0 0 auto' }}>Personalizado</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {aba === 'geral' && (
          <div style={{ display: 'inline-flex', gap: 3, background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: 3 }}>
            {GRANS.map(g => <button key={g.v} onClick={() => { setGran(g.v); setPreset('custom') }} style={pill(gran === g.v)}>{g.l}</button>)}
          </div>
        )}
        {ehLider && (
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <select value={vendedor ?? ''} onChange={e => setVendedor(e.target.value || null)} aria-label="Filtrar por vendedor" style={{ appearance: 'none', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: '7px 28px 7px 12px', fontSize: 12.5, fontWeight: 600, color: ESP, background: '#fff', cursor: 'pointer' }}>
              <option value="">Todos os vendedores</option>
              {(ranking?.ranking ?? []).map(v => <option key={v.cod_vend_comp} value={v.cod_vend_comp}>{v.vendedor || v.cod_vend_comp}</option>)}
            </select>
            <ChevronDown size={14} style={{ position: 'absolute', right: 26, color: MUT, pointerEvents: 'none' }} />
            <AjudaCampo chave="comercial.bi.vendedor_sel" rota={ROTA} />
          </span>
        )}
        {escopo === 'vendedor' && <span style={{ fontSize: 11.5, fontWeight: 600, color: GOLD, background: '#F3E6C9', borderRadius: 999, padding: '5px 11px' }}>Vendo apenas minhas vendas</span>}
        <span style={{ flex: 1 }} />
        {preset === 'custom' ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: MUT, fontSize: 12 }}>De</span>
            <input type="date" value={de} onChange={e => setDe(e.target.value)} aria-label="Data inicial" style={inpDataSm} />
            <span style={{ color: MUT, fontSize: 12 }}>até</span>
            <input type="date" value={ate} onChange={e => setAte(e.target.value)} aria-label="Data final" style={inpDataSm} />
            <AjudaCampo chave="comercial.bi.periodo" rota={ROTA} />
          </span>
        ) : <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: ESP, whiteSpace: 'nowrap' }}>{rangeLabel(de, ate)}<AjudaCampo chave="comercial.bi.periodo" rota={ROTA} /></span>}
      </div>

      {nomeVend && <div style={{ fontSize: 12.5, color: ESP, marginBottom: 10 }}>Filtrando por <strong>{nomeVend}</strong> · <button onClick={() => setVendedor(null)} style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontWeight: 700, padding: 0 }}>ver todos</button></div>}

      {aba === 'geral' && (
        loading && !kpis ? <div style={{ color: MUT, fontSize: 13 }}>Carregando os números…</div> : (
        <>
          {/* DOIS TOTAIS no topo (CEO): "com seleção" (preço/margem limpos) × "faturamento total" (tudo, despojo não some) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10, marginBottom: 14 }}>
            <TotalTopo chave="comercial.bi.total_com_selecao" rotulo="Faturamento com seleção" valor={brl(kpis?.faturamento_com_selecao ?? null)} sub={`${nf(kpis?.volume_kg_com_selecao ?? null, 0)} kg · só produtos marcados “entra”`} destaque />
            <TotalTopo chave="comercial.bi.total_faturamento" rotulo="Faturamento total" valor={brl(kpis?.faturamento ?? null)} sub={`${nf(kpis?.volume_kg ?? null, 0)} kg · tudo, inclusive despojos${kpis && kpis.faturamento_com_selecao != null && kpis.faturamento > kpis.faturamento_com_selecao ? ` (despojos/a classificar: ${brl(kpis.faturamento - kpis.faturamento_com_selecao)})` : ''}`} />
          </div>

          {ehLider && <PainelProdutos produtos={produtos} aberto={painelAberto} setAberto={setPainelAberto} aClassificar={aClassificar} salvandoCod={salvandoCod} classificar={classificar} />}

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

          {/* Pareto (cliente/vendedor/supervisor/filial) com % acumulado — MOSTRA TUDO (CEO) */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Concentração (Pareto) por {DIMS.find(x => x.v === dim)?.l}</span>
              <div style={{ display: 'inline-flex', gap: 3, background: BG, borderRadius: 999, padding: 2 }}>
                {DIMS.map(x => <button key={x.v} onClick={() => setDim(x.v)} style={pill(dim === x.v)}>{x.l}</button>)}
              </div>
            </div>
            {(() => {
              const todos = pareto?.itens ?? []
              const termo = paretoBusca.trim().toLowerCase()
              let lista = todos.map((p, i) => ({ p, rk: i + 1 })).filter(({ p }) => !termo || (p.rotulo || '').toLowerCase().includes(termo))
              if (paretoOrdem === 'asc') lista = [...lista].reverse()
              return (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flex: '1 1 200px' }}>
                      <Search size={13} style={{ position: 'absolute', left: 9, color: MUT, pointerEvents: 'none' }} />
                      <input value={paretoBusca} onChange={e => setParetoBusca(e.target.value)} placeholder={`Buscar ${(DIMS.find(x => x.v === dim)?.l ?? '').toLowerCase()}…`} style={{ width: '100%', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: '6px 10px 6px 28px', fontSize: 12.5, color: ESP, background: '#fff' }} />
                      <AjudaCampo chave="comercial.bi.pareto_busca" rota={ROTA} />
                    </span>
                    <button onClick={() => setParetoOrdem(o => (o === 'desc' ? 'asc' : 'desc'))} style={{ ...chip(false), display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <ArrowUpDown size={12} /> {paretoOrdem === 'desc' ? 'Maior → menor' : 'Menor → maior'}
                    </button>
                    <span style={{ fontSize: 11.5, color: MUT, whiteSpace: 'nowrap' }}>{lista.length} de {todos.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
                    {lista.map(({ p, rk }) => (
                      <div key={p.rotulo + rk} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 24, fontSize: 11, color: MUT, textAlign: 'right' }}>{rk}</span>
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
                    {todos.length === 0 && <div style={{ color: MUT, fontSize: 12.5 }}>Sem movimento no período.</div>}
                    {todos.length > 0 && lista.length === 0 && <div style={{ color: MUT, fontSize: 12.5 }}>Nenhum resultado para “{paretoBusca}”.</div>}
                  </div>
                </>
              )
            })()}
          </Card>
        </>
        )
      )}

      {(aba === 'vendedores' || aba === 'clientes' || aba === 'cidades' || aba === 'produtos') && companyId && (
        <AbaAnalise key={aba} companyId={companyId} de={de} ate={ate} vendedor={vendedor} aba={aba} />
      )}
      {aba === 'flex' && companyId && <AbaFlex companyId={companyId} de={de} ate={ate} vendedor={vendedor} />}
      {aba === 'logistica' && <AbaLogistica />}
      {aba === 'metas' && <AbaMetas />}
    </Shell>
  )
}

// ——— ABAS DE ANÁLISE (vendedores · clientes · cidades · produtos) ———
type OrdemCol = 'faturamento' | 'kg' | 'rpkg' | 'flex_pct'
function useAnalise(companyId: string, de: string, ate: string, vendedor: string | null, dimensao: string, cidade?: string | null, codCliente?: string | null) {
  const [dados, setDados] = useState<Analise | null>(null)
  const [carregando, setCarregando] = useState(true)
  useEffect(() => {
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarrega ao mudar filtro/dimensão
    setCarregando(true)
    void supabase.rpc('fn_bi_comercial_analise', { p_company_id: companyId, p_dt_ini: de, p_dt_fim: ate, p_dimensao: dimensao, p_vendedor: vendedor, p_cidade: cidade ?? null, p_cod_cliente: codCliente ?? null })
      .then(({ data }) => { if (!vivo) return; setDados(data as Analise | null); setCarregando(false) })
    return () => { vivo = false }
  }, [companyId, de, ate, vendedor, dimensao, cidade, codCliente])
  return { dados, carregando }
}

function AbaAnalise({ companyId, de, ate, vendedor, aba }: { companyId: string; de: string; ate: string; vendedor: string | null; aba: 'vendedores' | 'clientes' | 'cidades' | 'produtos' }) {
  const dimensao = aba === 'vendedores' ? 'vendedor' : aba === 'clientes' ? 'cliente' : aba === 'cidades' ? 'cidade' : 'produto'
  const { dados, carregando } = useAnalise(companyId, de, ate, vendedor, dimensao)
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<OrdemCol>('faturamento')
  const [dir, setDir] = useState<'desc' | 'asc'>('desc')
  const [drill, setDrill] = useState<AnaliseItem | null>(null)

  const itens = useMemo(() => dados?.ok ? dados.itens : [], [dados])
  const total = dados?.total
  const termo = busca.trim().toLowerCase()
  const filtrados = useMemo(() => {
    const base = itens.filter(i => !termo || (i.rotulo || '').toLowerCase().includes(termo) || (i.chave || '').toLowerCase().includes(termo))
    const sorted = [...base].sort((a, b) => {
      const va = (a[ordem] ?? (ordem === 'flex_pct' ? -999 : 0)) as number
      const vb = (b[ordem] ?? (ordem === 'flex_pct' ? -999 : 0)) as number
      return dir === 'desc' ? vb - va : va - vb
    })
    return sorted
  }, [itens, termo, ordem, dir])

  // leitura automática (1 frase) — pareto top-5 para clientes/cidades
  const leitura = useMemo(() => {
    if (!dados?.ok || itens.length === 0) return null
    const n = itens.length
    const top = [...itens].sort((a, b) => b.faturamento - a.faturamento)
    const topFat = top.slice(0, 5).reduce((s, i) => s + i.faturamento, 0)
    const totFat = total?.faturamento ?? top.reduce((s, i) => s + i.faturamento, 0)
    const conc = totFat ? Math.round((topFat / totFat) * 100) : 0
    const r0 = top[0]?.rotulo || top[0]?.chave || '—'
    if (aba === 'vendedores') return `${n} vendedor${n === 1 ? '' : 'es'} no período · maior: ${r0} (${brlCompact(top[0]?.faturamento ?? null)}) · flex médio ${flexTxt(total?.flex_pct)}.`
    if (aba === 'clientes') return `${n} clientes · os 5 maiores concentram ${conc}% do faturamento · maior: ${r0} (${brlCompact(top[0]?.faturamento ?? null)}).`
    if (aba === 'cidades') return `${n} cidades atendidas · maior praça: ${r0} (${brlCompact(top[0]?.faturamento ?? null)}) · toque numa cidade para abrir clientes e produtos.`
    return `${n} produtos (cortes) · maior volume: ${r0} · preço médio ${brl(total?.rpkg ?? null)}/kg · despojos sinalizados · sem margem (custo da origem indisponível).`
  }, [dados, itens, total, aba])

  if (dados && dados.ok === false) return <Vazio t="Sem acesso comercial" l="Seu login não tem acesso a este painel." />

  const colExtraLabel = aba === 'vendedores' ? 'Clientes' : aba === 'cidades' ? 'Clientes' : aba === 'produtos' ? 'Participação' : 'Última compra'
  const sortBtn = (c: OrdemCol, l: string) => (
    <button onClick={() => { if (ordem === c) setDir(d => d === 'desc' ? 'asc' : 'desc'); else { setOrdem(c); setDir('desc') } }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: ordem === c ? GOLD : MUT, fontWeight: 700, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 2, padding: 0 }}>
      {l}{ordem === c && (dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
    </button>
  )

  return (
    <>
      {leitura && <div style={{ fontSize: 12.5, color: ESP, background: '#FBF7EC', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '9px 13px', marginBottom: 10 }}>{leitura}</div>}

      {/* resumo do recorte */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, marginBottom: 12 }}>
        <MiniKpi label="Faturamento" valor={brlCompact(total?.faturamento ?? null)} chave="comercial.bi.total_faturamento" />
        <MiniKpi label="Volume" valor={`${nf(total?.kg ?? null, 0)} kg`} />
        <MiniKpi label="R$/kg médio" valor={total?.rpkg != null ? `${brl(total.rpkg)}` : '—'} chave="comercial.bi.rpkg" />
        <MiniKpi label="Flex médio" valor={flexTxt(total?.flex_pct)} cor={flexCor(total?.flex_pct)} chave="comercial.bi.flex" />
      </div>

      <Card>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flex: '1 1 200px' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, color: MUT, pointerEvents: 'none' }} />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder={`Buscar ${aba === 'vendedores' ? 'vendedor' : aba === 'clientes' ? 'cliente' : aba === 'cidades' ? 'cidade' : 'produto'}…`} aria-label="Buscar na lista" style={{ width: '100%', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: '6px 10px 6px 28px', fontSize: 12.5, color: ESP, background: '#fff' }} />
            <AjudaCampo chave="comercial.bi.busca_analise" rota={ROTA} />
          </span>
          <span style={{ fontSize: 11.5, color: MUT, whiteSpace: 'nowrap' }}>{filtrados.length} de {itens.length}</span>
        </div>

        {carregando ? <div style={{ color: MUT, fontSize: 12.5, padding: '12px 0' }}>Carregando…</div> : itens.length === 0 ? <div style={{ color: MUT, fontSize: 12.5, padding: '12px 0' }}>Sem movimento no período.</div> : (
          <div style={{ maxHeight: 520, overflowY: 'auto', overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 540 }}>
              <thead><tr style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1, boxShadow: `0 1px 0 ${LINE}` }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700, color: MUT, fontSize: 11 }}>{aba === 'vendedores' ? 'Vendedor' : aba === 'clientes' ? 'Cliente' : aba === 'cidades' ? 'Cidade' : 'Produto'}</th>
                <th style={{ textAlign: 'right', padding: '8px 10px' }}>{sortBtn('faturamento', 'Faturamento')}</th>
                <th style={{ textAlign: 'right', padding: '8px 10px' }}>{sortBtn('kg', 'Volume')}</th>
                <th style={{ textAlign: 'right', padding: '8px 10px' }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>{sortBtn('rpkg', 'R$/kg')}<AjudaCampo chave="comercial.bi.rpkg" rota={ROTA} /></span></th>
                <th style={{ textAlign: 'right', padding: '8px 10px' }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>{sortBtn('flex_pct', 'Flex')}<AjudaCampo chave="comercial.bi.flex" rota={ROTA} /></span></th>
                <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: MUT, fontSize: 11 }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>{colExtraLabel}{(aba === 'clientes') && <AjudaCampo chave="comercial.bi.recencia" rota={ROTA} />}</span></th>
                {(aba === 'cidades' || aba === 'clientes') && <th style={{ width: 28 }} />}
              </tr></thead>
              <tbody>
                {filtrados.map((it, i) => {
                  const rot = it.rotulo || it.chave || '(sem)'
                  const dias = diasAtras(it.ultima_compra)
                  const podeDrill = aba === 'cidades' || aba === 'clientes'
                  const participacao = total?.faturamento ? (it.faturamento / total.faturamento) * 100 : null
                  return (
                    <tr key={it.chave + i} onClick={podeDrill ? () => setDrill(it) : undefined}
                      style={{ borderTop: `0.5px solid ${LINE}`, cursor: podeDrill ? 'pointer' : 'default' }}>
                      <td style={{ padding: '7px 10px', color: ESP, maxWidth: 220 }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {rot}</div>
                        {aba === 'vendedores' && <div style={{ fontSize: 10, color: MUT }}>{it.cargo || 'Vendedor'}{it.filial ? ` · filial ${it.filial}` : ''} · {nf(it.n_clientes, 0)} clientes</div>}
                        {aba === 'cidades' && it.uf && <div style={{ fontSize: 10, color: MUT }}>{it.uf} · {nf(it.n_clientes, 0)} clientes · {nf(it.n_produtos, 0)} produtos</div>}
                        {aba === 'produtos' && ehDespojo(rot) && <div style={{ fontSize: 10, color: '#8A6A1E', fontWeight: 700 }}>despojo / não comestível</div>}
                      </td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: ESP, fontWeight: 700, whiteSpace: 'nowrap' }}>{brl(it.faturamento)}</td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: MUT, whiteSpace: 'nowrap' }}>{nf(it.kg, 0)} kg</td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: ESP, whiteSpace: 'nowrap' }}>{it.rpkg != null ? brl(it.rpkg) : '—'}</td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', whiteSpace: 'nowrap' }}><span style={{ color: flexCor(it.flex_pct), fontWeight: 700 }}>{flexTxt(it.flex_pct)}</span></td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: MUT, whiteSpace: 'nowrap' }}>
                        {aba === 'vendedores' ? `${nf(it.n_clientes, 0)}` : aba === 'cidades' ? `${nf(it.n_clientes, 0)}` : aba === 'produtos' ? (participacao != null ? `${nf(participacao, 1)}%` : '—') : (
                          <span style={{ color: dias != null && dias > 30 ? AMBER : MUT, fontWeight: dias != null && dias > 30 ? 700 : 400 }}>{dataBr(it.ultima_compra)}{dias != null ? ` · ${dias}d` : ''}</span>
                        )}
                      </td>
                      {podeDrill && <td style={{ textAlign: 'center', color: MUT }}><ChevronRight size={14} /></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {drill && <DrillPanel companyId={companyId} de={de} ate={ate} vendedor={vendedor} item={drill} aba={aba === 'clientes' ? 'clientes' : 'cidades'} onClose={() => setDrill(null)} />}
    </>
  )
}

// Drill: cidade → clientes + produtos daquela cidade · cliente → produtos daquele cliente
function DrillPanel({ companyId, de, ate, vendedor, item, aba, onClose }: { companyId: string; de: string; ate: string; vendedor: string | null; item: AnaliseItem; aba: 'cidades' | 'clientes'; onClose: () => void }) {
  const porCidade = aba === 'cidades'
  const cidade = porCidade ? item.chave : null
  const codCliente = porCidade ? null : item.chave
  const clientes = useAnalise(companyId, de, ate, vendedor, 'cliente', cidade, codCliente)
  const produtos = useAnalise(companyId, de, ate, vendedor, 'produto', cidade, codCliente)
  const rot = item.rotulo || item.chave
  return (
    <div role="dialog" aria-label={`Detalhe de ${rot}`} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 100vw)', background: BG, height: '100%', overflowY: 'auto', padding: '20px clamp(14px,4vw,24px)', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10.5, color: MUT, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>{porCidade ? 'Cidade' : 'Cliente'}</div>
            <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 19, color: ESP }}>{rot}</div>
            <div style={{ fontSize: 11.5, color: MUT }}>{brl(item.faturamento)} · {nf(item.kg, 0)} kg · R$/kg {item.rpkg != null ? brl(item.rpkg) : '—'} · flex <span style={{ color: flexCor(item.flex_pct), fontWeight: 700 }}>{flexTxt(item.flex_pct)}</span></div>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 999, width: 30, height: 30, cursor: 'pointer', color: ESP, fontSize: 16 }}>×</button>
        </div>
        {porCidade && <DrillLista titulo="Clientes nesta cidade" dados={clientes.dados} carregando={clientes.carregando} modo="cliente" />}
        <DrillLista titulo={porCidade ? 'Produtos nesta cidade' : 'Produtos deste cliente'} dados={produtos.dados} carregando={produtos.carregando} modo="produto" />
      </div>
    </div>
  )
}
function DrillLista({ titulo, dados, carregando, modo }: { titulo: string; dados: Analise | null; carregando: boolean; modo: 'cliente' | 'produto' }) {
  const itens = (dados?.ok ? dados.itens : []).slice().sort((a, b) => b.faturamento - a.faturamento)
  return (
    <Card>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: ESP, marginBottom: 8 }}>{titulo} <span style={{ color: MUT, fontWeight: 500 }}>({itens.length})</span></div>
      {carregando ? <div style={{ color: MUT, fontSize: 12 }}>Carregando…</div> : itens.length === 0 ? <div style={{ color: MUT, fontSize: 12 }}>Sem itens.</div> : (
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {itens.map((it, i) => (
            <div key={it.chave + i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 2px', borderTop: i ? `0.5px solid ${LINE}` : 'none' }}>
              <span style={{ fontSize: 12, color: ESP, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.rotulo || it.chave}{modo === 'produto' && ehDespojo(it.rotulo || '') ? ' · despojo' : ''}</span>
              <span style={{ fontSize: 12, color: ESP, fontWeight: 700, whiteSpace: 'nowrap' }}>{brl(it.faturamento)} <span style={{ color: MUT, fontWeight: 500 }}>· {nf(it.kg, 0)}kg</span></span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ——— ABA FLEX consolidado (por vendedor / produto / cliente) ———
function AbaFlex({ companyId, de, ate, vendedor }: { companyId: string; de: string; ate: string; vendedor: string | null }) {
  const [dim, setDim] = useState<'vendedor' | 'produto' | 'cliente'>('vendedor')
  const { dados, carregando } = useAnalise(companyId, de, ate, vendedor, dim)
  const itens = (dados?.ok ? dados.itens : []).filter(i => i.flex_pct != null).slice().sort((a, b) => (b.flex_pct ?? 0) - (a.flex_pct ?? 0))
  const total = dados?.total
  const DIMSF = [{ v: 'vendedor', l: 'Por vendedor' }, { v: 'produto', l: 'Por produto' }, { v: 'cliente', l: 'Por cliente' }] as const
  if (dados && dados.ok === false) return <Vazio t="Sem acesso comercial" l="Seu login não tem acesso a este painel." />
  return (
    <>
      <div style={{ fontSize: 12.5, color: ESP, background: '#FBF7EC', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '9px 13px', marginBottom: 10 }}>
        Flex é o quanto o preço praticado ficou <strong>abaixo da tabela</strong> (desconto). Flex médio do recorte: <span style={{ color: flexCor(total?.flex_pct), fontWeight: 700 }}>{flexTxt(total?.flex_pct)}</span>. Verde = perto da tabela; vermelho = desconto alto.
      </div>
      <div style={{ display: 'inline-flex', gap: 3, background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: 3, marginBottom: 12 }}>
        {DIMSF.map(d => <button key={d.v} onClick={() => setDim(d.v)} style={pill(dim === d.v)}>{d.l}</button>)}
      </div>
      <Card>
        {carregando ? <div style={{ color: MUT, fontSize: 12.5, padding: '12px 0' }}>Carregando…</div> : itens.length === 0 ? <div style={{ color: MUT, fontSize: 12.5, padding: '12px 0' }}>Sem itens com preço de tabela no período.</div> : (
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {itens.map((it, i) => { const f = it.flex_pct ?? 0; const w = Math.min(100, Math.abs(f) * 8); return (
              <div key={it.chave + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: i ? `0.5px solid ${LINE}` : 'none' }}>
                <span style={{ width: 22, fontSize: 11, color: MUT, textAlign: 'right' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: ESP, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.rotulo || it.chave}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', color: flexCor(f) }}>{flexTxt(f)}</span>
                  </div>
                  <div style={{ position: 'relative', height: 6, borderRadius: 999, background: LINE, marginTop: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${w}%`, height: '100%', background: flexCor(f) }} />
                  </div>
                  <div style={{ fontSize: 10, color: MUT, marginTop: 1 }}>{brlCompact(it.faturamento)} · {nf(it.kg, 0)} kg</div>
                </div>
              </div>
            ) })}
          </div>
        )}
      </Card>
    </>
  )
}

function AbaLogistica() {
  return (
    <div style={{ background: '#FBF3DE', border: `0.5px dashed ${GOLD}`, borderRadius: 14, padding: '26px 20px', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, color: '#8A6A1E', textTransform: 'uppercase', letterSpacing: 0.4 }}><Truck size={14} /> Em preparação</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: ESP, marginTop: 8 }}>Logística — frete por placa</div>
      <div style={{ fontSize: 12.5, color: MUT, marginTop: 6, maxWidth: 440, marginInline: 'auto' }}>
        A origem ATAK já traz a placa do veículo em cada venda. O cruzamento de frete por placa (integração Brasil Sat) entra numa onda posterior — esta aba fica preparada para receber o custo de frete por rota/placa. Nenhum número estimado é mostrado até o dado chegar.
      </div>
    </div>
  )
}
function AbaMetas() {
  return (
    <div style={{ background: '#FBF3DE', border: `0.5px dashed ${GOLD}`, borderRadius: 14, padding: '26px 20px', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, color: '#8A6A1E', textTransform: 'uppercase', letterSpacing: 0.4 }}><Target size={14} /> Em preparação</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: ESP, marginTop: 8 }}>Metas e cotas</div>
      <div style={{ fontSize: 12.5, color: MUT, marginTop: 6, maxWidth: 440, marginInline: 'auto' }}>
        A origem atual (ATAK) não envia cota/meta por vendedor. Esta aba fica preparada para comparar realizado × meta assim que a cota for cadastrada no ERP. Sem meta cadastrada, não inventamos alvo (RD-58).
      </div>
    </div>
  )
}

function MiniKpi({ label, valor, cor, chave }: { label: string; valor: string; cor?: string; chave?: string }) {
  return (
    <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: '11px 13px' }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: cor ?? ESP, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, color: MUT, marginTop: 2 }}>{label}{chave && <AjudaCampo chave={chave} rota={ROTA} />}</div>
    </div>
  )
}

function PainelProdutos({ produtos, aberto, setAberto, aClassificar, salvandoCod, classificar }: {
  produtos: Produto[] | null; aberto: boolean; setAberto: (v: boolean) => void; aClassificar: number
  salvandoCod: string | null; classificar: (cod: string, status: ProdStatus) => void
}) {
  const lista = produtos ?? []
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setAberto(!aberto)}>
        <ChevronDown size={16} style={{ color: MUT, transform: aberto ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Produtos no cálculo</span>
        <AjudaCampo chave="comercial.bi.produtos_no_calculo" rota={ROTA} />
        {aClassificar > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#8A6A1E', background: '#F3E6C9', borderRadius: 999, padding: '2px 9px' }}>{aClassificar} a classificar</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: MUT }}>{lista.length} produto{lista.length === 1 ? '' : 's'}</span>
      </div>
      {aberto && (
        produtos == null ? <div style={{ color: MUT, fontSize: 12.5, padding: '10px 0' }}>Carregando produtos…</div>
        : lista.length === 0 ? <div style={{ color: MUT, fontSize: 12.5, padding: '10px 0' }}>Sem produtos no período.</div>
        : (
          <div style={{ marginTop: 10, maxHeight: 360, overflowY: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ color: MUT, position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>Produto</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600 }}>Volume</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600 }}>Faturamento</th>
                <th style={{ textAlign: 'center', padding: '8px 10px', fontWeight: 600 }}>No cálculo</th>
              </tr></thead>
              <tbody>
                {lista.map(p => {
                  const naoClass = p.status === 'a_classificar'
                  const sugereFora = naoClass && ehDespojo(p.desc_produto)
                  return (
                    <tr key={p.cod_produto} style={{ borderTop: `0.5px solid ${LINE}`, background: naoClass ? '#FBF7EC' : '#fff' }}>
                      <td style={{ padding: '7px 10px', color: ESP, maxWidth: 260 }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.desc_produto || p.cod_produto}</div>
                        <div style={{ fontSize: 10.5, color: MUT }}>cód. {p.cod_produto}{sugereFora && <span style={{ color: '#8A6A1E', fontWeight: 700 }}> · candidato a “fora” (despojo)</span>}</div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: MUT, whiteSpace: 'nowrap' }}>{nf(p.kg, 0)} kg</td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: ESP, fontWeight: 700, whiteSpace: 'nowrap' }}>{brl(p.valor_total)}</td>
                      <td style={{ padding: '6px 10px' }}>
                        <div style={{ display: 'inline-flex', gap: 2, background: BG, borderRadius: 999, padding: 2, opacity: salvandoCod === p.cod_produto ? 0.5 : 1 }}>
                          {(['entra', 'a_classificar', 'fora'] as ProdStatus[]).map(st => (
                            <button key={st} disabled={salvandoCod === p.cod_produto} onClick={() => classificar(p.cod_produto, st)}
                              title={STATUS_LABEL[st]}
                              style={{ fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 999, border: 'none', cursor: salvandoCod === p.cod_produto ? 'default' : 'pointer',
                                background: p.status === st ? (st === 'entra' ? GREEN : st === 'fora' ? RED : GOLD) : 'transparent',
                                color: p.status === st ? '#fff' : MUT }}>
                              {STATUS_LABEL[st]}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </Card>
  )
}
function TotalTopo({ chave, rotulo, valor, sub, destaque }: { chave: string; rotulo: string; valor: string; sub: string; destaque?: boolean }) {
  return (
    <div style={{ background: destaque ? '#FBF7EC' : '#fff', border: `${destaque ? 1 : 0.5}px solid ${destaque ? GOLD : LINE}`, borderRadius: 14, padding: '15px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: destaque ? '#8A6A1E' : MUT, textTransform: 'uppercase', letterSpacing: 0.3 }}>{rotulo}</span>
        <AjudaCampo chave={chave} rota={ROTA} />
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: ESP, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ fontSize: 11.5, color: MUT, marginTop: 4 }}>{sub}</div>
    </div>
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

function Shell({ children, area, router }: { children: React.ReactNode; area: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px clamp(14px, 4vw, 40px)' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <button onClick={() => router.push(`/dashboard/inteligencia?area=${area}`)} style={{ background: 'transparent', border: 'none', color: MUT, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 12 }}>← Análise de dados</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: '#F3E6C9', color: GOLD, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><TrendingUp size={20} /></span>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, color: ESP, margin: 0 }}>Comercial</h1>
            <div style={{ fontSize: 11.5, color: MUT }}>Faturamento · volume · clientes · vendedores · cidades · produtos · flex — dados ATAK ao vivo</div>
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

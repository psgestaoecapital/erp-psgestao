'use client'
// Indústria › BI da Planta — Entrada do gado e abate (onda 1, CEO 29/10/2026 16:17, proposta aprovada).
// Do produtor ao abate: compra de gado por produtor, cidade e categoria, preço da arroba, abate animal a animal,
// carcaça média e horas do abate. GENÉRICO: lê só a fn_bi_planta_abate (o tradutor por ERP de origem fica no banco).
// Mesmo padrão visual do Meu painel de vendas. Celular e notebook. Restrito à direção (a porta decide).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { ChevronRight, Lock } from 'lucide-react'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', gold2: '#E0B048', bd: '#E7DED3', m: '#6B5D4F', ok: '#1a8f63', warn: '#b07a12', bad: '#C0392B', bg2: '#F0ECE3', azul: '#2f6f8f', verde: '#3f7d4e' }
const ROTA = '/dashboard/industrial/bi-planta'

type Painel = {
  ok: boolean; erro?: string; mensagem?: string
  periodo: { de: string; ate: string; dias: number }
  filtro: { sexo: string | null; cidade: string | null }
  cidades_opcoes: string[]
  resumo: { cabecas: number; dias_abate: number; cab_dia: number | null; carcaca_media: number | null; carcaca_t: number | null; femeas: number; terceiros: number; min_dia: number | null; max_dia: number | null }
  compra: { cabecas: number | null; kg: number | null; valor: number | null; produtores: number; rs_arroba: number | null; custo_cab: number | null; nota10_cab: number | null }
  anterior: { de: string; ate: string; cabecas: number; carcaca_media: number | null; rs_arroba: number | null }
  horas: { abate_h: number; abate_pessoas: number; h_por_cabeca: number | null }
  dia: { dia: string; cab: number; femeas: number; peso: number | null }[]
  meses: { mes: string; cab: number; peso: number | null; rs_arroba: number | null }[]
  categorias: { categoria: string; cab: number; kg: number; valor: number; rs_arroba: number | null }[]
  cidades: { cidade: string; produtores: number; cab: number; valor: number; rs_arroba: number | null }[]
  produtores: { cod: string; produtor: string; cidade: string; cab: number; kg: number; valor: number; rs_arroba: number | null; carcaca_media: number | null }[]
  setores: { setor: string; pessoas: number; horas: number }[]
}

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const brlc = (v: number | null | undefined) => v == null ? '—' : Math.abs(v) >= 10000 ? 'R$ ' + nf({ notation: 'compact', maximumFractionDigits: 1 }).format(v) : brl(v)
const n1 = (v: number | null | undefined, d = 1) => v == null ? '—' : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const pct = (v: number | null | undefined, d = 1) => v == null || !isFinite(v) ? '—' : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%'
const varp = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null || b === 0 ? null : 100 * (a - b) / b
const dataBR = (s: string) => { const [a, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${a}` }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const cap = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesRot = (m: string) => MES[Number(m.slice(5, 7)) - 1] + '/' + m.slice(2, 4)

const PERIODOS = [{ k: '7', rot: '7 dias' }, { k: '30', rot: '30 dias' }, { k: 'mes', rot: 'Este mês' }, { k: '90', rot: '90 dias' }, { k: '365', rot: '12 meses' }] as const
const VISOES = [{ k: '', rot: 'Toda a planta' }, { k: 'F', rot: 'Fêmeas' }, { k: 'M', rot: 'Machos' }] as const

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 16, minWidth: 0, display: 'grid', gap: 8, alignContent: 'start' }
const th: CSSProperties = { position: 'sticky', top: 0, background: '#fff', textAlign: 'right', fontWeight: 600, color: C.m, padding: '8px 10px', borderBottom: `1px solid ${C.bd}`, whiteSpace: 'nowrap', fontSize: 12 }
const td: CSSProperties = { textAlign: 'right', padding: '8px 10px', borderBottom: `1px solid ${C.bg2}`, whiteSpace: 'nowrap', fontSize: 13, fontVariantNumeric: 'tabular-nums' }
const grade = (min: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 12, alignItems: 'start' })

function Titulo({ t, nota, ajuda }: { t: string; nota?: string; ajuda?: string }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>{t}{ajuda && <AjudaCampo chave={ajuda} rota={ROTA} />}</div>
      {nota && <div style={{ fontSize: 12, color: C.m }}>{nota}</div>}
    </div>
  )
}
function BarrasH({ dados, cor, fmt, ref, onPick }: { dados: { rot: string; v: number; sel?: boolean }[]; cor: string; fmt: (v: number) => string; ref?: number | null; onPick?: (rot: string) => void }) {
  const max = Math.max(1e-9, ...dados.map((d) => d.v), ref ?? 0)
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {dados.length === 0 && <span style={{ fontSize: 13, color: C.m }}>Sem dado no período.</span>}
      {dados.map((d) => (
        <button key={d.rot} type="button" disabled={!onPick} onClick={onPick ? () => onPick(d.rot) : undefined} title={onPick ? `Ver só ${d.rot}` : d.rot}
          style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 38%) 1fr auto', gap: 8, alignItems: 'center', fontSize: 12, background: 'none', border: 0, padding: 0, font: 'inherit', color: C.esp, cursor: onPick ? 'pointer' : 'default', textAlign: 'left' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: d.sel ? 700 : 400 }}>{d.rot}</span>
          <span style={{ position: 'relative', height: 14, background: C.bg2, borderRadius: 4 }}>
            <b style={{ position: 'absolute', inset: '0 auto 0 0', width: `${Math.max(1, 100 * d.v / max)}%`, background: cor, borderRadius: 4, opacity: d.sel === false ? 0.45 : 1 }} />
            {ref != null && ref > 0 && <u style={{ position: 'absolute', top: -3, bottom: -3, width: 2, left: `${100 * ref / max}%`, background: C.esp }} />}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: C.m, minWidth: 70, textAlign: 'right' }}>{fmt(d.v)}</span>
        </button>
      ))}
    </div>
  )
}
function Colunas({ dados, cor, corForte, onPick, fmtTopo }: { dados: { rot: string; v: number; forte?: boolean; dica: string }[]; cor: string; corForte?: string; onPick: (dica: string) => void; fmtTopo: (v: number) => string }) {
  const max = Math.max(1, ...dados.map((d) => d.v))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 190, paddingTop: 18, overflowX: 'auto' }}>
      {dados.length === 0 && <span style={{ fontSize: 13, color: C.m }}>Sem dado no período.</span>}
      {dados.map((d, i) => (
        <button key={d.rot + i} type="button" onClick={() => onPick(d.dica)} title={d.dica}
          style={{ flex: '1 0 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 10, color: C.m, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}>
          <span style={{ fontSize: 10, color: C.esp }}>{fmtTopo(d.v)}</span>
          <i style={{ display: 'block', width: '100%', height: Math.max(3, 140 * d.v / max), background: d.forte && corForte ? corForte : cor, borderRadius: '5px 5px 0 0' }} />
          <span>{d.rot}</span>
        </button>
      ))}
    </div>
  )
}
function Linha({ dados, cor, fmt }: { dados: { rot: string; v: number }[]; cor: string; fmt: (v: number) => string }) {
  if (dados.length < 2) return <span style={{ fontSize: 13, color: C.m }}>Poucos meses para desenhar a linha.</span>
  const W = 520, H = 190, L = 44, B = 22, T = 16
  const vs = dados.map((d) => d.v)
  const lo = Math.floor(Math.min(...vs) / 10) * 10 - 10, hi = Math.ceil(Math.max(...vs) / 10) * 10 + 10
  const x = (i: number) => L + 8 + i * (W - L - 24) / (dados.length - 1)
  const y = (v: number) => H - B - (H - B - T) * (v - lo) / (hi - lo)
  const pts = dados.map((d, i) => `${x(i)},${y(d.v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Preço da arroba mês a mês">
      {[0, 1, 2, 3].map((k) => { const v = lo + (hi - lo) * k / 3; return <g key={k}><line x1={L} x2={W - 8} y1={y(v)} y2={y(v)} stroke={C.bd} /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={C.m}>{int(v)}</text></g> })}
      <polygon points={`${x(0)},${H - B} ${pts} ${x(dados.length - 1)},${H - B}`} fill={cor} fillOpacity={0.12} />
      <polyline points={pts} fill="none" stroke={cor} strokeWidth={2.2} />
      {dados.map((d, i) => <text key={i} x={x(i)} y={H - 5} textAnchor="middle" fontSize="10" fill={C.m}>{d.rot}</text>)}
      <circle cx={x(dados.length - 1)} cy={y(dados[dados.length - 1].v)} r={4.5} fill={cor} />
      <text x={x(dados.length - 1) - 6} y={y(dados[dados.length - 1].v) - 9} textAnchor="end" fontSize="11" fill={C.esp}>{fmt(dados[dados.length - 1].v)}</text>
    </svg>
  )
}

export default function BiPlanta() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [sexo, setSexo] = useState<string>('')
  const [cidade, setCidade] = useState<string>('')
  const [per, setPer] = useState<string>('mes')
  const [p, setP] = useState<Painel | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dica, setDica] = useState<string | null>(null)

  const intervalo = useMemo(() => {
    const hoje = new Date(); const ate = iso(hoje)
    if (per === 'mes') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate }
    const d = new Date(hoje); d.setDate(d.getDate() - (Number(per) - 1)); return { de: iso(d), ate }
  }, [per])

  // Só a última requisição vale: troca rápida de filtro não deixa resposta velha sobrescrever a nova.
  // AbortError ("Lock broken by another request with the 'steal' option") é cancelamento do refresh
  // de sessão, não falha do painel: re-tenta uma vez em vez de quebrar a tela (bug 30/10).
  const seq = useRef(0)
  const carregar = useCallback(async () => {
    if (!empresa) return
    const minha = ++seq.current
    setCarregando(true); setErro(null)
    const args = { p_company_id: empresa, p_sexo: sexo || null, p_cidade: cidade || null, p_de: intervalo.de, p_ate: intervalo.ate }
    const abortou = (e: unknown) => { const m = e as { name?: string; message?: string } | null; return m?.name === 'AbortError' || /AbortError|Lock broken/i.test(m?.message ?? '') }
    let res: { data: unknown; error: { message: string; name?: string } | null } | null = null
    for (let t = 0; t < 3; t++) {
      try { res = await supabase.rpc('fn_bi_planta_abate', args) } catch (e) { if (!abortou(e)) { res = { data: null, error: { message: e instanceof Error ? e.message : 'Falha ao carregar' } }; break }; res = null }
      if (res && !(res.error && abortou(res.error))) break
      await new Promise((ok) => setTimeout(ok, 400 * (t + 1)))
    }
    if (minha !== seq.current) return
    setCarregando(false)
    if (!res || (res.error && abortou(res.error))) return
    if (res.error) { setErro(res.error.message); setP(null); return }
    setP(res.data as Painel)
  }, [empresa, sexo, cidade, intervalo])
  useEffect(() => { void carregar() }, [carregar])

  const r = p?.resumo; const c = p?.compra; const a = p?.anterior
  const femPct = r && r.cabecas ? 100 * r.femeas / r.cabecas : null
  const vArroba = varp(c?.rs_arroba, a?.rs_arroba)
  // Mês com arroba fora do padrão (ex.: lançamento a conferir no ERP de origem) sai da linha e vira aviso.
  const mesesArroba = useMemo(() => {
    const ms = (p?.meses ?? []).filter((m) => m.rs_arroba != null) as { mes: string; rs_arroba: number }[]
    const ord = [...ms.map((m) => m.rs_arroba)].sort((x, y) => x - y); const med = ord[Math.floor(ord.length / 2)] ?? 0
    return { bons: ms.filter((m) => m.rs_arroba <= med * 1.5), fora: ms.filter((m) => m.rs_arroba > med * 1.5) }
  }, [p])
  const nota10 = p?.categorias.filter((x) => /NOTA 10/i.test(x.categoria)) ?? []
  const comum = p?.categorias.filter((x) => !/NOTA 10/i.test(x.categoria)) ?? []
  const premio = (() => {
    const mN = nota10.find((x) => /MACHO/i.test(x.categoria)); const mC = comum.find((x) => /MACHO/i.test(x.categoria))
    return varp(mN?.rs_arroba, mC?.rs_arroba)
  })()
  const cid0 = p?.cidades[0]
  const visaoRot = VISOES.find((v) => v.k === sexo)?.rot ?? 'Toda a planta'

  const kpi = (rot: string, chave: string, valor: string, sub: ReactNode, cor?: string) => (
    <div style={{ ...card, gap: 2 }}>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(22px, 2.4vw, 30px)', lineHeight: 1.15, color: cor ?? C.esp, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ fontSize: 12, color: C.m }}>{sub}</div>
    </div>
  )

  return (
    <div style={{ background: C.off, minHeight: '100%', color: C.esp, padding: 'clamp(12px, 2.5vw, 28px)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gap: 18 }}>
        <header style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, color: C.m }}>Indústria · BI da Planta · Entrada do gado e abate</div>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px, 3.4vw, 34px)', fontFamily: 'Georgia, serif', fontWeight: 400 }}>Do produtor ao abate</h1>
          {p?.ok && r && c && (
            <p style={{ margin: 0, fontSize: 15, color: C.m, maxWidth: '82ch' }}>
              De <b style={{ color: C.esp }}>{dataBR(p.periodo.de)}</b> a <b style={{ color: C.esp }}>{dataBR(p.periodo.ate)}</b> a planta abateu <b style={{ color: C.esp }}>{int(r.cabecas)} cabeças</b> ({n1(r.carcaca_t)} t de carcaça) e pagou <b style={{ color: C.esp }}>{brl2(c.rs_arroba)} por arroba</b> a {int(c.produtores)} produtores
              {vArroba != null && <> — {vArroba >= 0 ? 'alta' : 'queda'} de <b style={{ color: C.esp }}>{pct(Math.abs(vArroba))}</b> sobre o período anterior</>}.
            </p>
          )}
          {p?.ok && <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}><Lock size={13} strokeWidth={1.5} /> Restrito à direção: mostra preço do gado.</div>}
        </header>

        <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'end' }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Visão<AjudaCampo chave="planta.visao" rota={ROTA} /></span>
            <div role="group" aria-label="Visão" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {VISOES.map((v) => (
                <button key={v.k} type="button" onClick={() => setSexo(v.k)} aria-pressed={sexo === v.k}
                  style={{ font: 'inherit', fontSize: 13, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${sexo === v.k ? C.esp : C.bd}`, background: sexo === v.k ? C.esp : '#fff', color: sexo === v.k ? '#fff' : C.esp }}>{v.rot}</button>
              ))}
            </div>
          </div>
          <label style={{ display: 'grid', gap: 2, fontSize: 12, color: C.m }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Cidade de origem<AjudaCampo chave="planta.visao" rota={ROTA} /></span>
            <select value={cidade} onChange={(e) => setCidade(e.target.value)} aria-label="Cidade de origem"
              style={{ font: 'inherit', fontSize: 14, padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp, minWidth: 200, maxWidth: '80vw' }}>
              <option value="">Todas as cidades</option>
              {(p?.cidades_opcoes ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Período<AjudaCampo chave="planta.periodo" rota={ROTA} /></span>
            <div role="group" aria-label="Período" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PERIODOS.map((x) => (
                <button key={x.k} type="button" onClick={() => setPer(x.k)} aria-pressed={per === x.k}
                  style={{ font: 'inherit', fontSize: 13, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${per === x.k ? C.esp : C.bd}`, background: per === x.k ? C.esp : '#fff', color: per === x.k ? '#fff' : C.esp }}>{x.rot}</button>
              ))}
            </div>
          </div>
          {(sexo || cidade) && (
            <nav aria-label="Trilha da visão" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <button type="button" onClick={() => { setSexo(''); setCidade('') }} style={{ font: 'inherit', fontSize: 12, borderRadius: 999, padding: '3px 10px', cursor: 'pointer', border: `1px solid ${C.bd}`, background: '#fff', color: C.esp }}>Toda a planta</button>
              {sexo && <><ChevronRight size={12} strokeWidth={1.5} /><span>{visaoRot}</span></>}
              {cidade && <><ChevronRight size={12} strokeWidth={1.5} /><span>{cidade}</span></>}
            </nav>
          )}
          {carregando && <span style={{ fontSize: 12, color: C.m }}>atualizando…</span>}
        </div>

        {!empresa && <div style={card}>Escolha uma empresa no topo para ver o painel.</div>}
        {erro && <div role="alert" style={{ ...card, borderColor: C.bad, color: C.bad }}>Não foi possível carregar: {erro}</div>}
        {p && !p.ok && <div style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>{p.mensagem}</div>}
        {carregando && !p && <div style={card}>Carregando…</div>}

        {p?.ok && r && c && a && (
          <>
            <section style={grade(170)} aria-label="Indicadores">
              {kpi('Cabeças abatidas', 'planta.cabecas', int(r.cabecas), <>{n1(r.cab_dia)} por dia de abate · antes {int(a.cabecas)}</>)}
              {kpi('Carcaça média', 'planta.carcaca', `${n1(r.carcaca_media)} kg`, <>{n1(r.carcaca_media != null ? r.carcaca_media / 15 : null)} arrobas · antes {n1(a.carcaca_media)} kg</>)}
              {kpi('Preço da arroba', 'planta.arroba', brl2(c.rs_arroba), <>antes {brl2(a.rs_arroba)}{vArroba != null && <> ({vArroba >= 0 ? '+' : ''}{pct(vArroba)})</>}</>, vArroba != null && vArroba > 3 ? C.bad : undefined)}
              {kpi('Custo por cabeça', 'planta.custo_cab', brl(c.custo_cab), <>{int(c.cabecas)} cabeças compradas · {brlc(c.valor)}</>)}
              {kpi('Fêmeas no abate', 'planta.femeas', pct(femPct), <>{int(r.femeas)} de {int(r.cabecas)} · {int(r.terceiros)} de terceiros</>)}
              {kpi('Horas do abate por cabeça', 'planta.horas', `${n1(p.horas.h_por_cabeca, 2)} h`, <>{int(p.horas.abate_h)} h do setor no ponto</>)}
            </section>

            <section style={{ ...card, borderLeft: `5px solid ${C.gold}` }} aria-label="Leituras para a decisão">
              <Titulo t="Leituras para a decisão" ajuda="planta.leituras" />
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
                {vArroba != null && <li><b>Arroba:</b> {brl2(c.rs_arroba)} contra {brl2(a.rs_arroba)} no período anterior ({vArroba >= 0 ? '+' : ''}{pct(vArroba)}). A margem por cabeça entra quando a venda por cabeça for ligada (onda 5).</li>}
                {premio != null && <li><b>Qualidade paga mais:</b> o macho Nota 10 saiu {pct(premio)} acima do macho comum. Vale medir se ele rende mais na desossa e vende mais caro.</li>}
                {r.min_dia != null && r.max_dia != null && <li><b>Ritmo do abate:</b> de {int(r.min_dia)} a {int(r.max_dia)} cabeças por dia. Dias abaixo de 60 diluem pior a equipe fixa do abate.</li>}
                {cid0 && <li><b>Origem:</b> {cid0.cidade} foi a praça que mais vendeu gado ({int(cid0.cab)} cabeças, {brlc(cid0.valor)}) a {brl2(cid0.rs_arroba)}/@.</li>}
                {mesesArroba.fora.length > 0 && <li><b>A conferir no ERP de origem:</b> {mesesArroba.fora.map((m) => mesRot(m.mes)).join(', ')} com arroba fora do padrão ({mesesArroba.fora.map((m) => brl(m.rs_arroba)).join(', ')}) — provável lançamento a revisar.</li>}
              </ul>
            </section>

            <section style={grade(380)} aria-label="Abate">
              <div style={card}>
                <Titulo t="Cabeças abatidas por dia" nota="Barra escura = mais da metade fêmeas. Toque numa barra para ver o detalhe." ajuda="planta.cabecas" />
                <Colunas cor={C.gold2} corForte={C.gold} onPick={setDica} fmtTopo={(v) => int(v)}
                  dados={p.dia.map((d) => ({ rot: dataBR(d.dia).slice(0, 5), v: d.cab, forte: d.femeas / d.cab > 0.5, dica: `${dataBR(d.dia)} · ${d.cab} cabeças · ${d.femeas} fêmeas · carcaça média ${n1(d.peso)} kg` }))} />
                {dica && <div role="status" style={{ fontSize: 12, color: C.esp, background: C.bg2, borderRadius: 8, padding: '6px 10px' }}>{dica}</div>}
              </div>
              <div style={card}>
                <Titulo t="15 meses de abate" nota="Cabeças por mês. O mês corrente vai até hoje." ajuda="planta.cabecas" />
                <Colunas cor={C.azul} onPick={setDica} fmtTopo={(v) => nf({ notation: 'compact', maximumFractionDigits: 1 }).format(v)}
                  dados={p.meses.map((m) => ({ rot: mesRot(m.mes), v: m.cab, dica: `${mesRot(m.mes)} · ${int(m.cab)} cabeças · carcaça média ${n1(m.peso)} kg · arroba ${brl2(m.rs_arroba)}` }))} />
              </div>
            </section>

            <section style={grade(380)} aria-label="Compra de gado">
              <div style={card}>
                <Titulo t="Preço da arroba mês a mês" nota={mesesArroba.fora.length ? 'Meses fora do padrão ficam fora da linha (ver leituras).' : 'R$ por arroba de carcaça paga ao produtor.'} ajuda="planta.arroba" />
                <Linha cor={C.verde} fmt={(v) => brl(v)} dados={mesesArroba.bons.map((m) => ({ rot: mesRot(m.mes).slice(0, 3), v: m.rs_arroba }))} />
              </div>
              <div style={card}>
                <Titulo t="Preço da arroba por categoria" nota="O traço é a média do período." ajuda="planta.arroba" />
                <BarrasH cor={C.gold} fmt={(v) => brl2(v)} ref={c.rs_arroba}
                  dados={p.categorias.filter((x) => x.rs_arroba != null).sort((x, y) => (y.rs_arroba ?? 0) - (x.rs_arroba ?? 0)).map((x) => ({ rot: cap(x.categoria.replace(/ PARA ABATE/i, '')), v: x.rs_arroba ?? 0 }))} />
                <div style={{ fontSize: 12, color: C.m }}>{p.categorias.map((x) => `${cap(x.categoria.replace(/ PARA ABATE/i, ''))}: ${int(x.cab)} cab.`).join(' · ')}</div>
              </div>
            </section>

            <section style={grade(420)} aria-label="Origem do gado">
              <div style={card}>
                <Titulo t="De onde veio o gado" nota="Valor comprado por cidade do produtor. Toque numa cidade para ver só ela." ajuda="planta.visao" />
                <BarrasH cor={C.verde} fmt={(v) => brlc(v)} onPick={(x) => setCidade(cidade === x ? '' : x)}
                  dados={p.cidades.map((x) => ({ rot: x.cidade, v: x.valor, sel: cidade ? x.cidade === cidade : undefined }))} />
              </div>
              <div style={card}>
                <Titulo t="Horas trabalhadas por setor" nota="Ponto eletrônico no período, sem nomes." ajuda="planta.horas" />
                <BarrasH cor={C.azul} fmt={(v) => `${int(v)} h`} dados={p.setores.map((x) => ({ rot: cap(x.setor), v: x.horas }))} />
              </div>
            </section>

            <section style={card} aria-label="Produtores">
              <Titulo t={`Os ${p.produtores.length} produtores que mais venderam`} nota="Cabeças, carcaça média e preço da arroba de cada um no período." ajuda="planta.produtores" />
              <div style={{ overflow: 'auto', maxHeight: 520 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={{ ...th, textAlign: 'left' }}>Produtor</th><th style={{ ...th, textAlign: 'left' }}>Cidade</th><th style={th}>Cabeças</th><th style={th}>Carcaça média</th><th style={th}>Valor pago</th><th style={th}>R$ por arroba</th></tr></thead>
                  <tbody>
                    {p.produtores.map((x) => {
                      const d = varp(x.rs_arroba, c.rs_arroba)
                      return (
                        <tr key={x.cod}>
                          <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 170 }}>{x.produtor}</td>
                          <td style={{ ...td, textAlign: 'left' }}>{x.cidade}</td>
                          <td style={td}>{int(x.cab)}</td><td style={td}>{n1(x.carcaca_media)} kg</td><td style={td}>{brl(x.valor)}</td>
                          <td style={{ ...td, color: d != null && d > 3 ? C.bad : d != null && d < -3 ? C.ok : C.esp }}>{brl2(x.rs_arroba)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

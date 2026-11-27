'use client'
// Indústria › Inteligência › Recepção — BI Compra de Animais (Spec BIs Indústria 25/11/2026).
// Molde do BI Comercial: a tela lê SÓ a porta fn_bi_compra_gado_painel; o tradutor por ERP de origem
// (fn_ind_compra_gado_item, ATAK hoje) fica no banco. Arrobas e R$/@, evolução do preço do boi, produtores (top 15),
// região, categoria/sexo, transportador, prazo de pagamento, concentração e cruzamento com o abate.
// Só leitura do ERP de origem. Restrito à direção (a porta decide). Celular e notebook.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { Lock } from 'lucide-react'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', gold2: '#E0B048', bd: '#E7DED3', m: '#6B5D4F', ok: '#1a8f63', warn: '#b07a12', bad: '#C0392B', bg2: '#F0ECE3', azul: '#2f6f8f', verde: '#3f7d4e' }
const ROTA = '/dashboard/inteligencia/recepcao'

type Painel = {
  ok: boolean; erro?: string; mensagem?: string
  periodo: { de: string; ate: string; dias: number }
  resumo: { cabecas: number; valor: number; kg: number; arrobas: number; rs_arroba: number | null; rs_kg: number | null; custo_cab: number | null; carcaca_media: number | null; produtores: number; notas: number; cidades: number; dias_compra: number; prazo_medio: number | null; reposicao_cab: number; reposicao_valor: number; femeas_pct: number | null; nota10_pct: number | null }
  anterior: { de: string; ate: string; cabecas: number; valor: number; arrobas: number; rs_arroba: number | null; custo_cab: number | null; produtores: number; prazo_medio: number | null }
  concentracao: { top5_pct: number | null; top10_pct: number | null; top15_pct: number | null; maior_pct: number | null; produtores_80pct: number }
  meses: { mes: string; cab: number; valor: number; arrobas: number; rs_arroba: number | null; prazo: number | null; produtores: number }[]
  semanas: { semana: string; cab: number; arrobas: number; rs_arroba: number | null }[]
  produtores: { cod: string; produtor: string; cidade: string; uf: string; cab: number; arrobas: number; valor: number; notas: number; rs_arroba: number | null; carcaca_media: number | null; prazo: number | null; nota10: boolean; ult_compra: string; participacao: number | null }[]
  cidades: { cidade: string; uf: string; produtores: number; cab: number; valor: number; rs_arroba: number | null; participacao: number | null }[]
  ufs: { uf: string; produtores: number; cab: number; valor: number; rs_arroba: number | null }[]
  categorias: { categoria: string; sexo: string | null; finalidade: string; nota10: boolean; cab: number; arrobas: number; valor: number; rs_arroba: number | null; custo_cab: number | null; carcaca_media: number | null }[]
  sexo: { sexo: string; cab: number; valor: number; rs_arroba: number | null; carcaca_media: number | null }[]
  transportadores: { transportador: string; cab: number; notas: number; valor: number; participacao: number | null }[]
  prazos: { faixa: string; ordem: number; notas: number; valor: number; participacao: number | null }[]
  abate: { cabecas: number; proprias: number; terceiros: number; carcaca_kg: number | null; carcaca_media: number | null; compra_abate_cab: number; compra_abate_valor: number; custo_por_cab_abatida: number | null; custo_por_kg_carcaca_abatida: number | null; saldo_cab: number; fechado_ate?: string | null; compra_pj_cab?: number; compra_pj_kg?: number; compra_pj_estimada?: boolean; abate_hoje_proprias?: number; compra_hoje_cab?: number; notas_pendentes_cab?: number; sem_nota_cab?: number }
  canceladas: { linhas: number; cabecas: number; valor: number }
}

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const brlc = (v: number | null | undefined) => v == null ? '—' : Math.abs(v) >= 10000 ? 'R$ ' + nf({ notation: 'compact', maximumFractionDigits: 1 }).format(v) : brl(v)
const n1 = (v: number | null | undefined, d = 1) => v == null ? '—' : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const pct = (v: number | null | undefined, d = 1) => v == null || !isFinite(v) ? '—' : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%'
const varp = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null || b === 0 ? null : 100 * (a - b) / b
const sinal = (v: number | null) => v == null ? '' : `${v >= 0 ? '+' : ''}${pct(v)}`
const dataBR = (s: string) => { const [a, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${a}` }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesRot = (m: string) => MES[Number(m.slice(5, 7)) - 1] + '/' + m.slice(2, 4)
const catRot = (s: string) => s.replace(/ Para Abate$/i, '').replace(/ Para Engorda$/i, ' (reposição)')
const sexoRot = (s: string) => s === 'F' ? 'Fêmeas' : s === 'M' ? 'Machos' : 'Sem sexo no cadastro'

const PERIODOS = [{ k: '7', rot: '7 dias' }, { k: '30', rot: '30 dias' }, { k: 'mes', rot: 'Este mês' }, { k: 'mesant', rot: 'Mês passado' }, { k: '90', rot: '90 dias' }, { k: '365', rot: '12 meses' }] as const

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 16, minWidth: 0, display: 'grid', gap: 8, alignContent: 'start' }
const th: CSSProperties = { position: 'sticky', top: 0, background: '#fff', textAlign: 'right', fontWeight: 600, color: C.m, padding: '8px 10px', borderBottom: `1px solid ${C.bd}`, whiteSpace: 'nowrap', fontSize: 12 }
const td: CSSProperties = { textAlign: 'right', padding: '8px 10px', borderBottom: `1px solid ${C.bg2}`, whiteSpace: 'nowrap', fontSize: 13, fontVariantNumeric: 'tabular-nums' }
const grade = (min: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 12, alignItems: 'start' })

function Titulo({ t, nota, ajuda }: { t: string; nota?: string; ajuda: string }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>{t}<AjudaCampo chave={ajuda} rota={ROTA} /></div>
      {nota && <div style={{ fontSize: 12, color: C.m }}>{nota}</div>}
    </div>
  )
}
function Vazio({ onAmpliar, texto = 'Sem compra no período.' }: { onAmpliar?: () => void; texto?: string }) {
  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }} data-testid="bi-compra-painel-vazio">
      <span style={{ fontSize: 13, color: C.m }}>{texto}</span>
      {onAmpliar && <button type="button" onClick={onAmpliar} style={{ font: 'inherit', fontSize: 12.5, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${C.esp}`, background: '#fff', color: C.esp }}>Ampliar para 12 meses</button>}
    </div>
  )
}
function BarrasH({ dados, cor, fmt, refv, onAmpliar }: { dados: { rot: string; v: number; extra?: string }[]; cor: string; fmt: (v: number) => string; refv?: number | null; onAmpliar?: () => void }) {
  const max = Math.max(1e-9, ...dados.map((d) => d.v), refv ?? 0)
  if (dados.length === 0) return <Vazio onAmpliar={onAmpliar} />
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {dados.map((d) => (
        <div key={d.rot} title={d.extra ? `${d.rot} · ${d.extra}` : d.rot} style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 38%) 1fr auto', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.rot}</span>
          <span style={{ position: 'relative', height: 14, background: C.bg2, borderRadius: 4 }}>
            <b style={{ position: 'absolute', inset: '0 auto 0 0', width: `${Math.max(1, 100 * d.v / max)}%`, background: cor, borderRadius: 4 }} />
            {refv != null && refv > 0 && <u style={{ position: 'absolute', top: -3, bottom: -3, width: 2, left: `${100 * refv / max}%`, background: C.esp }} />}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: C.m, minWidth: 70, textAlign: 'right' }}>{fmt(d.v)}{d.extra ? <span style={{ fontSize: 11 }}> · {d.extra}</span> : null}</span>
        </div>
      ))}
    </div>
  )
}
function Colunas({ dados, cor, fmtTopo, onPick }: { dados: { rot: string; v: number; dica: string }[]; cor: string; fmtTopo: (v: number) => string; onPick: (dica: string) => void }) {
  const max = Math.max(1, ...dados.map((d) => d.v))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 190, paddingTop: 18, overflowX: 'auto' }}>
      {dados.map((d, i) => (
        <button key={d.rot + i} type="button" onClick={() => onPick(d.dica)} title={d.dica}
          style={{ flex: '1 0 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 10, color: C.m, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}>
          <span style={{ fontSize: 10, color: C.esp }}>{fmtTopo(d.v)}</span>
          <i style={{ display: 'block', width: '100%', height: Math.max(3, 140 * d.v / max), background: cor, borderRadius: '5px 5px 0 0' }} />
          <span>{d.rot}</span>
        </button>
      ))}
    </div>
  )
}
function Linha({ dados, cor, fmt, rotulo }: { dados: { rot: string; v: number }[]; cor: string; fmt: (v: number) => string; rotulo: string }) {
  if (dados.length < 2) return <Vazio texto="Poucos pontos para desenhar a linha." />
  const W = 520, H = 190, L = 44, B = 22, T = 16
  const vs = dados.map((d) => d.v)
  const lo = Math.floor(Math.min(...vs) / 10) * 10 - 10, hi = Math.ceil(Math.max(...vs) / 10) * 10 + 10
  const x = (i: number) => L + 8 + i * (W - L - 24) / (dados.length - 1)
  const y = (v: number) => H - B - (H - B - T) * (v - lo) / (hi - lo)
  const pts = dados.map((d, i) => `${x(i)},${y(d.v)}`).join(' ')
  const ult = dados[dados.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={rotulo}>
      {[0, 1, 2, 3].map((k) => { const v = lo + (hi - lo) * k / 3; return <g key={k}><line x1={L} x2={W - 8} y1={y(v)} y2={y(v)} stroke={C.bd} /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={C.m}>{int(v)}</text></g> })}
      <polygon points={`${x(0)},${H - B} ${pts} ${x(dados.length - 1)},${H - B}`} fill={cor} fillOpacity={0.12} />
      <polyline points={pts} fill="none" stroke={cor} strokeWidth={2.2} />
      {dados.map((d, i) => <text key={i} x={x(i)} y={H - 5} textAnchor="middle" fontSize="10" fill={C.m}>{d.rot}</text>)}
      <circle cx={x(dados.length - 1)} cy={y(ult.v)} r={4.5} fill={cor} />
      <text x={x(dados.length - 1) - 6} y={y(ult.v) - 9} textAnchor="end" fontSize="11" fill={C.esp}>{fmt(ult.v)}</text>
    </svg>
  )
}

export default function BiCompraAnimais() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [per, setPer] = useState<string>('mes')
  const [p, setP] = useState<Painel | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dica, setDica] = useState<string | null>(null)

  const intervalo = useMemo(() => {
    const hoje = new Date(); const ate = iso(hoje)
    if (per === 'mes') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate }
    if (per === 'mesant') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)), ate: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)) }
    const d = new Date(hoje); d.setDate(d.getDate() - (Number(per) - 1)); return { de: iso(d), ate }
  }, [per])

  // Só a última requisição vale; AbortError do refresh de sessão re-tenta (mesmo cuidado do BI da Planta).
  const seq = useRef(0)
  const carregar = useCallback(async () => {
    if (!empresa) return
    const minha = ++seq.current
    setCarregando(true); setErro(null)
    const args = { p_company_id: empresa, p_dt_ini: intervalo.de, p_dt_fim: intervalo.ate }
    const abortou = (e: unknown) => { const m = e as { name?: string; message?: string } | null; return m?.name === 'AbortError' || /AbortError|Lock broken/i.test(m?.message ?? '') }
    let res: { data: unknown; error: { message: string; name?: string } | null } | null = null
    for (let t = 0; t < 3; t++) {
      try { res = await supabase.rpc('fn_bi_compra_gado_painel', args) } catch (e) { if (!abortou(e)) { res = { data: null, error: { message: e instanceof Error ? e.message : 'Falha ao carregar' } }; break }; res = null }
      if (res && !(res.error && abortou(res.error))) break
      await new Promise((ok) => setTimeout(ok, 400 * (t + 1)))
    }
    if (minha !== seq.current) return
    setCarregando(false)
    if (!res || (res.error && abortou(res.error))) return
    if (res.error) { setErro('Não foi possível carregar o painel. Tente novamente.'); setP(null); return }
    setP(res.data as Painel)
  }, [empresa, intervalo])
  useEffect(() => { void carregar() }, [carregar])

  const ampliar = useCallback(() => setPer('365'), [])
  const ampliarPainel = per !== '365' ? ampliar : undefined

  const r = p?.resumo; const a = p?.anterior; const ab = p?.abate; const cc = p?.concentracao
  const vArroba = varp(r?.rs_arroba, a?.rs_arroba)
  const vArrobas = varp(r?.arrobas, a?.arrobas)
  // Evolução do preço: 15 meses; mês com arroba muito fora da mediana sai da linha e vira aviso (lançamento a conferir).
  const mesesArroba = useMemo(() => {
    const ms = (p?.meses ?? []).filter((m) => m.rs_arroba != null) as { mes: string; rs_arroba: number }[]
    const ord = ms.map((m) => m.rs_arroba).sort((x, y) => x - y); const med = ord[Math.floor(ord.length / 2)] ?? 0
    return { bons: ms.filter((m) => m.rs_arroba <= med * 1.5 && m.rs_arroba >= med * 0.5), fora: ms.filter((m) => m.rs_arroba > med * 1.5 || m.rs_arroba < med * 0.5) }
  }, [p])
  const v12 = useMemo(() => {
    const b = mesesArroba.bons; if (b.length < 13) return null
    return varp(b[b.length - 1].rs_arroba, b[b.length - 13].rs_arroba)
  }, [mesesArroba])
  const premioN10 = useMemo(() => {
    const cs = p?.categorias ?? []
    const n10 = cs.filter((x) => x.nota10 && x.sexo === 'M' && x.finalidade === 'abate'); const com = cs.filter((x) => !x.nota10 && x.sexo === 'M' && x.finalidade === 'abate' && !/precoce/i.test(x.categoria))
    const ar = (xs: typeof cs) => { const kg = xs.reduce((s, x) => s + x.arrobas, 0); return kg ? xs.reduce((s, x) => s + x.valor, 0) / kg : null }
    return varp(ar(n10), ar(com))
  }, [p])
  const fem = p?.sexo.find((s) => s.sexo === 'F'); const mac = p?.sexo.find((s) => s.sexo === 'M')
  const cid0 = p?.cidades[0]
  const transp0 = p?.transportadores[0]

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
          <div style={{ fontSize: 12, color: C.m }}>Indústria · Análise de dados · Recepção</div>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px, 3.4vw, 34px)', fontFamily: 'Georgia, serif', fontWeight: 400 }}>Compra de animais</h1>
          {p?.ok && r && a && r.cabecas > 0 && (
            <p style={{ margin: 0, fontSize: 15, color: C.m, maxWidth: '84ch' }} data-testid="bi-compra-resumo">
              De <b style={{ color: C.esp }}>{dataBR(p.periodo.de)}</b> a <b style={{ color: C.esp }}>{dataBR(p.periodo.ate)}</b> a planta comprou <b style={{ color: C.esp }}>{int(r.cabecas)} cabeças</b> ({int(r.arrobas)} @) de {int(r.produtores)} produtores, por <b style={{ color: C.esp }}>{brlc(r.valor)}</b>, a <b style={{ color: C.esp }}>{brl2(r.rs_arroba)} por arroba</b>
              {vArroba != null && <> — {vArroba >= 0 ? 'alta' : 'queda'} de <b style={{ color: C.esp }}>{pct(Math.abs(vArroba))}</b> sobre o período anterior</>}, com pagamento médio em <b style={{ color: C.esp }}>{n1(r.prazo_medio)} dias</b>.
            </p>
          )}
          {p?.ok && <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}><Lock size={13} strokeWidth={1.5} /> Restrito à direção: mostra preço pago e produtores. Só leitura do ERP de origem.</div>}
        </header>

        <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'end' }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Período<AjudaCampo chave="compra.periodo" rota={ROTA} /></span>
            <div role="group" aria-label="Período" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PERIODOS.map((x) => (
                <button key={x.k} type="button" onClick={() => setPer(x.k)} aria-pressed={per === x.k}
                  style={{ font: 'inherit', fontSize: 13, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${per === x.k ? C.esp : C.bd}`, background: per === x.k ? C.esp : '#fff', color: per === x.k ? '#fff' : C.esp }}>{x.rot}</button>
              ))}
            </div>
          </div>
          {carregando && <span style={{ fontSize: 12, color: C.m }}>atualizando…</span>}
        </div>

        {!empresa && <div style={card}>Escolha uma empresa no topo para ver o painel.</div>}
        {erro && <div role="alert" style={{ ...card, borderColor: C.bad, color: C.bad }}>{erro}</div>}
        {p && !p.ok && <div style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>{p.mensagem}</div>}
        {carregando && !p && <div style={card}>Carregando…</div>}

        {p?.ok && r && r.cabecas === 0 && (
          <div style={{ ...card, borderLeft: `5px solid ${C.warn}`, gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Sem compra de gado de {dataBR(p.periodo.de)} a {dataBR(p.periodo.ate)}</div>
            <div style={{ fontSize: 14, color: C.m, maxWidth: '72ch' }}>Nenhuma contra-nota de compra de gado vivo chegou do ERP de origem neste período. Amplie o período para ver o histórico.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {per !== 'mesant' && <button type="button" onClick={() => setPer('mesant')} style={{ font: 'inherit', fontSize: 13, padding: '8px 14px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${C.esp}`, background: C.esp, color: '#fff' }}>Ver mês passado</button>}
              {per !== '365' && <button type="button" onClick={ampliar} style={{ font: 'inherit', fontSize: 13, padding: '8px 14px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${C.bd}`, background: '#fff', color: C.esp }}>Ver 12 meses</button>}
            </div>
          </div>
        )}

        {p?.ok && r && a && ab && cc && r.cabecas > 0 && (
          <>
            <section style={grade(170)} aria-label="Indicadores">
              {kpi('Arrobas compradas', 'compra.arrobas', `${int(r.arrobas)} @`, <>{int(r.cabecas)} cabeças · antes {int(a.arrobas)} @{vArrobas != null && <> ({sinal(vArrobas)})</>}</>)}
              {kpi('Preço da arroba', 'compra.rs_arroba', brl2(r.rs_arroba), <>antes {brl2(a.rs_arroba)}{vArroba != null && <> ({sinal(vArroba)})</>} · {brl2(r.rs_kg)}/kg</>, vArroba != null && vArroba > 3 ? C.bad : vArroba != null && vArroba < -3 ? C.ok : undefined)}
              {kpi('Valor comprado', 'compra.valor', brlc(r.valor), <>antes {brlc(a.valor)} · {int(r.notas)} notas</>)}
              {kpi('Custo por cabeça', 'compra.custo_cab', brl(r.custo_cab), <>carcaça média {n1(r.carcaca_media)} kg · antes {brl(a.custo_cab)}</>)}
              {kpi('Prazo médio de pagamento', 'compra.prazo', `${n1(r.prazo_medio)} dias`, <>antes {n1(a.prazo_medio)} dias · ponderado pelo valor</>)}
              {kpi('Concentração (10 maiores)', 'compra.concentracao', pct(cc.top10_pct), <>{int(cc.produtores_80pct)} de {int(r.produtores)} produtores fazem 80% da compra</>, cc.top10_pct != null && cc.top10_pct > 50 ? C.warn : undefined)}
            </section>

            <section style={{ ...card, borderLeft: `5px solid ${C.gold}` }} aria-label="Leituras para a decisão">
              <Titulo t="Leituras para a decisão" ajuda="compra.leituras" />
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
                {vArroba != null && <li><b>Preço do boi:</b> {brl2(r.rs_arroba)} por arroba contra {brl2(a.rs_arroba)} no período anterior ({sinal(vArroba)}).{v12 != null && <> Em 12 meses a arroba {v12 >= 0 ? 'subiu' : 'caiu'} {pct(Math.abs(v12))}.</>}</li>}
                {ab.proprias > 0 && <li><b>Compra × abate:</b> o gado para abate comprado no período custou {brl(ab.custo_por_cab_abatida)} por cabeça abatida pela planta ({int(ab.proprias)} cabeças próprias, {brl2(ab.custo_por_kg_carcaca_abatida)} por kg de carcaça abatida). {Math.abs(ab.saldo_cab) > 0.05 * ab.proprias ? <>Foram {int(Math.abs(ab.saldo_cab))} cabeças a {ab.saldo_cab > 0 ? 'mais compradas que abatidas (estoque no curral ou abate no período seguinte)' : 'menos compradas que abatidas (abate de gado comprado antes)'}.</> : <>Compra e abate andaram juntos.</>}</li>}
                {cc.top10_pct != null && <li><b>Concentração:</b> os 10 maiores produtores fizeram {pct(cc.top10_pct)} da compra e o maior, {pct(cc.maior_pct)}. {cc.top10_pct > 50 ? 'Base concentrada: a perda de um grande fornecedor afeta a escala do abate.' : 'Base pulverizada: o risco de oferta está distribuído.'}</li>}
                {premioN10 != null && <li><b>Qualidade paga mais:</b> o macho Nota 10 saiu {pct(premioN10)} {premioN10 >= 0 ? 'acima' : 'abaixo'} do macho comum por arroba. Vale cruzar com o rendimento da desossa.</li>}
                {fem && mac && fem.rs_arroba != null && mac.rs_arroba != null && <li><b>Fêmea × macho:</b> fêmeas foram {pct(r.femeas_pct)} das cabeças, a {brl2(fem.rs_arroba)}/@ (carcaça {n1(fem.carcaca_media)} kg) contra {brl2(mac.rs_arroba)}/@ dos machos (carcaça {n1(mac.carcaca_media)} kg).</li>}
                {cid0 && <li><b>Origem:</b> {cid0.cidade}/{cid0.uf} foi a praça que mais vendeu ({pct(cid0.participacao)} do valor, {int(cid0.cab)} cabeças) a {brl2(cid0.rs_arroba)}/@. {r.cidades} cidades venderam no período.</li>}
                {r.prazo_medio != null && <li><b>Prazo:</b> a compra vira pagamento em {n1(r.prazo_medio)} dias em média{a.prazo_medio != null && Math.abs(r.prazo_medio - a.prazo_medio) >= 0.5 ? <> ({r.prazo_medio > a.prazo_medio ? 'mais longo' : 'mais curto'} que os {n1(a.prazo_medio)} dias do período anterior)</> : null}. Cada dia a mais de prazo sobre {brlc(r.valor)} alivia o caixa da planta.</li>}
                {transp0 && transp0.participacao != null && transp0.participacao >= 90 && <li><b>Frete:</b> {pct(transp0.participacao)} do gado veio com um só transportador ({transp0.transportador}).</li>}
                {r.reposicao_cab > 0 && <li><b>Reposição:</b> {int(r.reposicao_cab)} cabeças compradas para engorda ({brlc(r.reposicao_valor)}). Entram no valor e nas cabeças, mas não no preço da arroba (são pagas por cabeça).</li>}
                {mesesArroba.fora.length > 0 && <li><b>A conferir no ERP de origem:</b> {mesesArroba.fora.map((m) => `${mesRot(m.mes)} (${brl(m.rs_arroba)})`).join(', ')} com arroba fora do padrão — provável lançamento a revisar.</li>}
              </ul>
            </section>

            <section style={grade(380)} aria-label="Evolução do preço do boi">
              <div style={card}>
                <Titulo t="Preço da arroba mês a mês" nota="Gado para abate, R$ por arroba de carcaça paga ao produtor. O mês corrente vai até hoje." ajuda="compra.evolucao" />
                <Linha cor={C.verde} fmt={(v) => brl(v)} rotulo="Preço da arroba mês a mês" dados={mesesArroba.bons.map((m) => ({ rot: mesRot(m.mes).slice(0, 3), v: m.rs_arroba }))} />
              </div>
              <div style={card}>
                <Titulo t="Arrobas compradas por mês" nota="Toque numa barra para ver o detalhe do mês." ajuda="compra.arrobas" />
                <Colunas cor={C.gold2} onPick={setDica} fmtTopo={(v) => nf({ notation: 'compact', maximumFractionDigits: 1 }).format(v)}
                  dados={p.meses.map((m) => ({ rot: mesRot(m.mes), v: m.arrobas, dica: `${mesRot(m.mes)} · ${int(m.arrobas)} @ · ${int(m.cab)} cabeças · ${brlc(m.valor)} · ${brl2(m.rs_arroba)}/@ · ${int(m.produtores)} produtores · prazo ${n1(m.prazo)} dias` }))} />
                {dica && <div role="status" style={{ fontSize: 12, color: C.esp, background: C.bg2, borderRadius: 8, padding: '6px 10px' }}>{dica}</div>}
              </div>
            </section>

            {p.semanas.length > 1 && (
              <section style={card} aria-label="Preço por semana">
                <Titulo t="Preço da arroba semana a semana no período" nota="O traço é a média do período." ajuda="compra.evolucao" />
                <BarrasH cor={C.gold} fmt={(v) => brl2(v)} refv={r.rs_arroba}
                  dados={p.semanas.filter((s) => s.rs_arroba != null).map((s) => ({ rot: `Semana de ${dataBR(s.semana).slice(0, 5)}`, v: s.rs_arroba ?? 0, extra: `${int(s.arrobas)} @` }))} />
              </section>
            )}

            <section style={grade(380)} aria-label="Compra e abate">
              <div style={card}>
                <Titulo t="Compra × abate" nota={ab.fechado_ate ? `Gado para abate comprado × cabeças abatidas pela planta nos dias fechados (até ${dataBR(ab.fechado_ate)}). Hoje fica fora: a nota sai depois do abate.` : 'O período é só o dia de hoje: a nota de compra sai depois do abate, então a comparação começa amanhã.'} ajuda="compra.abate" />
                <div style={grade(140)}>
                  {[
                    ['Cabeças compradas (abate)', int(ab.compra_abate_cab)],
                    ['Cabeças abatidas (próprias)', int(ab.proprias)],
                    ['Diferença', `${ab.saldo_cab > 0 ? '+' : ''}${int(ab.saldo_cab)}`],
                    ['Custo do boi por cabeça abatida', brl(ab.custo_por_cab_abatida)],
                    ['Custo por kg de carcaça abatida', brl2(ab.custo_por_kg_carcaca_abatida)],
                    ['Carcaça média abatida', `${n1(ab.carcaca_media)} kg`],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'grid', gap: 2 }}>
                      <span style={{ fontSize: 12, color: C.m }}>{k}</span>
                      <span style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gap: 6, borderTop: `1px solid ${C.bg2}`, paddingTop: 8 }} aria-label="De onde vem a diferença">
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.m }}>De onde vem a diferença</span>
                  {[
                    { k: 'compra.abate_hoje', rot: 'Notas ainda não emitidas', v: int(ab.notas_pendentes_cab ?? 0), obs: `${int(ab.abate_hoje_proprias ?? 0)} abatidas hoje, ${int(ab.compra_hoje_cab ?? 0)} com nota. Fora da conta até a nota sair.` },
                    { k: 'compra.abate_pj', rot: 'Compra de pessoa jurídica', v: `+${int(ab.compra_pj_cab ?? 0)}`, obs: `${int(ab.compra_pj_kg ?? 0)} kg, já somados nas compradas${ab.compra_pj_estimada ? ' (cabeças estimadas pelo peso)' : ''}.` },
                    { k: 'compra.abate_sem_nota', rot: 'Sem nota de compra', v: int(ab.sem_nota_cab ?? 0), obs: (ab.sem_nota_cab ?? 0) > 0 ? 'Abatidas nos dias fechados sem nota de compra no período.' : ab.saldo_cab > 0 ? `Nenhuma. Foram ${int(ab.saldo_cab)} compradas a mais (gado no curral ou abate no período seguinte).` : 'Nenhuma.' },
                  ].map((x) => (
                    <div key={x.k} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>{x.rot}<AjudaCampo chave={x.k} rota={ROTA} /></span>
                      <span style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>{x.v}</span>
                      <span style={{ gridColumn: '1 / -1', fontSize: 12, color: C.m }}>{x.obs}</span>
                    </div>
                  ))}
                </div>
                {ab.terceiros > 0 && <div style={{ fontSize: 12, color: C.m }}>{int(ab.terceiros)} cabeças de abate de terceiros ficam fora do custo (o gado não é da planta).</div>}
              </div>
              <div style={card}>
                <Titulo t="Prazos de pagamento" nota="Valor comprado por faixa de prazo da condição de pagamento." ajuda="compra.prazos" />
                <BarrasH cor={C.azul} fmt={(v) => pct(v)} onAmpliar={ampliarPainel}
                  dados={p.prazos.map((x) => ({ rot: x.faixa, v: x.participacao ?? 0, extra: `${brlc(x.valor)} · ${int(x.notas)} notas` }))} />
              </div>
            </section>

            <section style={grade(380)} aria-label="Origem e categoria">
              <div style={card}>
                <Titulo t="Região de origem" nota={`Valor comprado por cidade do produtor (${p.ufs.map((u) => `${u.uf}: ${int(u.produtores)} produtores`).join(' · ')}).`} ajuda="compra.regiao" />
                <BarrasH cor={C.verde} fmt={(v) => brlc(v)} onAmpliar={ampliarPainel}
                  dados={p.cidades.map((x) => ({ rot: `${x.cidade}/${x.uf}`, v: x.valor, extra: `${brl2(x.rs_arroba)}/@` }))} />
              </div>
              <div style={card}>
                <Titulo t="Categoria e sexo" nota="R$ por arroba por categoria. O traço é a média do período; reposição é paga por cabeça." ajuda="compra.categoria" />
                <BarrasH cor={C.gold} fmt={(v) => brl2(v)} refv={r.rs_arroba} onAmpliar={ampliarPainel}
                  dados={p.categorias.filter((x) => x.rs_arroba != null && x.finalidade === 'abate').sort((x, y) => (y.rs_arroba ?? 0) - (x.rs_arroba ?? 0)).map((x) => ({ rot: catRot(x.categoria), v: x.rs_arroba ?? 0, extra: `${int(x.cab)} cab.` }))} />
                <div style={{ fontSize: 12, color: C.m }}>
                  {p.sexo.map((s) => `${sexoRot(s.sexo)}: ${int(s.cab)} cab. a ${brl2(s.rs_arroba)}/@`).join(' · ')}
                  {p.categorias.filter((x) => x.finalidade === 'reposicao').map((x) => ` · ${catRot(x.categoria)}: ${int(x.cab)} cab., ${brl(x.custo_cab)}/cab.`).join('')}
                </div>
              </div>
            </section>

            <section style={grade(380)} aria-label="Transportador e concentração">
              <div style={card}>
                <Titulo t="Transportador" nota="Valor do gado transportado por quem fez o frete." ajuda="compra.transportador" />
                <BarrasH cor={C.azul} fmt={(v) => pct(v)} onAmpliar={ampliarPainel}
                  dados={p.transportadores.map((x) => ({ rot: x.transportador, v: x.participacao ?? 0, extra: `${int(x.cab)} cab. · ${int(x.notas)} notas` }))} />
              </div>
              <div style={card}>
                <Titulo t="Concentração nos maiores produtores" nota="Parte do valor comprado que veio dos maiores." ajuda="compra.concentracao" />
                <BarrasH cor={C.gold2} fmt={(v) => pct(v)}
                  dados={[{ rot: 'Maior produtor', v: cc.maior_pct ?? 0 }, { rot: '5 maiores', v: cc.top5_pct ?? 0 }, { rot: '10 maiores', v: cc.top10_pct ?? 0 }, { rot: '15 maiores', v: cc.top15_pct ?? 0 }]} />
                <div style={{ fontSize: 12, color: C.m }}>{int(cc.produtores_80pct)} produtores fazem 80% da compra, de {int(r.produtores)} no período.</div>
              </div>
            </section>

            <section style={card} aria-label="Produtores">
              <Titulo t={`Os ${p.produtores.length} produtores de quem mais se comprou`} nota="Cabeças, arrobas, preço, carcaça média, prazo e participação de cada um no período. Vermelho = acima da média em mais de 3%." ajuda="compra.produtores" />
              <div style={{ overflow: 'auto', maxHeight: 560 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...th, textAlign: 'left' }}>Produtor <AjudaCampo chave="compra.prod_produtor" rota={ROTA} /></th>
                    <th style={{ ...th, textAlign: 'left' }}>Cidade <AjudaCampo chave="compra.prod_cidade" rota={ROTA} /></th>
                    <th style={th}>Cabeças <AjudaCampo chave="compra.cabecas" rota={ROTA} /></th>
                    <th style={th}>Arrobas <AjudaCampo chave="compra.arrobas" rota={ROTA} /></th>
                    <th style={th}>Valor <AjudaCampo chave="compra.valor" rota={ROTA} /></th>
                    <th style={th}>R$/@ <AjudaCampo chave="compra.rs_arroba" rota={ROTA} /></th>
                    <th style={th}>Carcaça <AjudaCampo chave="compra.prod_carcaca" rota={ROTA} /></th>
                    <th style={th}>Prazo <AjudaCampo chave="compra.prazo" rota={ROTA} /></th>
                    <th style={th}>Partic. <AjudaCampo chave="compra.concentracao" rota={ROTA} /></th>
                    <th style={th}>Última <AjudaCampo chave="compra.prod_ultima" rota={ROTA} /></th>
                  </tr></thead>
                  <tbody>
                    {p.produtores.map((x) => {
                      const d = varp(x.rs_arroba, r.rs_arroba)
                      return (
                        <tr key={x.cod}>
                          <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 170 }}>{x.produtor}{x.nota10 && <span title="Vendeu gado Nota 10 no período" style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 999, background: C.bg2, color: C.verde }}>Nota 10</span>}</td>
                          <td style={{ ...td, textAlign: 'left' }}>{x.cidade}/{x.uf}</td>
                          <td style={td}>{int(x.cab)}</td><td style={td}>{int(x.arrobas)}</td><td style={td}>{brl(x.valor)}</td>
                          <td style={{ ...td, color: d != null && d > 3 ? C.bad : d != null && d < -3 ? C.ok : C.esp }}>{brl2(x.rs_arroba)}</td>
                          <td style={td}>{n1(x.carcaca_media)} kg</td><td style={td}>{n1(x.prazo)} d</td><td style={td}>{pct(x.participacao)}</td>
                          <td style={td}>{dataBR(x.ult_compra).slice(0, 5)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {p.canceladas.linhas > 0 && (
              <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }} data-testid="bi-compra-canceladas">
                {int(p.canceladas.linhas)} {p.canceladas.linhas === 1 ? 'item de nota cancelada' : 'itens de notas canceladas'} no ERP de origem ({int(p.canceladas.cabecas)} cabeças, {brlc(p.canceladas.valor)}) ficaram fora de todos os números.
                <AjudaCampo chave="compra.canceladas" rota={ROTA} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

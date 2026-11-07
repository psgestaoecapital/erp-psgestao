'use client'
// Comercial › Meu painel de vendas (CEO 06/11/2026, validar com a Franciele/Frioeste).
// BI em cascata e GENÉRICO: lê só a fn_bi_comercial_painel, que trava o escopo no banco pelo vínculo do usuário com o
// código de vendedor do ERP de origem (ATAK hoje; outro ERP = outro tradutor, a tela não muda). Vendedor vê só a própria
// venda; supervisor a equipe dele; diretoria a empresa toda.
// Protótipo aprovado pelo CEO 06/11: 8 ABAS (Visão geral · Vendedores · Clientes · Cidades · Produtos · Flex · Logística ·
// Metas). AO VIVO (lê a venda detalhada, nota a nota), MOSTRAR TUDO (sem top-N: rolagem + cabeçalho fixo + busca +
// ordenação nos dois sentidos), DRILL ao clicar, filtros de período no topo, cada aba abre com uma leitura automática.
// Identidade PS (espresso/dourado/off-white). Celular (390px) e notebook.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { Lock, ChevronRight, ChevronDown, ChevronUp, ArrowUp, ArrowDown, X } from 'lucide-react'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', gold2: '#E0B048', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', ok: '#1a8f63', warn: '#b07a12', bad: '#C0392B', bg2: '#F0ECE3', azul: '#2f6f8f', verde: '#3f7d4e' }
const ROTA = '/dashboard/comercial/meu-painel'

type No = { no: string; nome: string; cargo: string; pai: string | null; ordem: string }
type Equipe = { ven: string; nome: string; val: number; kg: number; preco_kg: number | null; desc_pct: number | null; pct_abaixo: number | null; clientes: number; notas: number; ticket: number | null }
type Cliente = { cod: string; cliente: string; cidade: string; val: number; kg: number; notas: number; preco_kg: number | null; desc_pct: number | null; pct_abaixo: number | null; ult_compra: string | null; dias: number | null }
type Cidade = { cidade: string; val: number; kg: number; clientes: number; preco_kg: number | null }
type Produto = { cod: string; produto: string; val: number; kg: number; preco_kg: number | null; desc_pct: number | null; pct_abaixo: number; clientes: number; despojo: boolean }
type Resumo = { val: number; kg: number; preco_kg: number | null; desc_pct: number | null; desconto: number; pct_abaixo: number | null; clientes: number; notas: number; ticket: number | null; produtos: number; vendedores: number }
type Anterior = { val: number; kg: number; preco_kg: number | null; desc_pct: number | null; desconto: number; pct_abaixo: number | null; clientes: number; notas: number }
type Painel = {
  ok: boolean; erro?: string; mensagem?: string
  periodo: { de: string; ate: string }
  escopo: { raiz: string; no: string; restrito: boolean }
  nos: No[]
  resumo: Resumo
  anterior: Anterior | null
  meses: { mes: string; val: number; kg: number }[]
  conc_top10: number | null
  referencia: { desc_pct: number | null; pct_abaixo: number | null; preco_kg: number | null }
  posicao: { lugar: number; de: number } | null
  dia: { dia: string; val: number; kg: number; notas: number }[]
  divisoes?: { linha: string; val: number; kg: number }[]
  clientes: Cliente[]
  cidades?: Cidade[]
  produtos: Produto[]
  cede_mais: string[]
  equipe: Equipe[]
  logistica?: { cargas: number; kg_carga: number | null; clientes_carga: number | null; notas_sem_carga: number; kg_sem_carga: number }
  cargas?: { carga: string; dia: string; transportador: string; notas: number; clientes: number; cidades: number; kg: number; val: number }[]
}

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const brlc = (v: number | null | undefined) => v == null ? '—' : Math.abs(v) >= 10000 ? 'R$ ' + nf({ notation: 'compact', maximumFractionDigits: 1 }).format(v) : brl(v)
const pct = (v: number | null | undefined, d = 1) => v == null ? '—' : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%'
const ton = (kg: number | null | undefined) => kg == null ? '—' : nf({ maximumFractionDigits: 1 }).format(kg / 1000) + ' t'
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const dataBR = (s: string) => { const [a, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${a}` }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const cap = (s: string) => (s || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
const mesCurto = (ym: string) => { const [, m] = ym.split('-'); return ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m)] ?? ym }

type PerKey = 'hoje' | 'semana' | '30' | 'mes' | 'ano' | 'custom'
const PERIODOS: { k: PerKey; rot: string }[] = [
  { k: 'hoje', rot: 'Hoje' }, { k: 'semana', rot: 'Semana' }, { k: '30', rot: '30 dias' },
  { k: 'mes', rot: 'Este mês' }, { k: 'ano', rot: 'Ano' }, { k: 'custom', rot: 'De–até' },
]
type AbaKey = 'geral' | 'vendedores' | 'clientes' | 'cidades' | 'produtos' | 'flex' | 'logistica' | 'metas'
const ABAS: { k: AbaKey; rot: string }[] = [
  { k: 'geral', rot: 'Visão geral' }, { k: 'vendedores', rot: 'Vendedores' }, { k: 'clientes', rot: 'Clientes' },
  { k: 'cidades', rot: 'Cidades' }, { k: 'produtos', rot: 'Produtos' }, { k: 'flex', rot: 'Flex' },
  { k: 'logistica', rot: 'Logística' }, { k: 'metas', rot: 'Metas' },
]

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 16, minWidth: 0, display: 'grid', gap: 8, alignContent: 'start' }
const th: CSSProperties = { position: 'sticky', top: 0, background: '#fff', textAlign: 'right', fontWeight: 600, color: C.m, padding: '8px 10px', borderBottom: `1px solid ${C.bd}`, whiteSpace: 'nowrap', fontSize: 12, zIndex: 1 }
const td: CSSProperties = { textAlign: 'right', padding: '8px 10px', borderBottom: `1px solid ${C.bg2}`, whiteSpace: 'nowrap', fontSize: 13, fontVariantNumeric: 'tabular-nums' }

function Titulo({ t, nota, ajuda }: { t: string; nota?: string; ajuda?: string }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>{t}{ajuda && <AjudaCampo chave={ajuda} rota={ROTA} />}</div>
      {nota && <div style={{ fontSize: 12, color: C.m }}>{nota}</div>}
    </div>
  )
}
function Chip({ v, a, b, d = 1 }: { v: number | null | undefined; a: number; b: number; d?: number }) {
  if (v == null) return <span style={{ color: C.d }}>—</span>
  const cor = v >= b ? C.bad : v >= a ? C.warn : C.ok
  return <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, border: `1px solid ${cor}`, color: cor, fontSize: 12 }}>{pct(v, d)}</span>
}
function BarraCelula({ v, max, txt, cor }: { v: number; max: number; txt: string; cor: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(48px, 1fr) auto', gap: 8, alignItems: 'center' }}>
      <i style={{ display: 'block', height: 8, borderRadius: 4, background: C.bg2 }}><b style={{ display: 'block', height: '100%', borderRadius: 4, width: `${max > 0 ? Math.max(2, 100 * v / max) : 0}%`, background: cor }} /></i>
      <span>{txt}</span>
    </div>
  )
}
function BarrasH({ dados, cor, fmt, refv }: { dados: { rot: string; v: number; destaque?: boolean }[]; cor: string; fmt: (v: number) => string; refv?: number | null }) {
  const max = Math.max(1e-9, ...dados.map((d) => d.v), refv ?? 0)
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {dados.length === 0 && <span style={{ fontSize: 13, color: C.m }}>Sem dado no período.</span>}
      {dados.map((d) => (
        <div key={d.rot} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 38%) 1fr auto', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.rot}>{d.rot}</span>
          <span style={{ position: 'relative', height: 14, background: C.bg2, borderRadius: 4 }}>
            <b style={{ position: 'absolute', inset: '0 auto 0 0', width: `${Math.max(1, 100 * d.v / max)}%`, background: d.destaque ? C.bad : cor, borderRadius: 4 }} />
            {refv != null && refv > 0 && <u style={{ position: 'absolute', top: -3, bottom: -3, width: 2, left: `${100 * refv / max}%`, background: C.esp }} />}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: C.m, minWidth: 64, textAlign: 'right' }}>{fmt(d.v)}</span>
        </div>
      ))}
    </div>
  )
}

// Gráfico de 12 meses (mês corrente destacado).
function BarrasMes({ dados }: { dados: { mes: string; val: number }[] }) {
  const mesAtual = new Date().toISOString().slice(0, 7)
  const max = Math.max(1, ...dados.map((d) => d.val))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 170, paddingTop: 18, overflowX: 'auto' }}>
      {dados.map((d) => {
        const atual = d.mes === mesAtual
        return (
          <div key={d.mes} title={`${mesCurto(d.mes)} · ${brl(d.val)}`} style={{ flex: '1 0 30px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 10, color: C.m }}>
            <span style={{ fontSize: 10, color: C.esp }}>{d.val > 0 ? brlc(d.val).replace('R$ ', '') : ''}</span>
            <i style={{ display: 'block', width: '100%', height: Math.max(3, 120 * d.val / max), background: atual ? C.esp : `linear-gradient(180deg, ${C.gold2}, ${C.gold})`, borderRadius: '5px 5px 0 0' }} />
            <span style={{ fontWeight: atual ? 700 : 400, color: atual ? C.esp : C.m }}>{mesCurto(d.mes)}</span>
          </div>
        )
      })}
    </div>
  )
}

// Seta de variação vs período anterior. inverso = "menor é melhor" (desconto, % abaixo).
function Variacao({ cur, ant, inverso }: { cur: number | null; ant: number | null | undefined; inverso?: boolean }) {
  if (cur == null || ant == null || ant === 0) return null
  const delta = 100 * (cur - ant) / Math.abs(ant)
  if (Math.abs(delta) < 0.05) return <span style={{ fontSize: 12, color: C.m }}>estável</span>
  const subiu = delta > 0
  const bom = inverso ? !subiu : subiu
  const cor = bom ? C.ok : C.bad
  return (
    <span style={{ fontSize: 12, color: cor, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {subiu ? <ArrowUp size={12} strokeWidth={2} /> : <ArrowDown size={12} strokeWidth={2} />}{nf({ maximumFractionDigits: 0 }).format(Math.abs(delta))}%
    </span>
  )
}

// ——— Tabela genérica: MOSTRAR TUDO (rolagem + cabeçalho fixo + busca + ordenação nos dois sentidos) ———
type Coluna<T> = {
  k: string; rot: string; ajuda?: string; esq?: boolean
  ordenar: (r: T) => number | string
  render: (r: T, max: number) => ReactNode
  max?: (rows: T[]) => number
}
function Tabela<T>({ cols, linhas, buscaTexto, buscaEm, inicialK, chaveRow, onRow, aberta }: {
  cols: Coluna<T>[]; linhas: T[]; buscaTexto: string; buscaEm: (r: T) => string
  inicialK: string; chaveRow: (r: T) => string; onRow?: (r: T) => (() => void) | undefined; aberta?: (r: T) => boolean
}) {
  const [ordK, setOrdK] = useState(inicialK)
  const [dir, setDir] = useState<1 | -1>(-1)
  const q = buscaTexto.trim().toLowerCase()
  const filtradas = useMemo(() => q ? linhas.filter((r) => buscaEm(r).toLowerCase().includes(q)) : linhas, [linhas, q, buscaEm])
  const col = cols.find((c) => c.k === ordK) ?? cols[0]
  const ordenadas = useMemo(() => {
    const arr = [...filtradas]
    arr.sort((a, b) => {
      const va = col.ordenar(a); const vb = col.ordenar(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'pt-BR') * dir
    })
    return arr
  }, [filtradas, col, dir])
  const maxs = useMemo(() => Object.fromEntries(cols.map((c) => [c.k, c.max ? c.max(ordenadas) : 1])), [cols, ordenadas])
  const clicar = (k: string) => { if (k === ordK) setDir((d) => (d === 1 ? -1 : 1)); else { setOrdK(k); setDir(-1) } }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 12, color: C.m }}>{ordenadas.length === linhas.length ? `${int(linhas.length)} linhas` : `${int(ordenadas.length)} de ${int(linhas.length)}`} · toque no cabeçalho para ordenar</div>
      <div style={{ overflow: 'auto', maxHeight: 560, border: `1px solid ${C.bd}`, borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.k} onClick={() => clicar(c.k)} style={{ ...th, textAlign: c.esq ? 'left' : 'right', cursor: 'pointer', userSelect: 'none' }} title="Ordenar">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexDirection: c.esq ? 'row' : 'row-reverse' }}>
                    {c.rot}{c.ajuda && <AjudaCampo chave={c.ajuda} rota={ROTA} />}
                    {ordK === c.k && (dir === 1 ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordenadas.length === 0 && <tr><td colSpan={cols.length} style={{ ...td, textAlign: 'center', color: C.m }}>Nenhuma linha para a busca.</td></tr>}
            {ordenadas.map((r) => {
              const h = onRow?.(r); const ab = aberta?.(r)
              return (
                <tr key={chaveRow(r)} onClick={h} style={{ cursor: h ? 'pointer' : 'default' }}>
                  {cols.map((c) => (
                    <td key={c.k} style={{ ...td, textAlign: c.esq ? 'left' : 'right', whiteSpace: c.esq ? 'normal' : 'nowrap', color: c.esq && ab ? C.gold : undefined, fontWeight: c.esq && ab ? 600 : undefined }}>
                      {c.render(r, maxs[c.k] ?? 1)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Leitura({ children }: { children: ReactNode }) {
  return <div style={{ ...card, borderLeft: `5px solid ${C.gold}`, fontSize: 14, color: C.esp, display: 'block' }}>{children}</div>
}
function Placeholder({ titulo, texto, ajuda }: { titulo: string; texto: string; ajuda?: string }) {
  return (
    <div style={{ ...card, borderStyle: 'dashed', color: C.m }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.esp, display: 'flex', alignItems: 'center', gap: 4 }}>{titulo}{ajuda && <AjudaCampo chave={ajuda} rota={ROTA} />}</div>
      <p style={{ margin: 0, fontSize: 14, maxWidth: '70ch' }}>{texto}</p>
    </div>
  )
}

export default function MeuPainelVendas() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [no, setNo] = useState<string | null>(null)
  const [per, setPer] = useState<PerKey>('30')
  const hojeISO = iso(new Date())
  const [deC, setDeC] = useState(hojeISO)
  const [ateC, setAteC] = useState(hojeISO)
  const [aba, setAba] = useState<AbaKey>('geral')
  const [verCod, setVerCod] = useState(false)
  const [busca, setBusca] = useState('')
  const [p, setP] = useState<Painel | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dica, setDica] = useState<string | null>(null)
  const [cidadeSel, setCidadeSel] = useState<string | null>(null)

  const intervalo = useMemo(() => {
    const hoje = new Date(); const ate = iso(hoje)
    if (per === 'hoje') return { de: ate, ate }
    if (per === 'semana') { const d = new Date(hoje); d.setDate(d.getDate() - 6); return { de: iso(d), ate } }
    if (per === 'mes') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate }
    if (per === 'ano') return { de: iso(new Date(hoje.getFullYear(), 0, 1)), ate }
    if (per === 'custom') return { de: deC <= ateC ? deC : ateC, ate: deC <= ateC ? ateC : deC }
    const d = new Date(hoje); d.setDate(d.getDate() - 29); return { de: iso(d), ate }
  }, [per, deC, ateC])

  const carregar = useCallback(async () => {
    if (!empresa) return
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_bi_comercial_painel', { p_company_id: empresa, p_no: no, p_de: intervalo.de, p_ate: intervalo.ate })
    setCarregando(false)
    if (error) { setErro(error.message); setP(null); return }
    setP(data as Painel)
  }, [empresa, no, intervalo])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { setBusca(''); setCidadeSel(null) }, [aba])

  const nos = p?.nos ?? []
  const nomeNo = nos.find((n) => n.no === p?.escopo.no)?.nome ?? '—'
  const trilha = useMemo(() => {
    if (!p) return [] as No[]
    const por = new Map(nos.map((n) => [n.no, n]))
    const cam: No[] = []; let n = por.get(p.escopo.no)
    while (n && cam.length < 10) { cam.unshift(n); n = n.pai ? por.get(n.pai) : undefined }
    return cam
  }, [p, nos])
  const ehVendedor = !!p?.posicao
  const r = p?.resumo; const ant = p?.anterior; const refv = p?.referencia
  const equipe = p?.equipe ?? []
  const clientes = p?.clientes ?? []
  const cidades = p?.cidades ?? []
  const produtos = p?.produtos ?? []
  const maxDia = Math.max(1, ...(p?.dia ?? []).map((d) => d.val))
  const totDiv = (p?.divisoes ?? []).reduce((s, d) => s + d.val, 0) || 1
  const maiorDesc = [...equipe].filter((e) => e.val > 5000).sort((a, b) => (b.desc_pct ?? 0) - (a.desc_pct ?? 0))[0]
  const abreNo = (ven: string) => nos.some((n) => n.no === ven) && ven !== p?.escopo.no
  const nomeComCod = (nome: string, cod: string) => verCod ? `${cod} · ${cap(nome)}` : cap(nome)

  const grade = (min: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 12, alignItems: 'start' })

  const kpiVar = (rot: string, chave: string, valor: string, cur: number | null, antv: number | null | undefined, sub: ReactNode, inverso?: boolean, cor?: string) => (
    <div style={{ ...card, gap: 2 }}>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(22px, 2.4vw, 30px)', lineHeight: 1.15, color: cor ?? C.esp, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><Variacao cur={cur} ant={antv} inverso={inverso} /><AjudaCampo chave="com.painel.variacao" rota={ROTA} /></span>
        <span>{sub}</span>
      </div>
    </div>
  )

  // Drill de cidade → clientes dessa cidade
  const clientesDaCidade = useMemo(() => cidadeSel ? clientes.filter((c) => c.cidade === cidadeSel) : [], [cidadeSel, clientes])

  return (
    <div style={{ background: C.off, minHeight: '100%', color: C.esp, padding: 'clamp(12px, 2.5vw, 28px)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gap: 16 }}>
        <header style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, color: C.m }}>Comercial · Meu painel de vendas · ao vivo · lido da venda detalhada (nota a nota) · atualiza a cada import</div>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px, 3.4vw, 34px)', fontFamily: 'Georgia, serif', fontWeight: 400 }}>{p?.ok ? nomeNo : 'Meu painel de vendas'}</h1>
          {p?.ok && r && (
            <p style={{ margin: 0, fontSize: 15, color: C.m, maxWidth: '80ch' }}>
              De <b style={{ color: C.esp }}>{dataBR(p.periodo.de)}</b> a <b style={{ color: C.esp }}>{dataBR(p.periodo.ate)}</b>: faturou <b style={{ color: C.esp }}>{brl(r.val)}</b> em <b style={{ color: C.esp }}>{ton(r.kg)}</b>.{' '}
              <b style={{ color: C.esp }}>{pct(r.pct_abaixo)}</b> dos itens saíram abaixo do preço de tabela, somando <b style={{ color: C.esp }}>{brl(r.desconto)}</b> de desconto.
            </p>
          )}
          {p?.ok && p.escopo.restrito && <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}><Lock size={13} strokeWidth={1.5} /> Você vê somente os seus dados{nos.length > 1 ? ' e os da sua equipe' : ''}.</div>}
        </header>

        {/* Barra de período / visão / opções — vale em TODAS as abas */}
        <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'flex-end' }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Período<AjudaCampo chave="com.painel.periodo" rota={ROTA} /></span>
            <div role="group" aria-label="Período" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PERIODOS.map((x) => (
                <button key={x.k} type="button" onClick={() => setPer(x.k)} aria-pressed={per === x.k}
                  style={{ font: 'inherit', fontSize: 13, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${per === x.k ? C.esp : C.bd}`, background: per === x.k ? C.esp : '#fff', color: per === x.k ? '#fff' : C.esp }}>{x.rot}</button>
              ))}
            </div>
          </div>
          {per === 'custom' && (
            <label style={{ display: 'grid', gap: 2, fontSize: 12, color: C.m }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Intervalo<AjudaCampo chave="com.painel.datas" rota={ROTA} /></span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="date" value={deC} max={hojeISO} onChange={(e) => setDeC(e.target.value)} aria-label="De" style={{ font: 'inherit', fontSize: 13, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.bd}`, color: C.esp }} />
                <span>até</span>
                <input type="date" value={ateC} max={hojeISO} onChange={(e) => setAteC(e.target.value)} aria-label="Até" style={{ font: 'inherit', fontSize: 13, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.bd}`, color: C.esp }} />
              </span>
            </label>
          )}
          {p?.ok && nos.length > 1 && (
            <label style={{ display: 'grid', gap: 2, fontSize: 12, color: C.m }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Visão (cascata da equipe)<AjudaCampo chave="com.painel.visao" rota={ROTA} /></span>
              <select value={p.escopo.no} onChange={(e) => setNo(e.target.value)} aria-label="Visão"
                style={{ font: 'inherit', fontSize: 14, padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp, minWidth: 200, maxWidth: '80vw' }}>
                {nos.map((n) => <option key={n.no} value={n.no}>{n.nome}</option>)}
              </select>
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.esp, cursor: 'pointer' }}>
            <input type="checkbox" checked={verCod} onChange={(e) => setVerCod(e.target.checked)} aria-label="Ver código" />
            Ver código<AjudaCampo chave="com.painel.vercodigo" rota={ROTA} />
          </label>
          {carregando && <span style={{ fontSize: 12, color: C.m }}>atualizando…</span>}
        </div>

        {trilha.length > 1 && (
          <nav aria-label="Trilha da visão" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 12 }}>
            {trilha.map((n, i) => (
              <span key={n.no} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <ChevronRight size={12} strokeWidth={1.5} />}
                <button type="button" onClick={() => setNo(n.no)} aria-current={n.no === p?.escopo.no}
                  style={{ font: 'inherit', fontSize: 12, borderRadius: 999, padding: '3px 10px', cursor: 'pointer', border: `1px solid ${n.no === p?.escopo.no ? C.esp : C.bd}`, background: n.no === p?.escopo.no ? C.esp : '#fff', color: n.no === p?.escopo.no ? '#fff' : C.esp }}>{n.nome}</button>
              </span>
            ))}
          </nav>
        )}

        {/* Abas */}
        <div role="tablist" aria-label="Análises" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, borderBottom: `1px solid ${C.bd}` }}>
          {ABAS.map((x) => (
            <button key={x.k} role="tab" aria-selected={aba === x.k} type="button" onClick={() => setAba(x.k)}
              style={{ font: 'inherit', fontSize: 14, fontWeight: aba === x.k ? 600 : 400, padding: '8px 14px', whiteSpace: 'nowrap', cursor: 'pointer', border: 0, borderBottom: `3px solid ${aba === x.k ? C.gold : 'transparent'}`, background: 'none', color: aba === x.k ? C.esp : C.m }}>
              {x.rot}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', alignSelf: 'center' }}><AjudaCampo chave="com.painel.abas" rota={ROTA} /></span>
        </div>

        {!empresa && <div style={card}>Escolha uma empresa no topo para ver o painel.</div>}
        {erro && <div role="alert" style={{ ...card, borderColor: C.bad, color: C.bad }}>Não foi possível carregar: {erro}</div>}
        {p && !p.ok && <div style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>{p.mensagem}</div>}
        {carregando && !p && <div style={card}>Carregando…</div>}

        {/* Campo de busca (abas de lista) */}
        {p?.ok && r && ['vendedores', 'clientes', 'cidades', 'produtos'].includes(aba) && (
          <label style={{ display: 'grid', gap: 2, fontSize: 12, color: C.m, maxWidth: 420 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Buscar<AjudaCampo chave="com.painel.busca" rota={ROTA} /></span>
            <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome ou código…" aria-label="Buscar na lista"
              style={{ font: 'inherit', fontSize: 14, padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.bd}`, color: C.esp }} />
          </label>
        )}

        {p?.ok && r && (
          <>
            {/* ===================== VISÃO GERAL ===================== */}
            {aba === 'geral' && (
              <>
                <section style={grade(170)} aria-label="Indicadores">
                  {kpiVar('Faturamento', 'com.painel.faturado', brlc(r.val), r.val, ant?.val, <>ticket {brl(r.ticket)}</>)}
                  {kpiVar('Volume', 'com.painel.volume', ton(r.kg), r.kg, ant?.kg, <>{int(r.notas)} notas</>)}
                  {kpiVar('Preço médio', 'com.painel.preco', brl2(r.preco_kg), r.preco_kg, ant?.preco_kg, 'R$/kg sem despojo')}
                  {kpiVar('Abaixo da tabela', 'com.painel.flex', pct(r.pct_abaixo), r.pct_abaixo, ant?.pct_abaixo, 'dos itens', true, (r.pct_abaixo ?? 0) >= 50 ? C.bad : undefined)}
                  {kpiVar('Flex gasto', 'com.painel.flex', brlc(r.desconto), r.desconto, ant?.desconto, 'desconto concedido', true)}
                  {kpiVar('Clientes', 'com.painel.clientes', int(r.clientes), r.clientes, ant?.clientes, <>top 10 = {pct(p.conc_top10)}</>)}
                </section>

                <Leitura>
                  <b>Leitura rápida:</b>{' '}
                  {equipe[0] ? <>Maior vendedor: <b>{equipe[0].nome}</b> ({brl(equipe[0].val)}). </> : null}
                  {maiorDesc ? <>Quem mais deu desconto: <b>{maiorDesc.nome}</b> ({pct(maiorDesc.desc_pct, 1)}) — vale conversa. </> : null}
                  {produtos[0] ? <>Produto que mais fatura: <b>{cap(produtos[0].produto)}</b>.</> : null}
                </Leitura>

                <section style={card} aria-label="Faturamento por mês">
                  <Titulo t="Faturamento por mês" nota="12 meses corridos. O mês corrente (em espresso) ainda está em andamento." ajuda="com.painel.meses" />
                  <BarrasMes dados={p.meses ?? []} />
                </section>

                <section style={grade(380)} aria-label="Top vendedores e cidades">
                  <div style={card}>
                    <Titulo t="Top vendedores" nota="Por faturamento no período. Ordene na tabela da aba Vendedores." ajuda="com.painel.equipe" />
                    <BarrasH cor={C.gold} fmt={(v) => brlc(v)} dados={[...equipe].sort((a, b) => b.val - a.val).map((e) => ({ rot: e.nome, v: e.val }))} />
                  </div>
                  <div style={card}>
                    <Titulo t="Top cidades" nota="Por volume (kg) no período." ajuda="com.painel.cidades" />
                    <BarrasH cor={C.verde} fmt={(v) => int(v) + ' kg'} dados={[...cidades].sort((a, b) => b.kg - a.kg).map((c) => ({ rot: c.cidade, v: c.kg }))} />
                  </div>
                </section>

                <section style={grade(380)} aria-label="Vendas">
                  <div style={card}>
                    <Titulo t="Faturamento por dia" nota="Notas de venda, valor líquido. Toque numa barra para ver volume e notas." />
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 190, paddingTop: 18, overflowX: 'auto' }}>
                      {p.dia.length === 0 && <span style={{ fontSize: 13, color: C.m }}>Sem venda no período.</span>}
                      {p.dia.map((d) => (
                        <button key={d.dia} type="button" onClick={() => setDica(`${dataBR(d.dia)} · ${brl(d.val)} · ${int(d.kg)} kg · ${d.notas} notas`)}
                          title={`${dataBR(d.dia)} · ${brl(d.val)} · ${int(d.kg)} kg · ${d.notas} notas`}
                          style={{ flex: '1 0 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 10, color: C.m, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}>
                          <span style={{ fontSize: 10, color: C.esp }}>{brlc(d.val).replace('R$ ', '')}</span>
                          <i style={{ display: 'block', width: '100%', height: Math.max(3, 140 * d.val / maxDia), background: `linear-gradient(180deg, ${C.gold2}, ${C.gold})`, borderRadius: '5px 5px 0 0' }} />
                          <span>{dataBR(d.dia).slice(0, 5)}</span>
                        </button>
                      ))}
                    </div>
                    {dica && <div role="status" style={{ fontSize: 12, color: C.esp, background: C.bg2, borderRadius: 8, padding: '6px 10px' }}>{dica}</div>}
                  </div>
                  <div style={card}>
                    <Titulo t="Mix por linha de produto" nota="Participação de cada linha no faturamento." />
                    <BarrasH cor={C.azul} fmt={(v) => pct(v)} dados={(p.divisoes ?? []).map((d) => ({ rot: cap(d.linha), v: 100 * d.val / totDiv }))} />
                  </div>
                </section>

                <section style={{ ...card, borderLeft: `5px solid ${C.gold}` }} aria-label="Leituras para a decisão">
                  <Titulo t="Leituras para a decisão" ajuda="com.painel.leituras" />
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
                    <li><b>Preço:</b> {pct(r.pct_abaixo)} dos itens foram vendidos abaixo da tabela{refv?.pct_abaixo != null && p.escopo.no !== 'empresa' ? <> (empresa: {pct(refv.pct_abaixo)})</> : null}. O desconto médio é {pct(r.desc_pct, 2)}: {brl(r.desconto)} no período.</li>
                    {!ehVendedor && maiorDesc && <li><b>Quem mais concede desconto:</b> {maiorDesc.nome}, com {pct(maiorDesc.desc_pct, 2)} e {pct(maiorDesc.pct_abaixo)} dos itens abaixo da tabela.</li>}
                    {p.cede_mais.length > 0 && <li><b>Onde mais se cede preço:</b> {p.cede_mais.map(cap).join(', ')} — todos os itens abaixo da tabela.</li>}
                    <li><b>Concentração:</b> os 10 maiores clientes somam {pct(p.conc_top10)} do faturamento desta visão.</li>
                    {produtos[0] && <li><b>Produto que mais fatura:</b> {cap(produtos[0].produto)} ({brl(produtos[0].val)}, {brl2(produtos[0].preco_kg)}/kg).</li>}
                    <li><b>Metas:</b> o ERP de origem ainda não tem cota cadastrada. Com a meta, o painel mostra realizado × meta.<AjudaCampo chave="com.painel.meta" rota={ROTA} /></li>
                  </ul>
                </section>
              </>
            )}

            {/* ===================== VENDEDORES ===================== */}
            {aba === 'vendedores' && (
              <>
                <Leitura><b>Leitura:</b> {equipe.length} vendedores no período. {equipe[0] ? <>Maior: <b>{equipe[0].nome}</b> ({brl(equipe[0].val)}). </> : null}{maiorDesc ? <>Mais desconto: <b>{maiorDesc.nome}</b> ({pct(maiorDesc.desc_pct, 1)}).</> : null}</Leitura>
                {ehVendedor && p.posicao && <div style={{ ...card, borderLeft: `5px solid ${C.gold}` }}>Sua posição: <b>{p.posicao.lugar}º</b> em faturamento, entre {p.posicao.de} vendedores.</div>}
                <section style={card} aria-label="Vendedores">
                  <Titulo t="Vendedores" nota="Toque num vendedor para abrir a visão dele. Semáforo do desconto: verde ok, amarelo atenção, vermelho acima do normal." ajuda="com.painel.equipe" />
                  <Tabela<Equipe>
                    linhas={equipe} buscaTexto={busca} buscaEm={(e) => `${e.nome} ${e.ven}`} inicialK="val" chaveRow={(e) => e.ven}
                    onRow={(e) => abreNo(e.ven) ? () => setNo(e.ven) : undefined} aberta={(e) => abreNo(e.ven)}
                    cols={[
                      { k: 'nome', rot: 'Vendedor', esq: true, ordenar: (e) => e.nome, render: (e) => nomeComCod(e.nome, e.ven) },
                      { k: 'val', rot: 'Faturamento', ordenar: (e) => e.val, max: (rs) => Math.max(1, ...rs.map((x) => x.val)), render: (e, mx) => <BarraCelula v={e.val} max={mx} txt={brl(e.val)} cor={C.gold} /> },
                      { k: 'kg', rot: 'Volume (kg)', ordenar: (e) => e.kg, render: (e) => int(e.kg) },
                      { k: 'rpkg', rot: 'R$/kg carne', ajuda: 'com.painel.rpkg', ordenar: (e) => e.preco_kg ?? 0, render: (e) => brl2(e.preco_kg) },
                      { k: 'desc', rot: 'Desconto', ajuda: 'com.painel.flex', ordenar: (e) => e.desc_pct ?? 0, render: (e) => <Chip v={e.desc_pct} a={1} b={2} d={2} /> },
                      { k: 'pa', rot: 'Itens abaixo', ordenar: (e) => e.pct_abaixo ?? 0, render: (e) => <Chip v={e.pct_abaixo} a={40} b={70} /> },
                      { k: 'cli', rot: 'Clientes', ordenar: (e) => e.clientes, render: (e) => int(e.clientes) },
                      { k: 'nt', rot: 'Notas', ordenar: (e) => e.notas, render: (e) => int(e.notas) },
                      { k: 'tk', rot: 'Ticket médio', ordenar: (e) => e.ticket ?? 0, render: (e) => brl(e.ticket) },
                    ]}
                  />
                </section>
                <section style={grade(380)}>
                  <div style={card}>
                    <Titulo t="Desconto sobre a tabela, por vendedor" nota="Em vermelho, acima de 2%." ajuda="com.painel.flex" />
                    <BarrasH cor={C.gold} fmt={(v) => pct(v, 2)} dados={equipe.filter((e) => e.val > 5000).sort((a, b) => (b.desc_pct ?? 0) - (a.desc_pct ?? 0)).map((e) => ({ rot: e.nome, v: Math.max(0, e.desc_pct ?? 0), destaque: (e.desc_pct ?? 0) >= 2 }))} />
                  </div>
                  <div style={card}>
                    <Titulo t="Preço médio da carne, por vendedor" nota="R$ por kg. O traço é a média desta visão." ajuda="com.painel.rpkg" />
                    <BarrasH cor={C.verde} fmt={(v) => brl2(v)} refv={r.preco_kg} dados={equipe.filter((e) => e.preco_kg != null && e.kg > 500).sort((a, b) => (b.preco_kg ?? 0) - (a.preco_kg ?? 0)).map((e) => ({ rot: e.nome, v: e.preco_kg ?? 0 }))} />
                  </div>
                </section>
              </>
            )}

            {/* ===================== CLIENTES ===================== */}
            {aba === 'clientes' && (
              <>
                <Leitura><b>Leitura:</b> {int(r.clientes)} clientes no período; os 10 maiores concentram <b>{pct(p.conc_top10)}</b> do faturamento. Clientes parados há mais de 30 dias aparecem sinalizados em <span style={{ color: C.bad }}>vermelho</span>.</Leitura>
                <section style={card} aria-label="Clientes">
                  <Titulo t="Clientes" nota="Cada loja pelo seu código no ERP de origem. Recência = dias desde a última compra (12 meses)." />
                  <Tabela<Cliente>
                    linhas={clientes} buscaTexto={busca} buscaEm={(c) => `${c.cliente} ${c.cod} ${c.cidade}`} inicialK="val" chaveRow={(c) => c.cod}
                    cols={[
                      { k: 'cliente', rot: 'Cliente', esq: true, ordenar: (c) => c.cliente, render: (c) => <><span>{nomeComCod(c.cliente, c.cod)}</span><div style={{ fontSize: 11, color: C.m }}>{c.cidade}</div></> },
                      { k: 'val', rot: 'Faturamento', ordenar: (c) => c.val, max: (rs) => Math.max(1, ...rs.map((x) => x.val)), render: (c, mx) => <BarraCelula v={c.val} max={mx} txt={brl(c.val)} cor={C.verde} /> },
                      { k: 'kg', rot: 'Volume (kg)', ordenar: (c) => c.kg, render: (c) => int(c.kg) },
                      { k: 'rpkg', rot: 'R$/kg', ajuda: 'com.painel.rpkg', ordenar: (c) => c.preco_kg ?? 0, render: (c) => brl2(c.preco_kg) },
                      { k: 'desc', rot: 'Desconto', ajuda: 'com.painel.flex', ordenar: (c) => c.desc_pct ?? 0, render: (c) => <Chip v={c.desc_pct} a={1} b={2} d={2} /> },
                      { k: 'nt', rot: 'Notas', ordenar: (c) => c.notas, render: (c) => int(c.notas) },
                      { k: 'rec', rot: 'Última compra', ajuda: 'com.painel.recencia', ordenar: (c) => c.dias ?? 9999, render: (c) => c.ult_compra ? <span style={{ color: (c.dias ?? 0) > 30 ? C.bad : C.esp }}>{dataBR(c.ult_compra)} <span style={{ fontSize: 11, color: C.m }}>({int(c.dias)}d)</span></span> : '—' },
                    ]}
                  />
                </section>
              </>
            )}

            {/* ===================== CIDADES ===================== */}
            {aba === 'cidades' && (
              <>
                <Leitura><b>Leitura:</b> {cidades.length} cidades (praças) no período{cidades[0] ? <>; a maior é <b>{cidades[0].cidade}</b> ({brl(cidades[0].val)}).</> : '.'} Toque numa cidade para ver os clientes dela.</Leitura>
                {cidadeSel && (
                  <section style={{ ...card, borderLeft: `5px solid ${C.gold}` }} aria-label={`Clientes de ${cidadeSel}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <Titulo t={`Clientes em ${cap(cidadeSel)}`} nota={`${clientesDaCidade.length} clientes nesta praça`} />
                      <button type="button" onClick={() => setCidadeSel(null)} aria-label="Fechar" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: 'inherit', fontSize: 12, padding: '6px 10px', borderRadius: 999, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp, cursor: 'pointer' }}><X size={13} /> Fechar</button>
                    </div>
                    <div style={{ overflow: 'auto', maxHeight: 360 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr><th style={{ ...th, textAlign: 'left' }}>Cliente</th><th style={th}>Faturamento</th><th style={th}>Volume (kg)</th><th style={th}>R$/kg</th></tr></thead>
                        <tbody>
                          {clientesDaCidade.sort((a, b) => b.val - a.val).map((c) => (
                            <tr key={c.cod}><td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>{nomeComCod(c.cliente, c.cod)}</td><td style={td}>{brl(c.val)}</td><td style={td}>{int(c.kg)}</td><td style={td}>{brl2(c.preco_kg)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                <section style={card} aria-label="Cidades">
                  <Titulo t="Cidades (praças)" nota="Nomes normalizados (sem duplicar por maiúscula/acento). Toque para abrir os clientes." ajuda="com.painel.cidades" />
                  <Tabela<Cidade>
                    linhas={cidades} buscaTexto={busca} buscaEm={(c) => c.cidade} inicialK="val" chaveRow={(c) => c.cidade}
                    onRow={(c) => () => setCidadeSel(c.cidade)} aberta={() => true}
                    cols={[
                      { k: 'cidade', rot: 'Cidade', esq: true, ordenar: (c) => c.cidade, render: (c) => cap(c.cidade) },
                      { k: 'val', rot: 'Faturamento', ordenar: (c) => c.val, max: (rs) => Math.max(1, ...rs.map((x) => x.val)), render: (c, mx) => <BarraCelula v={c.val} max={mx} txt={brl(c.val)} cor={C.verde} /> },
                      { k: 'kg', rot: 'Volume (kg)', ordenar: (c) => c.kg, render: (c) => int(c.kg) },
                      { k: 'rpkg', rot: 'R$/kg', ajuda: 'com.painel.rpkg', ordenar: (c) => c.preco_kg ?? 0, render: (c) => brl2(c.preco_kg) },
                      { k: 'cli', rot: 'Clientes', ordenar: (c) => c.clientes, render: (c) => int(c.clientes) },
                    ]}
                  />
                </section>
              </>
            )}

            {/* ===================== PRODUTOS ===================== */}
            {aba === 'produtos' && (
              <>
                <Leitura><b>Leitura:</b> {produtos.length} cortes no período{produtos[0] ? <>; o que mais fatura é <b>{cap(produtos[0].produto)}</b> ({brl2(produtos[0].preco_kg)}/kg).</> : '.'} <b>Sem margem</b>: o custo do ERP de origem vem zerado — não inventamos número.</Leitura>
                <section style={card} aria-label="Produtos">
                  <Titulo t="Produtos (cortes)" nota="Volume, preço médio e flex por corte. Despojo (couro/miúdos) sinalizado." ajuda="com.painel.produtos" />
                  <Tabela<Produto>
                    linhas={produtos} buscaTexto={busca} buscaEm={(x) => `${x.produto} ${x.cod}`} inicialK="val" chaveRow={(x) => x.cod}
                    cols={[
                      { k: 'produto', rot: 'Produto', esq: true, ordenar: (x) => x.produto, render: (x) => <span>{nomeComCod(x.produto, x.cod)}{x.despojo && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 999, background: C.bg2, color: C.m }}>despojo</span>}</span> },
                      { k: 'val', rot: 'Faturamento', ordenar: (x) => x.val, max: (rs) => Math.max(1, ...rs.map((y) => y.val)), render: (x, mx) => <BarraCelula v={x.val} max={mx} txt={brl(x.val)} cor={C.azul} /> },
                      { k: 'kg', rot: 'Volume (kg)', ordenar: (x) => x.kg, render: (x) => int(x.kg) },
                      { k: 'rpkg', rot: 'R$/kg', ajuda: 'com.painel.rpkg', ordenar: (x) => x.preco_kg ?? 0, render: (x) => brl2(x.preco_kg) },
                      { k: 'desc', rot: 'Desconto', ajuda: 'com.painel.flex', ordenar: (x) => x.desc_pct ?? 0, render: (x) => x.desc_pct != null ? <Chip v={x.desc_pct} a={1} b={2} d={2} /> : '—' },
                      { k: 'pa', rot: 'Itens abaixo', ordenar: (x) => x.pct_abaixo, render: (x) => <Chip v={x.pct_abaixo} a={40} b={70} /> },
                      { k: 'cli', rot: 'Clientes', ordenar: (x) => x.clientes, render: (x) => int(x.clientes) },
                    ]}
                  />
                </section>
              </>
            )}

            {/* ===================== FLEX ===================== */}
            {aba === 'flex' && (
              <>
                <Leitura><b>Leitura:</b> no período, {brl(r.desconto)} de desconto concedido ({pct(r.desc_pct, 2)} sobre a tabela). Abaixo, onde o flex mais aparece — por vendedor, produto e cliente.</Leitura>
                <section style={grade(380)} aria-label="Flex consolidado">
                  <div style={card}>
                    <Titulo t="Flex por vendedor" nota="Desconto médio sobre a tabela. Vermelho acima de 2%." ajuda="com.painel.flex" />
                    <BarrasH cor={C.gold} fmt={(v) => pct(v, 2)} dados={equipe.filter((e) => e.val > 5000 && (e.desc_pct ?? 0) > 0).sort((a, b) => (b.desc_pct ?? 0) - (a.desc_pct ?? 0)).map((e) => ({ rot: e.nome, v: e.desc_pct ?? 0, destaque: (e.desc_pct ?? 0) >= 2 }))} />
                  </div>
                  <div style={card}>
                    <Titulo t="Flex por produto" nota="Cortes com mais desconto sobre a tabela." ajuda="com.painel.flex" />
                    <BarrasH cor={C.azul} fmt={(v) => pct(v, 2)} dados={produtos.filter((x) => (x.desc_pct ?? 0) > 0).sort((a, b) => (b.desc_pct ?? 0) - (a.desc_pct ?? 0)).slice(0, 20).map((x) => ({ rot: cap(x.produto), v: x.desc_pct ?? 0, destaque: (x.desc_pct ?? 0) >= 2 }))} />
                  </div>
                  <div style={card}>
                    <Titulo t="Flex por cliente" nota="Clientes com mais desconto sobre a tabela." ajuda="com.painel.flex" />
                    <BarrasH cor={C.verde} fmt={(v) => pct(v, 2)} dados={clientes.filter((c) => (c.desc_pct ?? 0) > 0).sort((a, b) => (b.desc_pct ?? 0) - (a.desc_pct ?? 0)).slice(0, 20).map((c) => ({ rot: cap(c.cliente), v: c.desc_pct ?? 0, destaque: (c.desc_pct ?? 0) >= 2 }))} />
                  </div>
                </section>
              </>
            )}

            {/* ===================== LOGÍSTICA ===================== */}
            {aba === 'logistica' && (
              <>
                {p.logistica && p.logistica.cargas > 0 ? (
                  <section style={{ display: 'grid', gap: 12 }} aria-label="Logística de saída">
                    <Leitura><b>Leitura:</b> {int(p.logistica.cargas)} cargas montadas no período, {int(p.logistica.kg_carga)} kg por carga em média.</Leitura>
                    <div style={grade(170)}>
                      {kpiVar('Cargas montadas', 'com.painel.logistica', int(p.logistica.cargas), null, null, 'no período')}
                      {kpiVar('Peso médio por carga', 'com.painel.logistica', `${int(p.logistica.kg_carga)} kg`, null, null, 'peso líquido vendido')}
                      {kpiVar('Clientes por carga', 'com.painel.logistica', nf({ maximumFractionDigits: 1 }).format(p.logistica.clientes_carga ?? 0), null, null, 'entregas em média')}
                      {kpiVar('Notas sem carga', 'com.painel.logistica', int(p.logistica.notas_sem_carga), null, null, <>{int(p.logistica.kg_sem_carga)} kg retirados/sem romaneio</>)}
                    </div>
                    <div style={card}>
                      <Titulo t="Cargas do período" nota="Cada carga com notas, clientes, cidades, peso e valor. Na visão de um vendedor, só a parte dele." />
                      <div style={{ overflow: 'auto', maxHeight: 480 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead><tr><th style={{ ...th, textAlign: 'left' }}>Data</th><th style={th}>Carga</th><th style={{ ...th, textAlign: 'left' }}>Transportador</th><th style={th}>Notas</th><th style={th}>Clientes</th><th style={th}>Cidades</th><th style={th}>Peso (kg)</th><th style={th}>Valor</th></tr></thead>
                          <tbody>
                            {(p.cargas ?? []).map((c) => (
                              <tr key={c.carga}>
                                <td style={{ ...td, textAlign: 'left' }}>{dataBR(c.dia)}</td><td style={td}>{c.carga}</td>
                                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 160 }}>{cap(c.transportador)}</td>
                                <td style={td}>{int(c.notas)}</td><td style={td}>{int(c.clientes)}</td><td style={td}>{int(c.cidades)}</td><td style={td}>{int(c.kg)}</td><td style={td}>{brl(c.val)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                ) : (
                  <Placeholder titulo="Logística de saída" ajuda="com.painel.logistica" texto="Sem cargas/romaneios no período para esta visão. O frete por placa (integração Brasil Sat) entra numa onda posterior — a aba já está preparada para recebê-lo." />
                )}
              </>
            )}

            {/* ===================== METAS ===================== */}
            {aba === 'metas' && (
              <Placeholder titulo="Metas" ajuda="com.painel.meta" texto="O ERP de origem ainda não envia cota/meta de venda. Quando a meta for cadastrada, esta aba mostra realizado × meta por vendedor, produto e cidade — sem inventar número enquanto não houver o dado." />
            )}
          </>
        )}
      </div>
    </div>
  )
}

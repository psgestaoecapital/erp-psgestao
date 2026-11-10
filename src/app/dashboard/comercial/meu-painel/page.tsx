'use client'
// Comercial › Meu painel de vendas — v5 (CEO 07/11/2026, validar com a Franciele/Frioeste).
// Esta tela desenha; TODO o cálculo vive em ./motor-v5 (porte fiel de docs/prototipos/bi-comercial-v5/logica.js),
// alimentado pela RPC fn_bi_comercial_base (item 1, em produção), que trava o escopo no banco pelo vínculo do usuário
// com o código de vendedor do ERP de origem (fn_bi_comercial_scope / com_vendedor_acesso). Vendedor vê só a própria
// venda; líder vê a empresa toda. Nada aqui decide escopo — recebe a base já filtrada e só renderiza.
// 8 ABAS (Visão geral · Vendedores · Clientes · Cidades · Produtos · Preço e desconto · Logística · Metas). AO VIVO (lê a
// venda detalhada, nota a nota), MOSTRAR TUDO (rolagem + cabeçalho fixo + busca + ordenação nos dois sentidos), DRILL ao
// clicar, filtros de período no topo, engrenagem para o que entra na análise (despojo fora por padrão), cada aba abre com
// uma leitura automática. Identidade PS (espresso/dourado/off-white). Celular (390px) e notebook.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { Lock, ChevronRight, ChevronDown, ChevronUp, ArrowUp, ArrowDown, X, SlidersHorizontal } from 'lucide-react'
import {
  calcularModelo, estadoPadrao, maxDia, gruposProduto, resumo,
  type BaseV5, type EstadoV5, type ModeloV5, type GrupoProduto,
} from './motor-v5'
import { AbaConcentracao } from './AbaConcentracao'
import { AbaRanking } from './AbaRanking'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', gold2: '#E0B048', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', ok: '#1a8f63', warn: '#b07a12', bad: '#C0392B', bg2: '#F0ECE3', azul: '#2f6f8f', verde: '#3f7d4e' }
const ROTA = '/dashboard/comercial/meu-painel'

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
// índice de dia (dias desde base.de) -> data ISO
const diaISO = (de: string, d: number) => { const dt = new Date(de + 'T00:00:00'); dt.setDate(dt.getDate() + d); return iso(dt) }

type PerKey = 'hoje' | 'semana' | '30' | 'mes' | 'ano' | 'custom'
const PERIODOS: { k: PerKey; rot: string }[] = [
  { k: 'hoje', rot: 'Hoje' }, { k: 'semana', rot: 'Semana' }, { k: '30', rot: '30 dias' },
  { k: 'mes', rot: 'Este mês' }, { k: 'ano', rot: 'Ano' }, { k: 'custom', rot: 'De–até' },
]
type AbaKey = 'geral' | 'vendedores' | 'ranking' | 'clientes' | 'cidades' | 'produtos' | 'concentracao' | 'flex' | 'logistica' | 'metas'
const ABAS: { k: AbaKey; rot: string }[] = [
  { k: 'geral', rot: 'Visão geral' }, { k: 'vendedores', rot: 'Vendedores' }, { k: 'ranking', rot: 'Ranking' },
  { k: 'clientes', rot: 'Clientes' },
  { k: 'cidades', rot: 'Cidades' }, { k: 'produtos', rot: 'Produtos' }, { k: 'concentracao', rot: 'Concentração' },
  { k: 'flex', rot: 'Preço e desconto' }, { k: 'logistica', rot: 'Logística' }, { k: 'metas', rot: 'Metas' },
]
// Segmentos de cliente (motor: 0..5) e curva ABC (0..2) — nomes e cores do protótipo v5.
const SEG = [
  { rot: 'Campeões', cor: C.verde }, { rot: 'Fiéis', cor: C.azul }, { rot: 'Novos', cor: C.gold },
  { rot: 'Ocasionais', cor: C.m }, { rot: 'Em risco', cor: C.warn }, { rot: 'Sumindo', cor: C.bad },
]
const CUR = ['A', 'B', 'C']
// Grupo de produto (motor): 0 desossado, 1 com osso, 2 miúdo, 3 subproduto/outros.
const LINHAS: { k: GrupoProduto; rot: string }[] = [
  { k: 0, rot: 'Desossados' }, { k: 1, rot: 'Com osso' }, { k: 2, rot: 'Miúdos' }, { k: 3, rot: 'Subprodutos e outros' },
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
// Seta de variação (metade 2 × metade 1 do período, normalizada por dias corridos). inverso = "menor é melhor".
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

// Linhas derivadas (o motor já calculou os agregados; aqui só extraímos o que a tabela mostra).
type RVen = { vi: number; cod: string; nome: string; val: number; part: number; cli: number; notas: number; ticket: number | null; rpkg: number | null; idx: number | null; desc: number; pa: number; dev: number; pz: number | null }
type RCli = { ci: number; nome: string; cidade: string; seg: number; cur: number; val: number; part: number; rpkg: number | null; descPct: number; r: number; f: number; notas: number; dev: number }
type RProd = { pi: number; nome: string; linha: string; grupo: number; val: number; part: number; kg: number; rpkg: number | null; desc: number; pa: number; cli: number; incluido: boolean }
type RCid = { ci: number; nome: string; val: number; part: number; kg: number; rpkg: number | null; cli: number; ven: number }
type RTr = { ti: number; nome: string; val: number; kg: number; notas: number; cli: number }

export default function MeuPainelVendas() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [per, setPer] = useState<PerKey>('30')
  const hojeISO = iso(new Date())
  const [deC, setDeC] = useState(hojeISO)
  const [ateC, setAteC] = useState(hojeISO)
  const [aba, setAba] = useState<AbaKey>('geral')
  const [verCod, setVerCod] = useState(false)
  const [busca, setBusca] = useState('')
  const [base, setBase] = useState<BaseV5 | null>(null)
  const [estado, setEstado] = useState<EstadoV5 | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dica, setDica] = useState<string | null>(null)
  const [cidadeSel, setCidadeSel] = useState<number | null>(null)
  const [diaModo, setDiaModo] = useState<'dia' | 'semana'>('dia')
  const [engrenagem, setEngrenagem] = useState(false)

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
    const { data, error } = await supabase.rpc('fn_bi_comercial_base', { p_company_id: empresa, p_de: intervalo.de, p_ate: intervalo.ate })
    setCarregando(false)
    if (error) { setErro(erroAmigavel(error)); setBase(null); return }
    setBase(data as BaseV5)
  }, [empresa, intervalo])
  useEffect(() => { void carregar() }, [carregar])
  // Base nova → estado padrão (análise padrão: só carne, escopo preço). Também zera busca/drill ao trocar de aba.
  useEffect(() => { setEstado(base ? estadoPadrao(base) : null) }, [base])
  useEffect(() => { setBusca(''); setCidadeSel(null) }, [aba])

  const pg = useMemo<GrupoProduto[] | null>(() => base ? gruposProduto(base) : null, [base])
  const modelo = useMemo<ModeloV5 | null>(() => base && estado && pg ? calcularModelo(base, estado, pg) : null, [base, estado, pg])
  const r = useMemo(() => modelo ? resumo(modelo) : null, [modelo])

  const setVen = (v: EstadoV5['ven']) => setEstado((e) => e ? { ...e, ven: v } : e)
  const setLin = (v: EstadoV5['lin']) => setEstado((e) => e ? { ...e, lin: v } : e)

  // Linhas derivadas por aba ------------------------------------------------
  const venRows = useMemo<RVen[]>(() => {
    if (!modelo || !base) return []
    const tv = modelo.tot.val || 1
    return [...modelo.venM].map(([vi, a]) => ({
      vi, cod: base.ven[vi]?.[0] ?? String(vi), nome: base.ven[vi]?.[1] ?? 'Sem vendedor',
      val: a.val, part: 100 * a.val / tv, cli: a.clis.size, notas: a.notas.size,
      ticket: a.notas.size ? a.val / a.notas.size : null, rpkg: a.kgP ? a.valP / a.kgP : null,
      idx: a.exp > 0 ? 100 * a.val / a.exp : null, desc: a.tab > 0 ? 100 * a.desc / a.tab : 0,
      pa: a.n ? 100 * a.ab / a.n : 0, dev: modelo.devVen.get(vi) || 0,
      pz: (() => { const p = modelo.venPz.get(vi); return p && p[1] ? p[0] / p[1] : null })(),
    }))
  }, [modelo, base])

  const cliRows = useMemo<RCli[]>(() => {
    if (!modelo) return []
    const tv = modelo.tot.val || 1
    return modelo.clis.map((c) => ({
      ci: c.ci, nome: c.nome, cidade: c.cid, seg: c.seg, cur: c.cur, val: c.val, part: 100 * c.val / tv,
      rpkg: c.kgP ? c.valP / c.kgP : null, descPct: c.tab > 0 ? 100 * c.desc / c.tab : 0, r: c.r, f: c.f, notas: c.notas, dev: c.dev,
    }))
  }, [modelo])

  const prodRows = useMemo<RProd[]>(() => {
    if (!modelo || !base || !pg) return []
    const tv = modelo.tot.val || 1
    return [...modelo.prodM].map(([pi, a]) => ({
      pi, nome: base.prod[pi]?.[0] ?? String(pi), linha: base.prod[pi]?.[1] ?? '—', grupo: pg[pi],
      val: a.val, part: 100 * a.val / tv, kg: a.kg, rpkg: a.kgP ? a.valP / a.kgP : (a.kg ? a.val / a.kg : null),
      desc: a.tab > 0 ? 100 * a.desc / a.tab : 0, pa: a.n ? 100 * a.ab / a.n : 0, cli: a.clis.size, incluido: modelo.inc(pi),
    }))
  }, [modelo, base, pg])

  const cidRows = useMemo<RCid[]>(() => {
    if (!modelo || !base) return []
    const tv = modelo.tot.val || 1
    return [...modelo.cidM].map(([ci, a]) => ({
      ci, nome: base.cid[ci] ?? '—', val: a.val, part: 100 * a.val / tv, kg: a.kg,
      rpkg: a.kgP ? a.valP / a.kgP : null, cli: a.clis.size, ven: modelo.cidVen.get(ci)?.size ?? 0,
    }))
  }, [modelo, base])

  const trRows = useMemo<RTr[]>(() => {
    if (!modelo || !base) return []
    return [...modelo.trM].map(([ti, a]) => ({ ti, nome: base.tr[ti] ?? '—', val: a.val, kg: a.kg, notas: a.notas.size, cli: a.clis.size }))
  }, [modelo, base])

  // Agregados de apoio -------------------------------------------------------
  const segDist = useMemo(() => {
    const d = SEG.map(() => ({ n: 0, val: 0 }))
    cliRows.forEach((c) => { const s = d[c.seg]; if (s) { s.n++; s.val += c.val } })
    return d
  }, [cliRows])
  const curva = useMemo(() => {
    const d = CUR.map(() => ({ n: 0, val: 0, kgP: 0, valP: 0, notas: 0 }))
    if (modelo) modelo.clis.forEach((c) => { const g = d[c.cur]; if (g) { g.n++; g.val += c.val; g.kgP += c.kgP; g.valP += c.valP; g.notas += c.notas } })
    return d
  }, [modelo])
  const serie = useMemo(() => {
    if (!modelo || !base) return [] as { rot: string; iso: string; val: number; kg: number; notas: number }[]
    const grupos = new Map<number, { val: number; kg: number; notas: Set<number> }>()
    modelo.diaM.forEach((a, d) => {
      const g = diaModo === 'semana' ? Math.floor(d / 7) : d
      let acc = grupos.get(g); if (!acc) { acc = { val: 0, kg: 0, notas: new Set() }; grupos.set(g, acc) }
      acc.val += a.val; acc.kg += a.kg; a.notas.forEach((n) => acc!.notas.add(n))
    })
    return [...grupos].sort((a, b) => a[0] - b[0]).map(([g, v]) => {
      const d0 = diaModo === 'semana' ? g * 7 : g
      const diaIso = diaISO(base.de, d0)
      return { rot: diaModo === 'semana' ? `sem. ${dataBR(diaIso).slice(0, 5)}` : dataBR(diaIso).slice(0, 5), iso: diaIso, val: v.val, kg: v.kg, notas: v.notas.size }
    })
  }, [modelo, base, diaModo])
  const grupoMix = useMemo(() => {
    if (!modelo) return [] as { rot: string; v: number }[]
    const tv = modelo.tot.val || 1
    return LINHAS.map((l) => ({ rot: l.rot, v: 100 * (modelo.grpM.get(l.k)?.val ?? 0) / tv })).filter((x) => x.v > 0)
  }, [modelo])
  const logi = useMemo(() => {
    if (!modelo) return null
    let kgCarga = 0; modelo.cargaM.forEach((a) => { kgCarga += a.kg })
    const semCargaNotas = new Set<number>(); let kgSem = 0
    modelo.its.forEach((x) => { if (x[8] < 0) { semCargaNotas.add(x[1]); kgSem += x[5] } })
    const cliCarga = new Set<number>(); modelo.cargaM.forEach((a) => a.clis.forEach((c) => cliCarga.add(c)))
    return {
      cargas: modelo.cargaM.size, kgMed: modelo.cargaM.size ? kgCarga / modelo.cargaM.size : 0,
      cliMed: modelo.cargaM.size ? cliCarga.size / modelo.cargaM.size : 0,
      notasSem: semCargaNotas.size, kgSem,
    }
  }, [modelo])

  // Nomes / helpers de exibição
  const restrito = base?.modo === 'vendedor'
  const nomeComCod = (nome: string, cod: string) => verCod ? `${cod} · ${cap(nome)}` : cap(nome)
  const tot = modelo?.tot
  const topVen = useMemo(() => [...venRows].sort((a, b) => b.val - a.val)[0], [venRows])
  const maiorDesc = useMemo(() => venRows.filter((e) => e.val > 5000).sort((a, b) => b.desc - a.desc)[0], [venRows])
  const topProd = useMemo(() => [...prodRows].sort((a, b) => b.val - a.val)[0], [prodRows])
  const maxSerie = Math.max(1, ...serie.map((s) => s.val))
  const clientesDaCidade = useMemo(() => cidadeSel == null ? [] : cliRows.filter((c) => base && base.cli[c.ci] && base.cli[c.ci][1] === cidadeSel), [cidadeSel, cliRows, base])
  const grade = (min: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 12, alignItems: 'start' })

  const kpi = (rot: string, chave: string, valor: string, cur: number | null, antv: number | null | undefined, sub: ReactNode, inverso?: boolean, cor?: string) => (
    <div style={{ ...card, gap: 2 }}>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(22px, 2.4vw, 30px)', lineHeight: 1.15, color: cor ?? C.esp, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><Variacao cur={cur} ant={antv} inverso={inverso} /><AjudaCampo chave="com.painel.variacao" rota={ROTA} /></span>
        <span>{sub}</span>
      </div>
    </div>
  )

  return (
    <div style={{ background: C.off, minHeight: '100%', color: C.esp, padding: 'clamp(12px, 2.5vw, 28px)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gap: 16 }}>
        <header style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, color: C.m }}>Comercial · Meu painel de vendas · v5 · ao vivo · lido da venda detalhada (nota a nota) · atualiza a cada import</div>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px, 3.4vw, 34px)', fontFamily: 'Georgia, serif', fontWeight: 400 }}>Meu painel de vendas</h1>
          {base && r && tot && (
            <p style={{ margin: 0, fontSize: 15, color: C.m, maxWidth: '80ch' }}>
              De <b style={{ color: C.esp }}>{dataBR(base.de)}</b> a <b style={{ color: C.esp }}>{dataBR(base.ate)}</b>: faturou <b style={{ color: C.esp }}>{brl(r.totalValor)}</b> em <b style={{ color: C.esp }}>{ton(tot.kg)}</b>.{' '}
              <b style={{ color: C.esp }}>{pct(tot.n ? 100 * tot.ab / tot.n : 0)}</b> dos itens saíram abaixo do preço de tabela, somando <b style={{ color: C.esp }}>{brl(tot.desc)}</b> de desconto.
            </p>
          )}
          {restrito && <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}><Lock size={13} strokeWidth={1.5} /> Você vê somente as suas vendas.</div>}
        </header>

        {/* Barra de período / filtros — vale em TODAS as abas */}
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
          {base && estado && !restrito && base.ven.length > 1 && (
            <label style={{ display: 'grid', gap: 2, fontSize: 12, color: C.m }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Vendedor<AjudaCampo chave="com.painel.visao" rota={ROTA} /></span>
              <select value={String(estado.ven)} onChange={(e) => setVen(e.target.value === 'todos' ? 'todos' : Number(e.target.value))} aria-label="Vendedor"
                style={{ font: 'inherit', fontSize: 14, padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp, minWidth: 180, maxWidth: '80vw' }}>
                <option value="todos">Todos os vendedores</option>
                {base.ven.map((v, i) => <option key={i} value={i}>{cap(v[1])}</option>)}
              </select>
            </label>
          )}
          {base && estado && (
            <label style={{ display: 'grid', gap: 2, fontSize: 12, color: C.m }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Linha<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></span>
              <select value={String(estado.lin)} onChange={(e) => setLin(e.target.value === 'todas' ? 'todas' : Number(e.target.value))} aria-label="Linha de produto"
                style={{ font: 'inherit', fontSize: 14, padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp }}>
                <option value="todas">Todas as linhas</option>
                {LINHAS.map((l) => <option key={l.k} value={l.k}>{l.rot}</option>)}
              </select>
            </label>
          )}
          <button type="button" onClick={() => setEngrenagem(true)} disabled={!base} aria-label="O que entra na análise"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: 'inherit', fontSize: 13, padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp, cursor: base ? 'pointer' : 'default' }}>
            <SlidersHorizontal size={15} /> Análise<AjudaCampo chave="com.painel.analise" rota={ROTA} />
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.esp, cursor: 'pointer' }}>
            <input type="checkbox" checked={verCod} onChange={(e) => setVerCod(e.target.checked)} aria-label="Ver código" />
            Ver código<AjudaCampo chave="com.painel.vercodigo" rota={ROTA} />
          </label>
          {carregando && <span style={{ fontSize: 12, color: C.m }}>atualizando…</span>}
        </div>

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
        {erro && <div role="alert" style={{ ...card, borderColor: C.bad, color: C.bad }}>Não foi possível carregar o painel: {erro}</div>}
        {empresa && !erro && base && modelo && modelo.its.length === 0 && (
          <div style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>Sem venda no período para este recorte. Experimente outro período ou tire filtros da análise.</div>
        )}
        {carregando && !base && <div style={card}>Carregando…</div>}

        {/* Busca (abas de lista) */}
        {base && modelo && modelo.its.length > 0 && ['vendedores', 'clientes', 'cidades', 'produtos'].includes(aba) && (
          <label style={{ display: 'grid', gap: 2, fontSize: 12, color: C.m, maxWidth: 420 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Buscar<AjudaCampo chave="com.painel.busca" rota={ROTA} /></span>
            <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome ou código…" aria-label="Buscar na lista"
              style={{ font: 'inherit', fontSize: 14, padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.bd}`, color: C.esp }} />
          </label>
        )}

        {base && r && tot && modelo && modelo.its.length > 0 && (
          <>
            {/* ===================== VISÃO GERAL ===================== */}
            {aba === 'geral' && (
              <>
                <section style={grade(170)} aria-label="Indicadores">
                  {kpi('Faturamento', 'com.painel.faturado', brlc(r.totalValor), tot.v2, tot.v1, <>ticket {brl(tot.notas.size ? tot.val / tot.notas.size : null)}</>)}
                  {kpi('Volume na análise', 'com.painel.volume', ton(tot.kgP), tot.kP2, tot.kP1, <>{int(tot.notas.size)} notas</>)}
                  {kpi('Preço médio', 'com.painel.preco', brl2(r.precoPorKg), null, null, 'R$/kg na análise')}
                  {kpi('Ticket médio', 'com.painel.ticket', brl(tot.notas.size ? tot.val / tot.notas.size : null), null, null, <>{int(tot.notas.size)} notas</>)}
                  {kpi('Desconto na tabela', 'com.painel.desconto', brlc(tot.desc), tot.v2, tot.v1, pct(tot.tab ? 100 * tot.desc / tot.tab : 0, 2) + ' sobre a tabela', true)}
                  {kpi('Devoluções', 'com.painel.devolucao', brlc(modelo.devTot), null, null, pct(r.totalValor ? 100 * modelo.devTot / r.totalValor : 0, 2) + ' do faturado', true, modelo.devTot > 0 ? C.bad : undefined)}
                  {kpi('Clientes que compraram', 'com.painel.clientes', int(r.clientes), null, null, <>{int(r.produtos)} cortes</>)}
                  {kpi('Prazo médio', 'com.painel.prazo', modelo.pz ? `${nf({ maximumFractionDigits: 0 }).format(modelo.pz)} dias` : '—', null, null, 'ponderado pelo valor')}
                </section>

                <Leitura>
                  <b>Leitura rápida:</b>{' '}
                  {topVen ? <>Maior vendedor: <b>{cap(topVen.nome)}</b> ({brl(topVen.val)}). </> : null}
                  {maiorDesc ? <>Quem mais deu desconto: <b>{cap(maiorDesc.nome)}</b> ({pct(maiorDesc.desc, 2)}) — vale conversa. </> : null}
                  {topProd ? <>Corte que mais fatura: <b>{cap(topProd.nome)}</b>.</> : null}
                </Leitura>

                <section style={card} aria-label="Faturamento no período">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Titulo t="Faturamento no período" nota="Valor líquido das notas. Toque numa barra para ver volume e notas." ajuda="com.painel.meses" />
                    <div role="group" aria-label="Agrupar" style={{ display: 'flex', gap: 6 }}>
                      {(['dia', 'semana'] as const).map((k) => (
                        <button key={k} type="button" onClick={() => setDiaModo(k)} aria-pressed={diaModo === k}
                          style={{ font: 'inherit', fontSize: 12, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${diaModo === k ? C.esp : C.bd}`, background: diaModo === k ? C.esp : '#fff', color: diaModo === k ? '#fff' : C.esp }}>{k === 'dia' ? 'Por dia' : 'Por semana'}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 190, paddingTop: 18, overflowX: 'auto' }}>
                    {serie.length === 0 && <span style={{ fontSize: 13, color: C.m }}>Sem venda no período.</span>}
                    {serie.map((s) => (
                      <button key={s.iso} type="button" onClick={() => setDica(`${dataBR(s.iso)} · ${brl(s.val)} · ${int(s.kg)} kg · ${s.notas} notas`)}
                        title={`${dataBR(s.iso)} · ${brl(s.val)} · ${int(s.kg)} kg · ${s.notas} notas`}
                        style={{ flex: '1 0 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 10, color: C.m, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}>
                        <span style={{ fontSize: 10, color: C.esp }}>{brlc(s.val).replace('R$ ', '')}</span>
                        <i style={{ display: 'block', width: '100%', height: Math.max(3, 140 * s.val / maxSerie), background: `linear-gradient(180deg, ${C.gold2}, ${C.gold})`, borderRadius: '5px 5px 0 0' }} />
                        <span>{s.rot}</span>
                      </button>
                    ))}
                  </div>
                  {dica && <div role="status" style={{ fontSize: 12, color: C.esp, background: C.bg2, borderRadius: 8, padding: '6px 10px' }}>{dica}</div>}
                </section>

                <section style={grade(380)} aria-label="Top vendedores e cidades">
                  <div style={card}>
                    <Titulo t="Top vendedores" nota="Por faturamento no período. Ordene na aba Vendedores." ajuda="com.painel.equipe" />
                    <BarrasH cor={C.gold} fmt={(v) => brlc(v)} dados={[...venRows].sort((a, b) => b.val - a.val).map((e) => ({ rot: cap(e.nome), v: e.val }))} />
                  </div>
                  <div style={card}>
                    <Titulo t="Top cidades" nota="Por volume (kg) no período." ajuda="com.painel.cidades" />
                    <BarrasH cor={C.verde} fmt={(v) => int(v) + ' kg'} dados={[...cidRows].sort((a, b) => b.kg - a.kg).map((c) => ({ rot: cap(c.nome), v: c.kg }))} />
                  </div>
                </section>

                <section style={grade(380)} aria-label="Mix e segmentos">
                  <div style={card}>
                    <Titulo t="Mix por linha de produto" nota="Participação de cada linha no faturamento." ajuda="com.painel.produtos" />
                    <BarrasH cor={C.azul} fmt={(v) => pct(v)} dados={grupoMix} />
                  </div>
                  <div style={card}>
                    <Titulo t="Segmentos de clientes" nota="Pela recência e frequência de compra no período." ajuda="com.painel.segmento" />
                    <div style={{ display: 'grid', gap: 6 }}>
                      {SEG.map((s, i) => segDist[i].n > 0 && (
                        <div key={s.rot} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px,38%) 1fr auto', gap: 8, alignItems: 'center', fontSize: 12 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 9, height: 9, borderRadius: 3, background: s.cor }} />{s.rot}</span>
                          <span style={{ position: 'relative', height: 14, background: C.bg2, borderRadius: 4 }}><b style={{ position: 'absolute', inset: '0 auto 0 0', width: `${Math.max(2, 100 * segDist[i].n / Math.max(1, ...segDist.map((x) => x.n)))}%`, background: s.cor, borderRadius: 4 }} /></span>
                          <span style={{ color: C.m }}>{int(segDist[i].n)} · {brlc(segDist[i].val)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section style={{ ...card, borderLeft: `5px solid ${C.gold}` }} aria-label="Leituras para a decisão">
                  <Titulo t="Leituras para a decisão" ajuda="com.painel.leituras" />
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
                    <li><b>Preço:</b> {pct(tot.n ? 100 * tot.ab / tot.n : 0)} dos itens foram vendidos abaixo da tabela. O desconto no período soma {brl(tot.desc)} ({pct(tot.tab ? 100 * tot.desc / tot.tab : 0, 2)} sobre a tabela).</li>
                    {maiorDesc && <li><b>Quem mais concede desconto:</b> {cap(maiorDesc.nome)}, com {pct(maiorDesc.desc, 2)} e {pct(maiorDesc.pa)} dos itens abaixo da tabela.</li>}
                    {curva[0].n > 0 && <li><b>Concentração (curva A):</b> {int(curva[0].n)} clientes concentram {pct(tot.val ? 100 * curva[0].val / tot.val : 0)} do faturamento.</li>}
                    {modelo.devTot > 0 && <li><b>Devoluções:</b> {brl(modelo.devTot)} no período ({pct(r.totalValor ? 100 * modelo.devTot / r.totalValor : 0, 2)} do faturado).</li>}
                    {topProd && <li><b>Corte que mais fatura:</b> {cap(topProd.nome)} ({brl(topProd.val)}, {brl2(topProd.rpkg)}/kg).</li>}
                  </ul>
                </section>
              </>
            )}

            {/* ===================== VENDEDORES ===================== */}
            {aba === 'vendedores' && (
              <>
                <Leitura><b>Leitura:</b> {venRows.length} vendedores no período. {topVen ? <>Maior: <b>{cap(topVen.nome)}</b> ({brl(topVen.val)}). </> : null}{maiorDesc ? <>Mais desconto: <b>{cap(maiorDesc.nome)}</b> ({pct(maiorDesc.desc, 2)}).</> : null}</Leitura>
                <section style={card} aria-label="Vendedores">
                  <Titulo t="Vendedores" nota="Índice de preço = o quanto o preço praticado difere da média da empresa no mesmo produto (100 = na média). Semáforo do desconto: verde ok, amarelo atenção, vermelho acima do normal." ajuda="com.painel.equipe" />
                  <Tabela<RVen>
                    linhas={venRows} buscaTexto={busca} buscaEm={(e) => `${e.nome} ${e.cod}`} inicialK="val" chaveRow={(e) => String(e.vi)}
                    onRow={(e) => () => setVen(e.vi)} aberta={() => true}
                    cols={[
                      { k: 'nome', rot: 'Vendedor', esq: true, ordenar: (e) => e.nome, render: (e) => nomeComCod(e.nome, e.cod) },
                      { k: 'val', rot: 'Faturamento', ordenar: (e) => e.val, max: (rs) => Math.max(1, ...rs.map((x) => x.val)), render: (e, mx) => <BarraCelula v={e.val} max={mx} txt={brl(e.val)} cor={C.gold} /> },
                      { k: 'part', rot: 'Participação', ajuda: 'com.painel.participacao', ordenar: (e) => e.part, render: (e) => pct(e.part) },
                      { k: 'cli', rot: 'Clientes', ordenar: (e) => e.cli, render: (e) => int(e.cli) },
                      { k: 'tk', rot: 'Ticket', ajuda: 'com.painel.ticket', ordenar: (e) => e.ticket ?? 0, render: (e) => brl(e.ticket) },
                      { k: 'rpkg', rot: 'R$/kg', ajuda: 'com.painel.rpkg', ordenar: (e) => e.rpkg ?? 0, render: (e) => brl2(e.rpkg) },
                      { k: 'idx', rot: 'Índice de preço', ajuda: 'com.painel.indice', ordenar: (e) => e.idx ?? 0, render: (e) => e.idx == null ? '—' : <span style={{ color: e.idx >= 100 ? C.ok : C.bad }}>{nf({ maximumFractionDigits: 0 }).format(e.idx)}</span> },
                      { k: 'desc', rot: 'Desconto', ajuda: 'com.painel.desconto', ordenar: (e) => e.desc, render: (e) => <Chip v={e.desc} a={1} b={2} d={2} /> },
                      { k: 'dev', rot: 'Devolução', ajuda: 'com.painel.devolucao', ordenar: (e) => e.dev, render: (e) => e.dev > 0 ? <span style={{ color: C.bad }}>{brl(e.dev)}</span> : '—' },
                      { k: 'pz', rot: 'Prazo', ajuda: 'com.painel.prazo', ordenar: (e) => e.pz ?? 0, render: (e) => e.pz == null ? '—' : `${nf({ maximumFractionDigits: 0 }).format(e.pz)}d` },
                    ]}
                  />
                </section>
                <section style={grade(380)}>
                  <div style={card}>
                    <Titulo t="Desconto sobre a tabela, por vendedor" nota="Em vermelho, acima de 2%." ajuda="com.painel.desconto" />
                    <BarrasH cor={C.gold} fmt={(v) => pct(v, 2)} dados={venRows.filter((e) => e.val > 5000).sort((a, b) => b.desc - a.desc).map((e) => ({ rot: cap(e.nome), v: Math.max(0, e.desc), destaque: e.desc >= 2 }))} />
                  </div>
                  <div style={card}>
                    <Titulo t="Preço médio, por vendedor" nota="R$ por kg na análise. O traço é a média desta visão." ajuda="com.painel.rpkg" />
                    <BarrasH cor={C.verde} fmt={(v) => brl2(v)} refv={r.precoPorKg} dados={venRows.filter((e) => e.rpkg != null).sort((a, b) => (b.rpkg ?? 0) - (a.rpkg ?? 0)).map((e) => ({ rot: cap(e.nome), v: e.rpkg ?? 0 }))} />
                  </div>
                </section>
              </>
            )}

            {/* ===================== CLIENTES ===================== */}
            {aba === 'clientes' && (
              <>
                <Leitura><b>Leitura:</b> {int(r.clientes)} clientes no período. {curva[0].n > 0 ? <>A curva A ({int(curva[0].n)} clientes) concentra <b>{pct(tot.val ? 100 * curva[0].val / tot.val : 0)}</b> do faturamento. </> : null}Clientes <span style={{ color: SEG[4].cor }}>em risco</span> e <span style={{ color: SEG[5].cor }}>sumindo</span> precisam de atenção.</Leitura>
                <section style={grade(380)} aria-label="Curva ABC">
                  <div style={card}>
                    <Titulo t="Curva ABC de clientes" nota="A = até 80% do faturamento, B = até 95%, C = o resto." ajuda="com.painel.curva" />
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr><th style={{ ...th, textAlign: 'left' }}>Curva</th><th style={th}>Clientes</th><th style={th}>Faturamento</th><th style={th}>R$/kg</th></tr></thead>
                        <tbody>
                          {CUR.map((rot, i) => curva[i].n > 0 && (
                            <tr key={rot}><td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{rot}</td><td style={td}>{int(curva[i].n)}</td><td style={td}>{brl(curva[i].val)}</td><td style={td}>{brl2(curva[i].kgP ? curva[i].valP / curva[i].kgP : null)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div style={card}>
                    <Titulo t="Segmentos de clientes" nota="Campeões e Fiéis sustentam; Em risco e Sumindo pedem ação." ajuda="com.painel.segmento" />
                    <div style={{ display: 'grid', gap: 6 }}>
                      {SEG.map((s, i) => segDist[i].n > 0 && (
                        <div key={s.rot} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 9, height: 9, borderRadius: 3, background: s.cor }} />{s.rot}</span>
                          <span style={{ color: C.m }}>{int(segDist[i].n)} clientes · {brl(segDist[i].val)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
                <section style={card} aria-label="Clientes">
                  <Titulo t="Clientes" nota="Cada loja pelo seu código no ERP de origem. Recência = dias desde a última compra; frequência = dias com compra." />
                  <Tabela<RCli>
                    linhas={cliRows} buscaTexto={busca} buscaEm={(c) => `${c.nome} ${c.cidade}`} inicialK="val" chaveRow={(c) => String(c.ci)}
                    cols={[
                      { k: 'nome', rot: 'Cliente', esq: true, ordenar: (c) => c.nome, render: (c) => <><span>{cap(c.nome)}</span><div style={{ fontSize: 11, color: C.m }}>{cap(c.cidade)}</div></> },
                      { k: 'seg', rot: 'Segmento', ajuda: 'com.painel.segmento', esq: true, ordenar: (c) => c.seg, render: (c) => <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, color: '#fff', background: SEG[c.seg]?.cor ?? C.m }}>{SEG[c.seg]?.rot ?? '—'}</span> },
                      { k: 'cur', rot: 'Curva', ajuda: 'com.painel.curva', ordenar: (c) => c.cur, render: (c) => CUR[c.cur] ?? '—' },
                      { k: 'val', rot: 'Faturamento', ordenar: (c) => c.val, max: (rs) => Math.max(1, ...rs.map((x) => x.val)), render: (c, mx) => <BarraCelula v={c.val} max={mx} txt={brl(c.val)} cor={C.verde} /> },
                      { k: 'part', rot: 'Participação', ajuda: 'com.painel.participacao', ordenar: (c) => c.part, render: (c) => pct(c.part, 2) },
                      { k: 'rpkg', rot: 'R$/kg', ajuda: 'com.painel.rpkg', ordenar: (c) => c.rpkg ?? 0, render: (c) => brl2(c.rpkg) },
                      { k: 'desc', rot: 'Desconto', ajuda: 'com.painel.desconto', ordenar: (c) => c.descPct, render: (c) => <Chip v={c.descPct} a={1} b={2} d={2} /> },
                      { k: 'rec', rot: 'Recência', ajuda: 'com.painel.recencia', ordenar: (c) => c.r, render: (c) => <span style={{ color: c.r > 30 ? C.bad : C.esp }}>{int(c.r)}d</span> },
                      { k: 'f', rot: 'Frequência', ajuda: 'com.painel.frequencia', ordenar: (c) => c.f, render: (c) => `${int(c.f)} dias` },
                      { k: 'dev', rot: 'Devolução', ajuda: 'com.painel.devolucao', ordenar: (c) => c.dev, render: (c) => c.dev > 0 ? <span style={{ color: C.bad }}>{brl(c.dev)}</span> : '—' },
                    ]}
                  />
                </section>
              </>
            )}

            {/* ===================== CIDADES ===================== */}
            {aba === 'cidades' && (
              <>
                <Leitura><b>Leitura:</b> {cidRows.length} cidades (praças) no período{cidRows[0] ? <>; a maior é <b>{cap([...cidRows].sort((a, b) => b.val - a.val)[0].nome)}</b>.</> : '.'} Toque numa cidade para ver os clientes dela.</Leitura>
                {cidadeSel != null && (
                  <section style={{ ...card, borderLeft: `5px solid ${C.gold}` }} aria-label="Clientes da cidade">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <Titulo t={`Clientes em ${cap(base.cid[cidadeSel] ?? '')}`} nota={`${clientesDaCidade.length} clientes nesta praça`} />
                      <button type="button" onClick={() => setCidadeSel(null)} aria-label="Fechar" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: 'inherit', fontSize: 12, padding: '6px 10px', borderRadius: 999, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp, cursor: 'pointer' }}><X size={13} /> Fechar</button>
                    </div>
                    <div style={{ overflow: 'auto', maxHeight: 360 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr><th style={{ ...th, textAlign: 'left' }}>Cliente</th><th style={th}>Faturamento</th><th style={th}>R$/kg</th></tr></thead>
                        <tbody>
                          {[...clientesDaCidade].sort((a, b) => b.val - a.val).map((c) => (
                            <tr key={c.ci}><td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>{cap(c.nome)}</td><td style={td}>{brl(c.val)}</td><td style={td}>{brl2(c.rpkg)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                <section style={card} aria-label="Cidades">
                  <Titulo t="Cidades (praças)" nota="Nomes normalizados (sem duplicar por maiúscula/acento). Toque para abrir os clientes." ajuda="com.painel.cidades" />
                  <Tabela<RCid>
                    linhas={cidRows} buscaTexto={busca} buscaEm={(c) => c.nome} inicialK="val" chaveRow={(c) => String(c.ci)}
                    onRow={(c) => () => setCidadeSel(c.ci)} aberta={() => true}
                    cols={[
                      { k: 'nome', rot: 'Cidade', esq: true, ordenar: (c) => c.nome, render: (c) => cap(c.nome) },
                      { k: 'val', rot: 'Faturamento', ordenar: (c) => c.val, max: (rs) => Math.max(1, ...rs.map((x) => x.val)), render: (c, mx) => <BarraCelula v={c.val} max={mx} txt={brl(c.val)} cor={C.verde} /> },
                      { k: 'part', rot: 'Participação', ajuda: 'com.painel.participacao', ordenar: (c) => c.part, render: (c) => pct(c.part) },
                      { k: 'kg', rot: 'Volume (kg)', ordenar: (c) => c.kg, render: (c) => int(c.kg) },
                      { k: 'rpkg', rot: 'R$/kg', ajuda: 'com.painel.rpkg', ordenar: (c) => c.rpkg ?? 0, render: (c) => brl2(c.rpkg) },
                      { k: 'cli', rot: 'Clientes', ordenar: (c) => c.cli, render: (c) => int(c.cli) },
                    ]}
                  />
                </section>
              </>
            )}

            {/* ===================== PRODUTOS ===================== */}
            {aba === 'produtos' && (
              <>
                <Leitura><b>Leitura:</b> {prodRows.length} cortes no período{topProd ? <>; o que mais fatura é <b>{cap(topProd.nome)}</b> ({brl2(topProd.rpkg)}/kg).</> : '.'} <b>Sem margem</b>: o custo do ERP de origem vem zerado — não inventamos número. Use a <b>engrenagem Análise</b> para tirar despojo/inativos.</Leitura>
                <section style={card} aria-label="Produtos">
                  <Titulo t="Produtos (cortes)" nota="Volume, preço e desconto por corte. Fora da análise = marcado na engrenagem (não entra no preço médio)." ajuda="com.painel.produtos" />
                  <Tabela<RProd>
                    linhas={prodRows} buscaTexto={busca} buscaEm={(x) => `${x.nome} ${x.linha}`} inicialK="val" chaveRow={(x) => String(x.pi)}
                    cols={[
                      { k: 'nome', rot: 'Produto', esq: true, ordenar: (x) => x.nome, render: (x) => <span>{cap(x.nome)}{!x.incluido && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 999, background: C.bg2, color: C.m }}>fora da análise</span>}</span> },
                      { k: 'linha', rot: 'Linha', ordenar: (x) => x.linha, esq: true, render: (x) => LINHAS[x.grupo]?.rot ?? cap(x.linha) },
                      { k: 'val', rot: 'Faturamento', ordenar: (x) => x.val, max: (rs) => Math.max(1, ...rs.map((y) => y.val)), render: (x, mx) => <BarraCelula v={x.val} max={mx} txt={brl(x.val)} cor={C.azul} /> },
                      { k: 'part', rot: 'Participação', ajuda: 'com.painel.participacao', ordenar: (x) => x.part, render: (x) => pct(x.part) },
                      { k: 'kg', rot: 'Volume (kg)', ordenar: (x) => x.kg, render: (x) => int(x.kg) },
                      { k: 'rpkg', rot: 'R$/kg', ajuda: 'com.painel.rpkg', ordenar: (x) => x.rpkg ?? 0, render: (x) => brl2(x.rpkg) },
                      { k: 'desc', rot: 'Desconto', ajuda: 'com.painel.desconto', ordenar: (x) => x.desc, render: (x) => <Chip v={x.desc} a={1} b={2} d={2} /> },
                      { k: 'pa', rot: 'Itens abaixo', ordenar: (x) => x.pa, render: (x) => <Chip v={x.pa} a={40} b={70} /> },
                      { k: 'cli', rot: 'Clientes', ordenar: (x) => x.cli, render: (x) => int(x.cli) },
                    ]}
                  />
                </section>
              </>
            )}

            {/* ===================== PREÇO E DESCONTO (flex) ===================== */}
            {aba === 'flex' && (
              <>
                <Leitura><b>Leitura:</b> no período, {brl(tot.desc)} de desconto concedido ({pct(tot.tab ? 100 * tot.desc / tot.tab : 0, 2)} sobre a tabela), em {pct(tot.n ? 100 * tot.ab / tot.n : 0)} dos itens. Abaixo, onde o preço mais cai — por vendedor, produto e cliente.</Leitura>
                <section style={grade(380)} aria-label="Preço e desconto">
                  <div style={card}>
                    <Titulo t="Desconto por vendedor" nota="Desconto médio sobre a tabela. Vermelho acima de 2%." ajuda="com.painel.desconto" />
                    <BarrasH cor={C.gold} fmt={(v) => pct(v, 2)} dados={venRows.filter((e) => e.val > 5000 && e.desc > 0).sort((a, b) => b.desc - a.desc).map((e) => ({ rot: cap(e.nome), v: e.desc, destaque: e.desc >= 2 }))} />
                  </div>
                  <div style={card}>
                    <Titulo t="Desconto por produto" nota="Cortes com mais desconto sobre a tabela." ajuda="com.painel.desconto" />
                    <BarrasH cor={C.azul} fmt={(v) => pct(v, 2)} dados={prodRows.filter((x) => x.desc > 0).sort((a, b) => b.desc - a.desc).slice(0, 20).map((x) => ({ rot: cap(x.nome), v: x.desc, destaque: x.desc >= 2 }))} />
                  </div>
                  <div style={card}>
                    <Titulo t="Desconto por cliente" nota="Onde está o dinheiro que ficou na mesa." ajuda="com.painel.desconto" />
                    <BarrasH cor={C.verde} fmt={(v) => pct(v, 2)} dados={cliRows.filter((c) => c.descPct > 0).sort((a, b) => b.descPct - a.descPct).slice(0, 20).map((c) => ({ rot: cap(c.nome), v: c.descPct, destaque: c.descPct >= 2 }))} />
                  </div>
                </section>
              </>
            )}

            {/* ===================== LOGÍSTICA ===================== */}
            {aba === 'logistica' && (
              <>
                {logi && logi.cargas > 0 ? (
                  <section style={{ display: 'grid', gap: 12 }} aria-label="Logística de saída">
                    <Leitura><b>Leitura:</b> {int(logi.cargas)} cargas montadas no período, {int(logi.kgMed)} kg por carga em média.</Leitura>
                    <div style={grade(170)}>
                      {kpi('Cargas montadas', 'com.painel.logistica', int(logi.cargas), null, null, 'no período')}
                      {kpi('Peso médio por carga', 'com.painel.logistica', `${int(logi.kgMed)} kg`, null, null, 'peso líquido vendido')}
                      {kpi('Clientes por carga', 'com.painel.logistica', nf({ maximumFractionDigits: 1 }).format(logi.cliMed), null, null, 'entregas em média')}
                      {kpi('Notas sem carga', 'com.painel.logistica', int(logi.notasSem), null, null, <>{int(logi.kgSem)} kg retirados/sem romaneio</>)}
                    </div>
                    <div style={card}>
                      <Titulo t="Transportadores do período" nota="Peso e valor por transportador. Na visão de um vendedor, só a parte dele." ajuda="com.painel.logistica" />
                      <Tabela<RTr>
                        linhas={trRows} buscaTexto="" buscaEm={(t) => t.nome} inicialK="val" chaveRow={(t) => String(t.ti)}
                        cols={[
                          { k: 'nome', rot: 'Transportador', esq: true, ordenar: (t) => t.nome, render: (t) => cap(t.nome) },
                          { k: 'val', rot: 'Faturamento', ordenar: (t) => t.val, max: (rs) => Math.max(1, ...rs.map((x) => x.val)), render: (t, mx) => <BarraCelula v={t.val} max={mx} txt={brl(t.val)} cor={C.gold} /> },
                          { k: 'kg', rot: 'Peso (kg)', ordenar: (t) => t.kg, render: (t) => int(t.kg) },
                          { k: 'nt', rot: 'Notas', ordenar: (t) => t.notas, render: (t) => int(t.notas) },
                          { k: 'cli', rot: 'Clientes', ordenar: (t) => t.cli, render: (t) => int(t.cli) },
                        ]}
                      />
                    </div>
                  </section>
                ) : (
                  <Placeholder titulo="Logística de saída" ajuda="com.painel.logistica" texto="Sem cargas/romaneios no período para esta visão. Quando as notas trazem carga e transportador, esta aba mostra cargas montadas, peso por carga, clientes por entrega e o desempenho por transportador." />
                )}
              </>
            )}

            {/* ===================== METAS ===================== */}
            {aba === 'concentracao' && empresa && (
              <AbaConcentracao empresa={empresa} de={intervalo.de} ate={intervalo.ate}
                vendedorCod={estado && estado.ven !== 'todos' ? (base.ven[Number(estado.ven)]?.[0] ?? null) : null} />
            )}

            {aba === 'ranking' && empresa && (
              <AbaRanking empresa={empresa} de={intervalo.de} ate={intervalo.ate} />
            )}

            {aba === 'metas' && (
              <Placeholder titulo="Metas" ajuda="com.painel.meta" texto="O ERP de origem manda as cotas zeradas. A aba de metas (realizado × meta por vendedor, produto e cidade, com a sugestão de mês anterior + 5% e cadastro em erp_meta) entra no próximo bloco — sem inventar número enquanto não houver a meta cadastrada." />
            )}
          </>
        )}
      </div>

      {/* ===================== ENGRENAGEM: o que entra na análise ===================== */}
      {engrenagem && base && estado && pg && (
        <div role="dialog" aria-label="O que entra na análise" style={{ position: 'fixed', inset: 0, background: 'rgba(40,30,20,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }} onClick={() => setEngrenagem(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.off, width: 'min(560px, 100%)', maxHeight: '86vh', overflow: 'auto', borderRadius: '16px 16px 0 0', padding: 'clamp(16px,3vw,24px)', display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 17, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>O que entra na análise<AjudaCampo chave="com.painel.analise" rota={ROTA} /></div>
              <button type="button" onClick={() => setEngrenagem(false)} aria-label="Fechar" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: 'inherit', fontSize: 13, padding: '6px 10px', borderRadius: 999, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp, cursor: 'pointer' }}><X size={15} /> Fechar</button>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: C.m }}>O despojo (não-carne) fica fora do preço médio por padrão. Escolha o que entra e se a exclusão vale só para o preço ou para todo o painel.</p>
            <div role="group" aria-label="Escopo da exclusão" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {([['preco', 'Fora só do preço/R$ por kg'], ['tudo', 'Fora de todo o painel']] as const).map(([k, rot]) => (
                <button key={k} type="button" onClick={() => setEstado((e) => e ? { ...e, escopo: k } : e)} aria-pressed={estado.escopo === k}
                  style={{ font: 'inherit', fontSize: 13, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${estado.escopo === k ? C.esp : C.bd}`, background: estado.escopo === k ? C.esp : '#fff', color: estado.escopo === k ? '#fff' : C.esp }}>{rot}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setEstado((e) => e ? { ...e, excl: Object.fromEntries(base.prod.map((p, i) => [i, p[2] !== 1])) } : e)}
                style={{ font: 'inherit', fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${C.bd}`, background: '#fff', color: C.esp }}>Padrão: só carne</button>
              <button type="button" onClick={() => setEstado((e) => e ? { ...e, excl: {} } : e)}
                style={{ font: 'inherit', fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${C.bd}`, background: '#fff', color: C.esp }}>Todos os produtos</button>
            </div>
            <div style={{ display: 'grid', gap: 2 }}>
              {base.prod.map((p, i) => {
                const marcado = !estado.excl[i]
                return (
                  <label key={i} data-ajuda="com.painel.analise" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 4px', borderBottom: `1px solid ${C.bg2}`, cursor: 'pointer' }}>
                    <input type="checkbox" checked={marcado} onChange={(ev) => setEstado((e) => e ? { ...e, excl: { ...e.excl, [i]: !ev.target.checked } } : e)} aria-label={`Incluir ${p[0]}`} />
                    <span style={{ flex: 1 }}>{cap(p[0])}</span>
                    <span style={{ fontSize: 11, color: C.m }}>{LINHAS[pg[i]]?.rot ?? cap(p[1])}</span>
                  </label>
                )
              })}
            </div>
            <button type="button" onClick={() => setEngrenagem(false)} style={{ font: 'inherit', fontSize: 14, fontWeight: 600, padding: '10px 16px', borderRadius: 10, cursor: 'pointer', border: 0, background: C.esp, color: '#fff' }}>Pronto</button>
          </div>
        </div>
      )}
    </div>
  )
}

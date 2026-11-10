'use client'
// Comercial › Meu painel v6 (storytelling) — bloco 1: "Como a Frioeste está vendendo".
// Rota NOVA e separada do v5 (/dashboard/comercial/meu-painel), que continua intacto até o v6 ser validado.
// A tela só desenha: o cálculo vive em ../meu-painel/motor-v5 (mesmo motor já provado contra o aceite),
// alimentado pela RPC fn_bi_comercial_base, que trava o escopo no banco (líder vê a empresa; vendedor só o próprio).
// Fonte: fn_com_venda_item / bi_comercial_venda_item_mv (R$ 13.983.740 no aceite). Nunca a MV inflada.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import {
  calcularModelo, estadoPadrao, gruposProduto, resumo,
  type BaseV5, type EstadoV5, type GrupoProduto, type ModeloV5,
} from '../meu-painel/motor-v5'
import { calcularClientesV7 } from './clientes-v7'
import { AbaClientes } from './AbaClientes'
import { calcularCidadesV7 } from './cidades-v7'
import { AbaCidades } from './AbaCidades'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80' }
const ROTA = '/dashboard/comercial/meu-painel-v6'

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const ton = (kg: number | null | undefined) => kg == null ? '—' : nf({ maximumFractionDigits: 1 }).format(kg / 1000) + ' t'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diaISO = (base: string, n: number) => {
  const [y, m, d] = base.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000)
  return t.toISOString().slice(0, 10)
}
const dataBR = (isoDia: string) => { const [y, m, d] = isoDia.split('-'); return `${d}/${m}/${y}` }

type PerKey = 'hoje' | 'semana' | '30' | 'mes' | 'ano' | 'custom'
type AbaKey = 'geral' | 'vendedores' | 'clientes' | 'cidades' | 'produtos' | 'preco' | 'logistica' | 'metas'

// As 8 abas do protótipo, na mesma ordem. Só a Visão geral tem conteúdo neste chassi; as outras entram em blocos próprios.
const ABAS: { k: AbaKey; rot: string }[] = [
  { k: 'geral', rot: 'Visão geral' }, { k: 'vendedores', rot: 'Vendedores' }, { k: 'clientes', rot: 'Clientes' },
  { k: 'cidades', rot: 'Cidades' }, { k: 'produtos', rot: 'Produtos' }, { k: 'preco', rot: 'Preço e desconto' },
  { k: 'logistica', rot: 'Logística' }, { k: 'metas', rot: 'Metas' },
]
const PERIODOS: { k: PerKey; rot: string }[] = [
  { k: 'hoje', rot: 'Hoje' }, { k: 'semana', rot: 'Semana' }, { k: '30', rot: '30 dias' },
  { k: 'mes', rot: 'Este mês' }, { k: 'ano', rot: 'Ano' }, { k: 'custom', rot: 'De–até' },
]
// Linha = grupo de produto do motor (gruposProduto): 0 desossado, 1 com osso, 2 miúdo, 3 subprodutos e outros.
const LINHAS_OPC = ['Desossado (s/osso)', 'Com osso', 'Miúdo', 'Subprodutos e outros']

type VendRow = {
  nome: string; val: number; part: number; cli: number; notas: number; ticket: number | null; rpkg: number | null
  idx: number | null; desc: number; dev: number; devPct: number; prazo: number | null
}

export default function MeuPainelV6() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [base, setBase] = useState<BaseV5 | null>(null)
  const [estado, setEstado] = useState<EstadoV5 | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Chassi: período, abas e seletores. O período recarrega a base (fn_bi_comercial_base com p_de/p_ate);
  // vendedor e linha filtram o motor (estado.ven e estado.lin), então todas as abas recalculam juntas.
  const [per, setPer] = useState<PerKey>('30')
  const hojeISO = iso(new Date())
  const [deC, setDeC] = useState(hojeISO)
  const [ateC, setAteC] = useState(hojeISO)
  const [aba, setAba] = useState<AbaKey>('geral')

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
  // Base nova (outro período) → análise padrão, mas mantém vendedor e linha escolhidos.
  useEffect(() => {
    setEstado((prev) => base ? { ...estadoPadrao(base), ven: prev?.ven ?? 'todos', lin: prev?.lin ?? 'todas' } : null)
  }, [base])
  const setVen = (v: EstadoV5['ven']) => setEstado((e) => e ? { ...e, ven: v } : e)
  const setLin = (v: EstadoV5['lin']) => setEstado((e) => e ? { ...e, lin: v } : e)

  const pg = useMemo<GrupoProduto[] | null>(() => base ? gruposProduto(base) : null, [base])
  const modelo = useMemo<ModeloV5 | null>(() => base && estado && pg ? calcularModelo(base, estado, pg) : null, [base, estado, pg])
  const r = useMemo(() => modelo ? resumo(modelo) : null, [modelo])

  // Série diária (faturamento por dia) — mesma base do motor, ordenada por data.
  const serie = useMemo(() => {
    if (!modelo || !base) return [] as { dia: string; rot: string; val: number }[]
    return [...modelo.diaM]
      .map(([d, a]) => { const iso_ = diaISO(base.de, d); return { dia: iso_, rot: dataBR(iso_).slice(0, 5), val: a.val } })
      .sort((a, b) => a.dia.localeCompare(b.dia))
  }, [modelo, base])

  const notas = modelo?.tot.notas.size ?? 0
  const ticketNota = notas ? (modelo?.tot.val ?? 0) / notas : null

  // Bloco 2 — linhas de produto (mesma agregação do motor, por linha, com a análise padrão).
  const linhas = useMemo(() => {
    if (!modelo) return [] as { nome: string; val: number; part: number; rpkg: number | null }[]
    const tot = modelo.tot.val || 1
    return [...modelo.linM]
      .map(([nome, a]) => ({ nome, val: a.val, part: 100 * a.val / tot, rpkg: a.kgP ? a.valP / a.kgP : null }))
      .sort((a, b) => b.val - a.val)
  }, [modelo])

  // Ritmo da semana: faturamento somado por dia da semana (domingo a sábado).
  const ritmoSemana = useMemo(() => {
    const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    const acc = nomes.map((n) => ({ rot: n, val: 0 }))
    serie.forEach((s) => { acc[new Date(s.dia + 'T00:00:00Z').getUTCDay()].val += s.val })
    return acc
  }, [serie])

  // Para onde vai o mês: ritmo médio por dia com venda no período × 30 dias (estimativa, não previsão contábil).
  const mediaDia = serie.length && modelo ? modelo.tot.val / serie.length : null
  const projecaoMes = mediaDia != null ? mediaDia * 30 : null

  // ── Visão geral completa (SPEC §2.1). Números do motor; desconto usa a base "abaixo da tabela > R$ 0,05"
  // (centavo de arredondamento não conta como desconto).
  const [donutMetrica, setDonutMetrica] = useState<'val' | 'kg'>('val')
  const [escalaPreco, setEscalaPreco] = useState<'dia' | 'semana'>('dia')
  const [ordLin, setOrdLin] = useState<{ k: 'val' | 'part' | 'kg' | 'rpkg' | 'desc' | 'cli'; dir: 1 | -1 }>({ k: 'val', dir: -1 })

  const descR = modelo?.tot.desc ?? 0
  const tabR = modelo?.tot.tab ?? 0
  const descPct = tabR ? 100 * descR / tabR : 0
  const devR = useMemo(() => modelo ? modelo.devs.reduce((s, x) => s + (x[4] as number), 0) : 0, [modelo])
  const devPct = modelo?.tot.val ? 100 * devR / modelo.tot.val : 0
  const prazo = modelo?.pz ?? null
  const itensAbaixoPct = useMemo(() => {
    if (!modelo || !modelo.its.length) return 0
    const n = modelo.its.filter((x) => x[7] > x[6] + 0.05).length
    return 100 * n / modelo.its.length
  }, [modelo])

  // Linhas com desconto, clientes e R$/kg (base da análise), ordenáveis.
  const linhasTab = useMemo(() => {
    if (!modelo) return [] as { nome: string; val: number; part: number; kg: number; rpkg: number | null; desc: number; cli: number }[]
    const tot = modelo.tot.val || 1
    const rows = [...modelo.linM].map(([nome, a]) => ({
      nome, val: a.val, part: 100 * a.val / tot, kg: a.kg,
      rpkg: a.kgP ? a.valP / a.kgP : null, desc: a.tab ? 100 * a.desc / a.tab : 0, cli: a.clis.size,
    }))
    const k = ordLin.k
    return rows.sort((a, b) => {
      const va = k === 'rpkg' ? (a.rpkg ?? -1) : (a as any)[k]
      const vb = k === 'rpkg' ? (b.rpkg ?? -1) : (b as any)[k]
      return (va - vb) * ordLin.dir
    })
  }, [modelo, ordLin])

  // Série de preço por kg (R$ por kg na análise): toda a análise, desossados e com osso.
  const precoSerie = useMemo(() => {
    if (!modelo || !base || !pg || !estado) return [] as { rot: string; t: number | null; g0: number | null; g1: number | null }[]
    const porDia = new Map<number, { t: [number, number]; g0: [number, number]; g1: [number, number] }>()
    modelo.its.forEach((x) => {
      if (estado.excl[x[4]] || !(x[5] > 0)) return
      const d = x[0]
      let a = porDia.get(d); if (!a) { a = { t: [0, 0], g0: [0, 0], g1: [0, 0] }; porDia.set(d, a) }
      a.t[0] += x[6]; a.t[1] += x[5]
      const g = pg[x[4]]
      if (g === 0) { a.g0[0] += x[6]; a.g0[1] += x[5] } else if (g === 1) { a.g1[0] += x[6]; a.g1[1] += x[5] }
    })
    const div = (p: [number, number]) => p[1] > 0 ? p[0] / p[1] : null
    if (escalaPreco === 'dia') {
      return [...porDia].sort((a, b) => a[0] - b[0]).map(([d, a]) => ({
        rot: dataBR(diaISO(base.de, d)).slice(0, 5), t: div(a.t), g0: div(a.g0), g1: div(a.g1),
      }))
    }
    const porSem = new Map<number, { t: [number, number]; g0: [number, number]; g1: [number, number] }>()
    porDia.forEach((a, d) => {
      const s = Math.floor(d / 7)
      let b = porSem.get(s); if (!b) { b = { t: [0, 0], g0: [0, 0], g1: [0, 0] }; porSem.set(s, b) }
      b.t[0] += a.t[0]; b.t[1] += a.t[1]; b.g0[0] += a.g0[0]; b.g0[1] += a.g0[1]; b.g1[0] += a.g1[0]; b.g1[1] += a.g1[1]
    })
    return [...porSem].sort((a, b) => a[0] - b[0]).map(([s, b]) => ({
      rot: `sem. ${dataBR(diaISO(base.de, s * 7)).slice(0, 5)}`, t: div(b.t), g0: div(b.g0), g1: div(b.g1),
    }))
  }, [modelo, base, pg, estado, escalaPreco])

  // Diagnóstico do período (SPEC §2.1): regras determinísticas a partir do motor. Limites explícitos:
  // desconto acima de 1,5× a média da empresa; concentração = clientes da curva A (até 80% do faturamento).
  const diagnostico = useMemo(() => {
    const riscos: string[] = []; const oport: string[] = []; const acoes: string[] = []
    if (!modelo || !base) return { riscos, oport, acoes }
    const nomeVen = (vi: number) => base.ven[vi]?.[1] || base.ven[vi]?.[0] || 'Sem vendedor'
    const abusivos = [...modelo.venM].filter(([, a]) => a.tab > 0 && (100 * a.desc / a.tab) > 1.5 * descPct)
    abusivos.forEach(([vi, a]) => {
      const p = 100 * a.desc / a.tab
      riscos.push(`Desconto de ${nomeVen(vi)} acima do normal: ${nf({ maximumFractionDigits: 2 }).format(p)}% (empresa ${nf({ maximumFractionDigits: 2 }).format(descPct)}%)`)
      acoes.push(`Revisar o desconto de ${nomeVen(vi)}`)
    })
    const cliVals = [...modelo.cliM].map(([ci, a]) => ({ ci, val: a.val })).sort((a, b) => b.val - a.val)
    const tot = modelo.tot.val || 1
    let acc = 0; let nA = 0
    for (const c of cliVals) { if (acc / tot < 0.8) { nA++; acc += c.val } }
    if (nA) riscos.push(`Concentração: ${nA} clientes = ${nf({ maximumFractionDigits: 1 }).format(100 * acc / tot)}% do faturamento`)
    const inat = modelo.linM.get('INATIVOS')
    if (inat && inat.val > 0) riscos.push(`Vendas de produtos inativos: ${brl0(inat.val)}`)
    const melhor = [...modelo.venM].filter(([, a]) => a.exp > 0).map(([vi, a]) => ({ vi, idx: 100 * a.valP / a.exp }))
      .sort((a, b) => b.idx - a.idx)[0]
    if (melhor) oport.push(`Melhor preço médio: ${nomeVen(melhor.vi)} (índice ${nf({ maximumFractionDigits: 0 }).format(melhor.idx)})`)
    const topLinha = [...modelo.linM].sort((a, b) => b[1].val - a[1].val)[0]
    if (topLinha) oport.push(`Linha que mais fatura: ${topLinha[0]} (${nf({ maximumFractionDigits: 1 }).format(100 * topLinha[1].val / tot)}%)`)
    const topDev = [...modelo.devProd].sort((a, b) => b[1] - a[1])[0]
    if (topDev && topDev[1] > 0) acoes.push(`Cuidar das devoluções de ${topDev[0]}: ${brl0(topDev[1])}`)
    const topCli = cliVals[0]
    if (topCli) acoes.push(`Ligar para ${base.cli[topCli.ci]?.[0] ?? 'o maior cliente'} (maior cliente)`)
    return { riscos, oport, acoes }
  }, [modelo, base, descPct])

  const CORES_LINHA = ['#C8941A', '#3D2314', '#6B5D4F', '#9C8E80', '#E0B048', '#2f6f8f', '#3f7d4e']

  // Aba Clientes (SPEC §2.3): segmentos RFM, Pareto, cross-sell, notas, grupos, carteira e tabela completa.
  const clientesV7 = useMemo(() => base && modelo && estado && pg ? calcularClientesV7(base, modelo, estado, pg) : null, [base, modelo, estado, pg])
  // Aba Cidades (SPEC §2.4).
  const cidadesV7 = useMemo(() => base && modelo && estado && pg ? calcularCidadesV7(base, modelo, estado, pg) : null, [base, modelo, estado, pg])

  // Bloco 3 — aba Vendedores. Mesmas definições do placar v5 (motor-v5): ticket = faturamento ÷ notas;
  // R$/kg = preço da análise sem despojo; índice = faturamento ÷ valor esperado ao preço médio da empresa;
  // desconto = soma (tabela − praticado) ÷ tabela; devolução = devoluções ÷ faturamento.
  const vendedores = useMemo(() => {
    if (!modelo || !base) return [] as VendRow[]
    return [...modelo.venM].map(([vi, a]) => {
      const dev = modelo.devVen.get(vi) || 0
      const pz = modelo.venPz.get(vi)
      return {
        nome: base.ven[vi]?.[1] || base.ven[vi]?.[0] || 'Sem vendedor',
        val: a.val,
        part: 100 * a.val / (modelo.tot.val || 1),
        cli: a.clis.size,
        notas: a.notas.size,
        ticket: a.notas.size ? a.val / a.notas.size : null,
        rpkg: a.kgP ? a.valP / a.kgP : null,
        // Índice na base da análise (valP, só o que entra na conta) contra o esperado (exp), mesma base do R$/kg.
        idx: a.exp > 0 ? 100 * a.valP / a.exp : null,
        desc: a.tab > 0 ? 100 * a.desc / a.tab : 0,
        dev,
        devPct: a.val ? 100 * dev / a.val : 0,
        prazo: pz && pz[1] ? pz[0] / pz[1] : null,
      }
    }).sort((x, y) => y.val - x.val)
  }, [modelo, base])

  // O que cada um vende: faturamento por linha dentro de cada vendedor (100% empilhado no gráfico).
  const mixVendedor = useMemo(() => {
    if (!modelo || !base) return { linhas: [] as string[], rows: [] as Record<string, string | number>[] }
    const porVen = new Map<number, Map<string, number>>()
    const linhasSet = new Set<string>()
    modelo.its.forEach((x) => {
      const linha = base.prod[x[4]]?.[1] || '—'
      linhasSet.add(linha)
      let m = porVen.get(x[2]); if (!m) { m = new Map(); porVen.set(x[2], m) }
      m.set(linha, (m.get(linha) || 0) + x[6])
    })
    const linhas = [...linhasSet].sort()
    const rows = [...porVen].map(([vi, m]) => {
      const row: Record<string, string | number> = { nome: base.ven[vi]?.[1] || base.ven[vi]?.[0] || 'Sem vendedor' }
      linhas.forEach((l) => { row[l] = m.get(l) || 0 })
      return row
    })
    return { linhas, rows }
  }, [modelo, base])

  if (!empresa) {
    return <div style={{ padding: 16, color: C.m }}>Escolha uma empresa para ver o painel.</div>
  }

  const selStyle: CSSProperties = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp, fontSize: 14, minHeight: 40 }

  return (
    <div style={{ padding: 16, background: C.off, color: C.esp, minHeight: '100vh', boxSizing: 'border-box', width: '100%', maxWidth: 1100, marginLeft: 'auto', marginRight: 'auto', overflowX: 'hidden' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Painel de vendas</h1>
      <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
        {base ? <>De {dataBR(base.de)} a {dataBR(base.ate)}.</> : null}
        {carregando ? ' Carregando…' : null}
        {erro ? <span style={{ color: '#C0392B' }}> {erro}</span> : null}
      </p>

      {/* Filtros: período, vendedor, linha */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div role="group" aria-label="Período" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <AjudaCampo chave="com.painel.periodo" rota={ROTA} />
          {PERIODOS.map((p) => (
            <button key={p.k} type="button" onClick={() => setPer(p.k)} aria-pressed={per === p.k}
              style={{ padding: '8px 12px', minHeight: 40, borderRadius: 999, fontSize: 13, cursor: 'pointer',
                border: `1px solid ${per === p.k ? C.gold : C.bd}`, background: per === p.k ? C.gold : '#fff', color: per === p.k ? '#fff' : C.esp }}>
              {p.rot}
            </button>
          ))}
        </div>
        {per === 'custom' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <AjudaCampo chave="com.painel.periodo" rota={ROTA} />
            <input type="date" aria-label="De" value={deC} onChange={(e) => setDeC(e.target.value)} style={selStyle} />
            <span style={{ color: C.m, fontSize: 13 }}>até</span>
            <input type="date" aria-label="Até" value={ateC} onChange={(e) => setAteC(e.target.value)} style={selStyle} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: C.m }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Vendedor<AjudaCampo chave="com.painel.equipe" rota={ROTA} /></span>
          <select aria-label="Vendedor" value={String(estado?.ven ?? 'todos')} onChange={(e) => setVen(e.target.value === 'todos' ? 'todos' : Number(e.target.value))} style={selStyle} disabled={!base}>
            <option value="todos">Todos</option>
            {(base?.ven ?? []).map(([cod, nome], i) => <option key={cod + i} value={i}>{nome || cod}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: C.m }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Linha<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></span>
          <select aria-label="Linha" value={String(estado?.lin ?? 'todas')} onChange={(e) => setLin(e.target.value === 'todas' ? 'todas' : Number(e.target.value))} style={selStyle} disabled={!base}>
            <option value="todas">Todas</option>
            {LINHAS_OPC.map((nome, i) => <option key={i} value={i}>{nome}</option>)}
          </select>
        </label>
      </div>

      {/* Navegação das 8 abas */}
      <nav aria-label="Abas" style={{ display: 'flex', gap: 6, overflowX: 'auto', borderBottom: `1px solid ${C.bd}`, marginBottom: 16, paddingBottom: 2 }}>
        {ABAS.map((a) => (
          <button key={a.k} type="button" onClick={() => setAba(a.k)} aria-current={aba === a.k ? 'page' : undefined}
            style={{ flex: '0 0 auto', padding: '10px 12px', minHeight: 40, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
              borderBottom: `3px solid ${aba === a.k ? C.gold : 'transparent'}`, color: aba === a.k ? C.esp : C.m, fontWeight: aba === a.k ? 700 : 500, whiteSpace: 'nowrap' }}>
            {a.rot}
          </button>
        ))}
      </nav>

      {aba !== 'geral' && aba !== 'vendedores' && aba !== 'clientes' && aba !== 'cidades' && (
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, color: C.m, fontSize: 14 }}>
          <b style={{ color: C.esp }}>{ABAS.find((a) => a.k === aba)?.rot}</b> — esta aba entra no próximo bloco do painel. O período e os filtros acima já valem para ela.
        </div>
      )}

      {aba === 'geral' && (<>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Como a Frioeste está vendendo</h2>

      {r && modelo && (
        <>
          <p style={{ fontSize: 16, lineHeight: 1.5, margin: '0 0 16px' }}>
            Faturou <b>{brl0(r.totalValor)}</b> em <b>{ton(modelo.tot.kg)}</b>, para <b>{int(r.clientes)} clientes</b>. Sem o despojo, o quilo sai a <b>{brl2(r.precoPorKg)}</b>. <b>{nf({ maximumFractionDigits: 1 }).format(itensAbaixoPct)}%</b> dos itens saíram abaixo do preço de tabela, somando <b>{brl0(descR)}</b> de desconto.
          </p>

          {/* 8 cards KPI (SPEC §2.1) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Cartao rot="Faturamento" chave="com.painel.faturado" valor={brl0(r.totalValor)} />
            <Cartao rot="Volume na análise" chave="com.painel.volume" valor={ton(modelo.tot.kgP)} />
            <Cartao rot="Preço médio" chave="com.painel.preco" valor={brl2(r.precoPorKg)} sub="R$/kg sem despojo" />
            <Cartao rot="Ticket por nota" chave="com.painel.ticket" valor={brl0(ticketNota)} sub={`${int(notas)} notas`} />
            <Cartao rot="Desconto na tabela" chave="com.painel.desconto" valor={`${nf({ maximumFractionDigits: 2 }).format(descPct)}%`} sub={brl0(descR)} />
            <Cartao rot="Devoluções" chave="com.painel.devolucao" valor={`${nf({ maximumFractionDigits: 2 }).format(devPct)}%`} sub={brl0(devR)} />
            <Cartao rot="Clientes que compraram" chave="com.painel.clientes" valor={int(r.clientes)} />
            <Cartao rot="Prazo médio" chave="com.painel.visao" valor={prazo == null ? '—' : `${nf({ maximumFractionDigits: 1 }).format(prazo)} dias`} sub="ponderado pelo valor" />
          </div>

          {/* Diagnóstico do período (SPEC §2.1): painel escuro, 3 colunas */}
          <div style={{ background: C.esp, color: C.off, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4, color: C.gold2 }}>Diagnóstico do período<AjudaCampo chave="com.painel.visao" rota={ROTA} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {([['⚠️ Riscos', diagnostico.riscos], ['💡 Oportunidades', diagnostico.oport], ['✅ Ações', diagnostico.acoes]] as [string, string[]][]).map(([titulo, itens]) => (
                <div key={titulo}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: C.gold2 }}>{titulo}</div>
                  {itens.length ? (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
                      {itens.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  ) : <div style={{ fontSize: 13, opacity: 0.8 }}>Nada fora do normal neste período.</div>}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {/* Do que vive a Frioeste: donut com alternância faturamento/volume */}
            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Do que vive a Frioeste<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['val', 'kg'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setDonutMetrica(m)} aria-pressed={donutMetrica === m}
                      style={{ padding: '4px 10px', minHeight: 32, borderRadius: 999, fontSize: 12, cursor: 'pointer', border: `1px solid ${donutMetrica === m ? C.gold : C.bd}`, background: donutMetrica === m ? C.gold : '#fff', color: donutMetrica === m ? '#fff' : C.esp }}>
                      {m === 'val' ? 'Faturamento' : 'Volume'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={linhasTab} dataKey={donutMetrica === 'val' ? 'val' : 'kg'} nameKey="nome" innerRadius={55} outerRadius={85} paddingAngle={2}>
                      {linhasTab.map((l, i) => <Cell key={l.nome} fill={CORES_LINHA[i % CORES_LINHA.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => donutMetrica === 'val' ? brl0(Number(v)) : `${int(Number(v))} kg`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: 13 }}>
                {linhasTab.map((l, i) => (
                  <li key={l.nome} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
                    <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: CORES_LINHA[i % CORES_LINHA.length], marginRight: 6 }} />{l.nome}</span>
                    <span style={{ color: C.m }}>{brl0(l.val)} · {nf({ maximumFractionDigits: 1 }).format(l.part)}%</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Ritmo da semana */}
            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Ritmo da semana<AjudaCampo chave="com.painel.meses" rota={ROTA} /></div>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ritmoSemana} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={C.bd} />
                    <XAxis dataKey="rot" tick={{ fontSize: 12, fill: C.m }} />
                    <YAxis tickFormatter={(v: number) => brl0(v)} tick={{ fontSize: 11, fill: C.m }} width={84} />
                    <Tooltip formatter={(v) => brl0(Number(v))} />
                    <Bar dataKey="val" fill={C.esp} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Para onde vai o mês: realizado × projetado */}
            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Para onde vai o mês<AjudaCampo chave="com.painel.meses" rota={ROTA} /></div>
              <div style={{ width: '100%', height: 170, marginTop: 6 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[{ rot: 'Realizado', val: r.totalValor }, { rot: 'Projetado', val: projecaoMes ?? 0 }]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="rot" tick={{ fontSize: 12, fill: C.m }} />
                    <YAxis tickFormatter={(v: number) => brlc(v)} tick={{ fontSize: 11, fill: C.m }} width={84} />
                    <Tooltip formatter={(v) => brl0(Number(v))} />
                    <Bar dataKey="val" radius={[4, 4, 0, 0]}>
                      <Cell fill={C.esp} />
                      <Cell fill={C.gold} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ fontSize: 13, color: C.m, marginTop: 4 }}>
                Estimativa no ritmo do período: {brl0(mediaDia)} por dia com venda × 30 dias. Não é previsão contábil.
              </div>
            </div>

            {/* Preço médio do kg: linha temporal */}
            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Preço médio do kg<AjudaCampo chave="com.painel.rpkg" rota={ROTA} /></div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['dia', 'semana'] as const).map((e) => (
                    <button key={e} type="button" onClick={() => setEscalaPreco(e)} aria-pressed={escalaPreco === e}
                      style={{ padding: '4px 10px', minHeight: 32, borderRadius: 999, fontSize: 12, cursor: 'pointer', border: `1px solid ${escalaPreco === e ? C.gold : C.bd}`, background: escalaPreco === e ? C.gold : '#fff', color: escalaPreco === e ? '#fff' : C.esp }}>
                      {e === 'dia' ? 'Por dia' : 'Por semana'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={precoSerie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={C.bd} />
                    <XAxis dataKey="rot" tick={{ fontSize: 11, fill: C.m }} interval="preserveStartEnd" />
                    <YAxis domain={['auto', 'auto']} tickFormatter={(v: number) => brl2(v)} tick={{ fontSize: 11, fill: C.m }} width={70} />
                    <Tooltip formatter={(v) => brl2(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="t" name="Toda a análise" stroke={C.esp} dot={false} connectNulls />
                    <Line type="monotone" dataKey="g0" name="Desossados" stroke={C.gold} dot={false} connectNulls />
                    <Line type="monotone" dataKey="g1" name="Com osso" stroke={C.verde} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Faturamento por dia */}
          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, marginTop: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8 }}>Faturamento por dia</div>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={C.bd} />
                  <XAxis dataKey="rot" tick={{ fontSize: 11, fill: C.m }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => brl0(v)} tick={{ fontSize: 11, fill: C.m }} width={84} />
                  <Tooltip formatter={(v) => brl0(Number(v))} labelFormatter={(_, p) => dataBR(String(p?.[0]?.payload?.dia ?? ''))} />
                  <Bar dataKey="val" fill={C.gold} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* As linhas de produto: tabela ordenável, todas as linhas */}
          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, marginTop: 12, overflowX: 'auto' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>As linhas de produto<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 620 }}>
              <thead>
                <tr style={{ color: C.m, textAlign: 'left' }}>
                  {([['Linha', null], ['Faturamento', 'val'], ['Part.', 'part'], ['Volume', 'kg'], ['R$/kg', 'rpkg'], ['Desconto', 'desc'], ['Clientes', 'cli']] as [string, 'val' | 'part' | 'kg' | 'rpkg' | 'desc' | 'cli' | null][]).map(([rot, k]) => (
                    <th key={rot} style={{ padding: '6px 4px', textAlign: k || rot === 'Linha' ? (rot === 'Linha' ? 'left' : 'right') : 'left' }}>
                      {k ? (
                        <button type="button" onClick={() => setOrdLin((o) => ({ k, dir: o.k === k ? (o.dir === 1 ? -1 : 1) : -1 }))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.m, fontWeight: 600, fontSize: 14, padding: 0 }}>
                          {rot}{ordLin.k === k ? (ordLin.dir === -1 ? ' ↓' : ' ↑') : ''}
                        </button>
                      ) : rot}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhasTab.map((l) => (
                  <tr key={l.nome} style={{ borderTop: `1px solid ${C.bd}` }}>
                    <td style={{ padding: '6px 4px' }}>{l.nome}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                        <span style={{ display: 'inline-block', width: 80, height: 8, background: C.bg2, borderRadius: 4, overflow: 'hidden' }}>
                          <span style={{ display: 'block', height: 8, width: `${Math.min(100, l.part)}%`, background: C.gold }} />
                        </span>
                        {brl0(l.val)}
                      </div>
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{nf({ maximumFractionDigits: 1 }).format(l.part)}%</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{ton(l.kg)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl2(l.rpkg)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{nf({ maximumFractionDigits: 2 }).format(l.desc)}%</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(l.cli)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      </>)}

      {aba === 'vendedores' && r && modelo && (<>
          <div style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Vendedores</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 8 }}>
            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Quem vende quanto<AjudaCampo chave="com.painel.equipe" rota={ROTA} /></div>
              <div style={{ width: '100%', height: Math.max(180, vendedores.length * 34) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={vendedores} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke={C.bd} />
                    <XAxis type="number" tickFormatter={(v: number) => brl0(v)} tick={{ fontSize: 11, fill: C.m }} />
                    <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 12, fill: C.esp }} />
                    <Tooltip formatter={(v) => brl0(Number(v))} />
                    <Bar dataKey="val" fill={C.gold} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Desconto × devolução<AjudaCampo chave="com.painel.desconto" rota={ROTA} /></div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke={C.bd} />
                    <XAxis type="number" dataKey="desc" name="Desconto" unit="%" tick={{ fontSize: 11, fill: C.m }} />
                    <YAxis type="number" dataKey="devPct" name="Devolução" unit="%" tick={{ fontSize: 11, fill: C.m }} width={48} />
                    <ZAxis range={[80, 80]} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v, n) => `${nf({ maximumFractionDigits: 2 }).format(Number(v))}${n === 'Desconto' || n === 'Devolução' ? '%' : ''}`} />
                    <Scatter data={vendedores} fill={C.esp} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div style={{ fontSize: 12, color: C.m, marginTop: 4 }}>Cada ponto é um vendedor: à direita, mais desconto; acima, mais devolução.</div>
            </div>

            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>O que cada um vende<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></div>
              <div style={{ width: '100%', height: Math.max(180, mixVendedor.rows.length * 34) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mixVendedor.rows} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 12, fill: C.esp }} />
                    <Tooltip formatter={(v) => brl0(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {mixVendedor.linhas.map((l, i) => (
                      <Bar key={l} dataKey={l} stackId="mix" fill={CORES_LINHA[i % CORES_LINHA.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, marginTop: 12, overflowX: 'auto' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Placar dos vendedores<AjudaCampo chave="com.painel.faturado" rota={ROTA} /></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
              <thead>
                <tr style={{ color: C.m, textAlign: 'left' }}>
                  <th style={{ padding: '6px 4px' }}>Vendedor</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Faturamento</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Part.</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Clientes</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Ticket</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>R$/kg</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Índice</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Desconto</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Devolução</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Prazo</th>
                </tr>
              </thead>
              <tbody>
                {vendedores.map((v) => (
                  <tr key={v.nome} style={{ borderTop: `1px solid ${C.bd}` }}>
                    <td style={{ padding: '6px 4px' }}>{v.nome}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(v.val)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{nf({ maximumFractionDigits: 1 }).format(v.part)}%</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(v.cli)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(v.ticket)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl2(v.rpkg)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{v.idx == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v.idx)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{nf({ maximumFractionDigits: 2 }).format(v.desc)}%</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(v.dev)} · {nf({ maximumFractionDigits: 2 }).format(v.devPct)}%</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{v.prazo == null ? '—' : `${nf({ maximumFractionDigits: 0 }).format(v.prazo)} dias`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </>)}

      {aba === 'clientes' && base && modelo && clientesV7 && (
        <AbaClientes clientes={clientesV7} base={base} modelo={modelo} />
      )}
      {aba === 'cidades' && base && modelo && cidadesV7 && (
        <AbaCidades cidades={cidadesV7} base={base} modelo={modelo} />
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: C.d }}>
        <AjudaCampo chave="com.painel.faturado" rota={ROTA} /> Esta é a versão nova do painel. O painel atual continua disponível.
      </div>
    </div>
  )
}

function Cartao({ rot, chave, valor, sub }: { rot: string; chave: string; valor: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.esp, marginTop: 4 }}>{valor}</div>
      {sub ? <div style={{ fontSize: 12, color: C.d, marginTop: 2 }}>{sub}</div> : null}
    </div>
  )
}

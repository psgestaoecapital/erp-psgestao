'use client'
// Aba Clientes do painel v7 (SPEC §2.3). Só desenha: os números vêm de calcularClientesV7 (clientes-v7.ts),
// sobre o motor v5 e a base da fn_bi_comercial_base (fonte bi_comercial_venda_item_mv).
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart } from 'recharts'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { BaseV5, ModeloV5 } from '../meu-painel/motor-v5'
import { ACAO_SEGMENTO, SEGMENTOS, type ClientesV7, type LinhaCliente, type Segmento } from './clientes-v7'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', ok: '#1a8f63', warn: '#b07a12', bad: '#C0392B', bg2: '#F0ECE3' }
const ROTA = '/dashboard/comercial/meu-painel-v6'
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const pct = (v: number) => `${nf({ maximumFractionDigits: 1 }).format(v)}%`
const COR_SEG: Record<Segmento, string> = {
  'Campeões': C.ok, 'Fiéis': C.esp, 'Novos recapturáveis': C.gold, 'Ocasionais': C.d, 'Em risco': C.warn, 'Sumindo': C.bad,
}

type Dim = 'cliente' | 'produto' | 'cidade' | 'vendedor'
type Props = { clientes: ClientesV7; base: BaseV5; modelo: ModeloV5 }

export function AbaClientes({ clientes, base, modelo }: Props) {
  const [segFiltro, setSegFiltro] = useState<Segmento | 'todos'>('todos')
  const [busca, setBusca] = useState('')
  const [dim, setDim] = useState<Dim>('cliente')
  const [ord, setOrd] = useState<{ k: keyof LinhaCliente; dir: 1 | -1 }>({ k: 'val', dir: -1 })
  const total = modelo.tot.val || 1
  const nCli = clientes.linhas.length

  // Leitura automática
  const curvaA = clientes.linhas.filter((l) => l.curva === 'A')
  const valA = curvaA.reduce((s, l) => s + l.val, 0)

  // Tabela de clientes: filtro por segmento e busca, ordenação por coluna. Mostra TODAS as linhas (sem corte).
  const tabela = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const rows = clientes.linhas.filter((l) => (segFiltro === 'todos' || l.segmento === segFiltro) &&
      (!q || l.nome.toLowerCase().includes(q) || l.cidade.toLowerCase().includes(q)))
    const k = ord.k
    return [...rows].sort((a, b) => {
      const va = (a[k] as unknown as number | string | null) ?? -1
      const vb = (b[k] as unknown as number | string | null) ?? -1
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * ord.dir
      return ((va as number) - (vb as number)) * ord.dir
    })
  }, [clientes.linhas, segFiltro, busca, ord])

  // Pareto multidimensional: cliente, produto, cidade ou vendedor.
  const pareto = useMemo(() => {
    let itens: { nome: string; val: number }[] = []
    if (dim === 'cliente') itens = clientes.linhas.map((l) => ({ nome: l.nome, val: l.val }))
    else if (dim === 'produto') itens = [...modelo.prodM].map(([pi, a]) => ({ nome: base.prod[pi]?.[0] ?? String(pi), val: a.val }))
    else if (dim === 'cidade') itens = [...modelo.cidM].map(([ci, a]) => ({ nome: base.cid[ci] ?? String(ci), val: a.val }))
    else itens = [...modelo.venM].map(([vi, a]) => ({ nome: base.ven[vi]?.[1] || base.ven[vi]?.[0] || 'Sem vendedor', val: a.val }))
    itens.sort((a, b) => b.val - a.val)
    let acc = 0
    const linhas = itens.map((it) => {
      const antes = acc / total
      acc += it.val
      const cls: 'A' | 'B' | 'C' = antes < 0.8 ? 'A' : antes < 0.95 ? 'B' : 'C'
      return { ...it, acum: 100 * acc / total, cls }
    })
    const resumo = (c: 'A' | 'B' | 'C') => {
      const ls = linhas.filter((l) => l.cls === c)
      return { n: ls.length, val: ls.reduce((s, l) => s + l.val, 0) }
    }
    return { linhas, resumo }
  }, [dim, clientes.linhas, modelo, base, total])

  const ordenarPor = (k: keyof LinhaCliente) => setOrd((o) => ({ k, dir: o.k === k ? (o.dir === 1 ? -1 : 1) : -1 }))
  const seta = (k: keyof LinhaCliente) => ord.k === k ? (ord.dir === -1 ? ' ↓' : ' ↑') : ''

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0 }}>
        <b>{int(nCli)} clientes</b> no período. A curva A (<b>{int(curvaA.length)}</b> clientes) concentra <b>{pct(total ? 100 * valA / total : 0)}</b> do faturamento. Clientes em risco e sumindo precisam de atenção.
      </p>

      {/* 6 grupos RFM (SPEC §2.3) */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Os {int(nCli)} clientes em 6 grupos<AjudaCampo chave="com.painel.clientes" rota={ROTA} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          {clientes.segmentos.map((s) => (
            <div key={s.seg} style={{ background: '#fff', border: `1px solid ${C.bd}`, borderTop: `4px solid ${COR_SEG[s.seg]}`, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{s.seg}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{int(s.clientes)} <span style={{ fontSize: 13, color: C.m, fontWeight: 500 }}>clientes</span></div>
              <div style={{ fontSize: 13, color: C.m }}>{brl0(s.val)} · {s.rpkg == null ? '—' : brl2(s.rpkg)}/kg</div>
              <div style={{ fontSize: 12, color: C.esp, marginTop: 2 }}>{ACAO_SEGMENTO[s.seg]}</div>
              <button type="button" onClick={() => setSegFiltro(segFiltro === s.seg ? 'todos' : s.seg)} disabled={s.clientes === 0}
                style={{ marginTop: 4, alignSelf: 'flex-start', padding: '6px 10px', minHeight: 36, borderRadius: 8, border: `1px solid ${C.bd}`, background: segFiltro === s.seg ? C.gold : '#fff', color: segFiltro === s.seg ? '#fff' : C.esp, fontSize: 12, cursor: s.clientes ? 'pointer' : 'default' }}>
                {s.clientes ? (segFiltro === s.seg ? 'Mostrando na tabela' : `Ver os ${int(s.clientes)} na tabela`) : 'Nenhum cliente'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Quanto dependemos de poucos: Pareto + curva ABC multidimensional */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>Quanto dependemos de poucos<AjudaCampo chave="com.painel.curva" rota={ROTA} /></div>
          <label style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 6 }}>Olhar por<AjudaCampo chave="com.painel.dimensao" rota={ROTA} />
            <select aria-label="Dimensão do Pareto" value={dim} onChange={(e) => setDim(e.target.value as Dim)} style={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.bd}`, fontSize: 13, minHeight: 36 }}>
              <option value="cliente">Cliente</option><option value="produto">Produto</option><option value="cidade">Cidade</option><option value="vendedor">Vendedor</option>
            </select>
          </label>
        </div>
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pareto.linhas.map((l, i) => ({ i: i + 1, acum: l.acum }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.bd} />
              <XAxis dataKey="i" tick={{ fontSize: 11, fill: C.m }} />
              <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11, fill: C.m }} width={48} />
              <Tooltip formatter={(v) => pct(Number(v))} labelFormatter={(i) => `${i}º de ${pareto.linhas.length}`} />
              <Line type="monotone" dataKey="acum" name="Acumulado" stroke={C.gold} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
            <thead><tr style={{ color: C.m, textAlign: 'left' }}>
              <th style={{ padding: '6px 4px' }}>Curva</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>{dim === 'cliente' ? 'Clientes' : 'Itens'}</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Faturamento</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Participação</th>
            </tr></thead>
            <tbody>
              {(['A', 'B', 'C'] as const).map((c) => {
                const r = pareto.resumo(c)
                return (
                  <tr key={c} style={{ borderTop: `1px solid ${C.bd}` }}>
                    <td style={{ padding: '6px 4px', fontWeight: 700 }}>{c}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(r.n)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(r.val)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{pct(100 * r.val / total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: C.m, marginTop: 6 }}>A = até 80% do faturamento · B = até 95% · C = o resto.</div>
      </div>

      {/* Cross-sell */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Quem compra mais linhas gasta mais<AjudaCampo chave="com.painel.clientes" rota={ROTA} /></div>
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={clientes.crossSell.map((x) => ({ rot: `${x.linhas} linha${x.linhas > 1 ? 's' : ''}`, media: x.media }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.bd} />
              <XAxis dataKey="rot" tick={{ fontSize: 12, fill: C.m }} />
              <YAxis tickFormatter={(v: number) => brl0(v)} tick={{ fontSize: 11, fill: C.m }} width={84} />
              <Tooltip formatter={(v) => brl0(Number(v))} />
              <Bar dataKey="media" fill={C.gold} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
            <thead><tr style={{ color: C.m, textAlign: 'left' }}>
              <th style={{ padding: '6px 4px' }}>Linhas compradas</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Clientes</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Faturamento</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Média por cliente</th>
            </tr></thead>
            <tbody>
              {clientes.crossSell.map((x) => (
                <tr key={x.linhas} style={{ borderTop: `1px solid ${C.bd}` }}>
                  <td style={{ padding: '6px 4px' }}>{x.linhas}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(x.clientes)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(x.val)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(x.media)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tamanho das notas */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Tamanho das notas<AjudaCampo chave="com.painel.clientes" rota={ROTA} /></div>
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={clientes.notas.map((x) => ({ rot: x.faixa, n: x.notas }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.bd} />
              <XAxis dataKey="rot" tick={{ fontSize: 11, fill: C.m }} interval={0} />
              <YAxis tick={{ fontSize: 11, fill: C.m }} width={48} />
              <Tooltip formatter={(v) => `${int(Number(v))} notas`} />
              <Bar dataKey="n" fill={C.esp} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 380 }}>
            <thead><tr style={{ color: C.m, textAlign: 'left' }}>
              <th style={{ padding: '6px 4px' }}>Faixa de valor da nota</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Notas</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Faturamento</th>
            </tr></thead>
            <tbody>
              {clientes.notas.map((x) => (
                <tr key={x.faixa} style={{ borderTop: `1px solid ${C.bd}` }}>
                  <td style={{ padding: '6px 4px' }}>{x.faixa}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(x.notas)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(x.val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Saúde da carteira */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Saúde da carteira<AjudaCampo chave="com.painel.clientes" rota={ROTA} /></div>
        <div style={{ width: '100%', height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={clientes.carteira.map((x) => ({ rot: x.faixa, n: x.clientes }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.bd} />
              <XAxis dataKey="rot" tick={{ fontSize: 11, fill: C.m }} />
              <YAxis tick={{ fontSize: 11, fill: C.m }} width={48} />
              <Tooltip formatter={(v) => `${int(Number(v))} clientes`} />
              <Bar dataKey="n" radius={[4, 4, 0, 0]}>
                {clientes.carteira.map((_, i) => <Cell key={i} fill={[C.ok, C.gold, C.warn, C.bad][i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ fontSize: 12, color: C.m, marginTop: 4 }}>Recência = dias desde a última compra, até o fim do período ({clientes.diasPeriodo} dias).</div>
      </div>

      {/* Grupos econômicos (CPF raiz) */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, overflowX: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>Grupos econômicos<AjudaCampo chave="com.painel.clientes" rota={ROTA} /></div>
        <div style={{ fontSize: 12, color: C.m, marginBottom: 8 }}>
          {clientes.grupos.length} grupos por CPF raiz. Clientes sem CPF raiz no cadastro não entram nesta tabela ({int(nCli - clientes.grupos.reduce((s, g) => s + g.lojas, 0))} clientes, {brl0(modelo.tot.val - clientes.grupos.reduce((s, g) => s + g.val, 0))}).
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
          <thead><tr style={{ color: C.m, textAlign: 'left' }}>
            <th style={{ padding: '6px 4px' }}>Grupo</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Lojas</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Faturamento</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>R$/kg</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Devolução</th>
          </tr></thead>
          <tbody>
            {clientes.grupos.map((g) => (
              <tr key={g.grupo} style={{ borderTop: `1px solid ${C.bd}` }}>
                <td style={{ padding: '6px 4px' }}>{g.nome}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(g.lojas)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(g.val)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl2(g.rpkg)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(g.devolucao)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tabela de clientes: TODAS as linhas, ordenável, filtro por segmento e busca */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Todos os clientes ({int(tabela.length)}{segFiltro !== 'todos' ? ` · ${segFiltro}` : ''})</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <AjudaCampo chave="com.painel.busca" rota={ROTA} />
            <input aria-label="Buscar cliente" placeholder="Buscar cliente ou cidade" value={busca} onChange={(e) => setBusca(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.bd}`, fontSize: 14, minHeight: 40, minWidth: 200 }} />
            {segFiltro !== 'todos' && <button type="button" onClick={() => setSegFiltro('todos')} style={{ padding: '8px 10px', minHeight: 40, borderRadius: 8, border: `1px solid ${C.bd}`, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Ver todos os segmentos</button>}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr style={{ color: C.m, textAlign: 'left' }}>
                {([['Cliente', 'nome'], ['Segmento', 'segmento'], ['Curva', 'curva'], ['Faturamento', 'val'], ['Part.', 'part'], ['R$/kg', 'rpkg'], ['Desconto', 'descPct'], ['Recência', 'recencia'], ['Frequência', 'frequencia'], ['Devolução', 'devolucao']] as [string, keyof LinhaCliente][]).map(([rot, k]) => (
                  <th key={rot} style={{ padding: '6px 4px', textAlign: k === 'nome' || k === 'segmento' || k === 'curva' ? 'left' : 'right' }}>
                    <button type="button" onClick={() => ordenarPor(k)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.m, fontWeight: 600, fontSize: 13, padding: 0 }}>{rot}{seta(k)}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tabela.map((l) => (
                <tr key={l.ci} style={{ borderTop: `1px solid ${C.bd}` }}>
                  <td style={{ padding: '6px 4px' }}>{l.nome}<div style={{ fontSize: 11, color: C.d }}>{l.cidade}</div></td>
                  <td style={{ padding: '6px 4px' }}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, border: `1px solid ${COR_SEG[l.segmento]}`, color: COR_SEG[l.segmento] }}>{l.segmento}</span></td>
                  <td style={{ padding: '6px 4px' }}>{l.curva}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(l.val)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{pct(l.part)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl2(l.rpkg)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: l.descPct > 2 ? C.bad : l.descPct > 1 ? C.warn : C.ok }}>{pct(l.descPct)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{l.recencia} d</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(l.frequencia)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(l.devolucao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

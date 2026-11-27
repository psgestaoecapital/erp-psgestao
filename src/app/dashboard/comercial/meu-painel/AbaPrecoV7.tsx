'use client'
// Aba Preço e desconto do painel v7 (SPEC §2.6). Só desenha: números de calcularPrecoV7 (precoV7.ts).
// Spec do CEO 26/11: ganhos na tabela (espelho do desconto), líquido = ganhos − descontos, e % simples × ponderado.
import { useMemo, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { ClientePreco, PctLeituras, PrecoV7, VendedorPreco } from './precoV7'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', ok: '#1a8f63', bad: '#C0392B', bg2: '#F0ECE3' }
const ROTA = '/dashboard/comercial/meu-painel'
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const pct = (v: number | null | undefined) => v == null ? '—' : `${nf({ maximumFractionDigits: 2 }).format(v)}%`
const idx1 = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 1 }).format(v)
/** Valor com sinal explícito: + verde (ganho), − vermelho (desconto). */
const sinal = (v: number, fmt: (n: number) => string) => (Math.abs(v) < 0.005 ? fmt(0) : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}`)
const corSinal = (v: number) => (v > 0.005 ? C.ok : v < -0.005 ? C.bad : C.m)

const card = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 } as const
const titulo = { fontSize: 15, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 } as const
const sub = { fontSize: 12, color: C.m, marginBottom: 8, lineHeight: 1.45 } as const
const td = { padding: '6px 4px' } as const
const tdR = { padding: '6px 4px', textAlign: 'right' } as const

type Props = { preco: PrecoV7 }

/** Coluna de tabela ordenável. */
type Col<T> = { rot: string; k?: (r: T) => number | null; cel: (r: T) => ReactNode; dir?: boolean }

function TabelaOrdenavel<T>({ linhas, cols, chave, ordInicial, minW }: { linhas: T[]; cols: Col<T>[]; chave: (r: T) => string | number; ordInicial: number; minW: number }) {
  const [ord, setOrd] = useState<{ i: number; dir: 1 | -1 }>({ i: ordInicial, dir: -1 })
  const ordenadas = useMemo(() => {
    const k = cols[ord.i]?.k
    if (!k) return linhas
    return [...linhas].sort((a, b) => ((k(a) ?? -Infinity) - (k(b) ?? -Infinity)) * ord.dir)
  }, [linhas, cols, ord])
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: minW }}>
        <thead>
          <tr style={{ color: C.m, textAlign: 'left' }}>
            {cols.map((c, i) => (
              <th key={c.rot} style={c.dir ? tdR : td}>
                {c.k ? (
                  <button type="button" onClick={() => setOrd((o) => ({ i, dir: o.i === i ? (o.dir === 1 ? -1 : 1) : -1 }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.m, fontWeight: 600, fontSize: 13, padding: 0 }}>
                    {c.rot}{ord.i === i ? (ord.dir === -1 ? ' ↓' : ' ↑') : ''}
                  </button>
                ) : c.rot}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((r) => (
            <tr key={chave(r)} style={{ borderTop: `1px solid ${C.bd}` }}>
              {cols.map((c) => <td key={c.rot} style={c.dir ? tdR : td}>{c.cel(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Barrinha horizontal de percentual. */
const Barra = ({ v, cor }: { v: number; cor: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
    <span style={{ display: 'inline-block', width: 60, height: 8, background: C.bg2, borderRadius: 4, overflow: 'hidden' }}>
      <span style={{ display: 'block', height: 8, width: `${Math.min(100, Math.max(0, v))}%`, background: cor }} />
    </span>
    {pct(v)}
  </div>
)

function Kpi({ rot, chave, valor, cor, linha }: { rot: string; chave: string; valor: string; cor: string; linha: ReactNode }) {
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontSize: 22, fontWeight: 800, color: cor, marginTop: 4 }}>{valor}</div>
      <div style={{ fontSize: 12, color: C.m, marginTop: 4 }}>{linha}</div>
    </div>
  )
}

const leituras = (p: PctLeituras) => <>ponderado <b>{pct(p.ponderado)}</b> · simples {pct(p.simples)}</>

export function AbaPrecoV7({ preco }: Props) {
  const t = preco.total
  const [faixaAberta, setFaixaAberta] = useState<string | null>('Acima da tabela')
  const maxFaixa = Math.max(1, ...preco.faixas.map((f) => f.val))
  const clientesGanho = useMemo(() => preco.clientes.filter((c) => c.ganho > 0), [preco.clientes])
  const graficoOk = preco.nVendedoresIdx >= 2
  // Eixo simétrico com folga mínima de 5 pontos: nunca degenera para a escala do resto de ponto flutuante.
  const maxDesvio = Math.max(5, ...preco.vendedores.map((v) => Math.abs(v.desvio ?? 0)))
  const limEixo = Math.ceil(maxDesvio * 1.1)
  const unico = preco.vendedores.find((v) => v.idx != null)

  const colsVen: Col<VendedorPreco>[] = [
    { rot: 'Vendedor', cel: (r) => r.nome },
    { rot: 'Índice', k: (r) => r.idx, cel: (r) => <b>{idx1(r.idx)}</b>, dir: true },
    { rot: 'Índice simples', k: (r) => r.idxSimples, cel: (r) => <span style={{ color: C.m }}>{idx1(r.idxSimples)}</span>, dir: true },
    { rot: 'Ganho', k: (r) => r.ganho, cel: (r) => <span style={{ color: C.ok }}>{brl0(r.ganho)}</span>, dir: true },
    { rot: '% acima', k: (r) => r.ganhoPct.ponderado, cel: (r) => pct(r.ganhoPct.ponderado), dir: true },
    { rot: 'Desconto', k: (r) => r.desc, cel: (r) => <span style={{ color: C.bad }}>{brl0(r.desc)}</span>, dir: true },
    { rot: '% abaixo', k: (r) => r.descPct.ponderado, cel: (r) => pct(r.descPct.ponderado), dir: true },
    { rot: 'Líquido', k: (r) => r.liquido, cel: (r) => <b style={{ color: corSinal(r.liquido) }}>{sinal(r.liquido, brl0)}</b>, dir: true },
    { rot: 'Faturamento', k: (r) => r.val, cel: (r) => brl0(r.val), dir: true },
  ]
  const colsCliBase: Col<ClientePreco>[] = [
    { rot: 'Cliente', cel: (r) => r.nome },
    { rot: 'Cidade', cel: (r) => <span style={{ color: C.m }}>{r.cidade}</span> },
    { rot: 'Vendedor', cel: (r) => <span style={{ color: C.m }}>{r.vendedor}</span> },
  ]
  const colsGanho: Col<ClientePreco>[] = [
    ...colsCliBase,
    { rot: '% acima (ponderado)', k: (r) => r.ganhoPct.ponderado, cel: (r) => <Barra v={r.ganhoPct.ponderado} cor={C.ok} />, dir: true },
    { rot: '% simples', k: (r) => r.ganhoPct.simples, cel: (r) => <span style={{ color: C.m }}>{pct(r.ganhoPct.simples)}</span>, dir: true },
    { rot: 'Ganho', k: (r) => r.ganho, cel: (r) => <span style={{ color: C.ok }}>{brl2(r.ganho)}</span>, dir: true },
    { rot: 'Líquido', k: (r) => r.liquido, cel: (r) => <span style={{ color: corSinal(r.liquido) }}>{sinal(r.liquido, brl2)}</span>, dir: true },
    { rot: 'Faturamento', k: (r) => r.val, cel: (r) => brl0(r.val), dir: true },
    { rot: 'R$/kg', k: (r) => r.rpkg, cel: (r) => brl2(r.rpkg), dir: true },
  ]
  const colsDesc: Col<ClientePreco>[] = [
    ...colsCliBase,
    { rot: '% abaixo (ponderado)', k: (r) => r.descPct.ponderado, cel: (r) => <Barra v={r.descPct.ponderado} cor={C.bad} />, dir: true },
    { rot: '% simples', k: (r) => r.descPct.simples, cel: (r) => <span style={{ color: C.m }}>{pct(r.descPct.simples)}</span>, dir: true },
    { rot: 'Itens abaixo', k: (r) => r.itensAbaixoPct, cel: (r) => <span style={{ color: C.m }}>{pct(r.itensAbaixoPct)}</span>, dir: true },
    { rot: 'Desconto', k: (r) => r.desc, cel: (r) => <span style={{ color: C.bad }}>{brl2(r.desc)}</span>, dir: true },
    { rot: 'Faturamento', k: (r) => r.val, cel: (r) => brl0(r.val), dir: true },
    { rot: 'R$/kg', k: (r) => r.rpkg, cel: (r) => brl2(r.rpkg), dir: true },
  ]

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0 }}>
        O preço por vendedor é medido pelo <b>índice vs a média da empresa</b> (100 = média): acima é acréscimo (conta a favor), abaixo é desconto real — veja abaixo. A comparação com a <b>tabela de referência do sistema de origem</b> é secundária e pode estar desatualizada: ganhos de <b style={{ color: C.ok }}>{brl0(t.ganho)}</b>, descontos de <b style={{ color: C.bad }}>{brl0(t.desc)}</b> ({pct(t.descPct.ponderado)} sobre a tabela, em {pct(t.itensAbaixoPct)} dos itens).
      </p>

      {/* KPIs: ganho, desconto e o líquido (saldo real do preço vs a tabela) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Kpi rot="Ganho na tabela" chave="com.painel.ganho_tabela" valor={sinal(t.ganho, brl0)} cor={C.ok}
          linha={<>{leituras(t.ganhoPct)} · {pct(t.itensAcimaPct)} dos itens</>} />
        <Kpi rot="Desconto na tabela" chave="com.painel.desconto_total" valor={sinal(-t.desc, brl0)} cor={C.bad}
          linha={<>{leituras(t.descPct)} · {pct(t.itensAbaixoPct)} dos itens</>} />
        <Kpi rot="Líquido (ganhos − descontos)" chave="com.painel.liquido_tabela" valor={sinal(t.liquido, brl0)} cor={corSinal(t.liquido)}
          linha={<>{sinal(t.liquidoPct, pct)} sobre o faturamento na tabela ({brl0(t.tab)})</>} />
      </div>

      {/* Média simples × ponderado lado a lado */}
      <div style={card}>
        <div style={titulo}>Média simples × ponderado<AjudaCampo chave="com.painel.ponderado" rota={ROTA} /></div>
        <div style={sub}>A média simples dá o mesmo peso a cada item (uma nota pequena pesa igual a uma venda grande). O ponderado pesa pelo que cada venda vale: por faturamento na tabela (Σ R$ ÷ Σ tabela) ou por volume (kg). Para decidir, use o ponderado.</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
            <thead>
              <tr style={{ color: C.m, textAlign: 'left' }}>
                <th style={td}>Indicador</th><th style={tdR}>Média simples</th><th style={tdR}>Ponderado por faturamento</th><th style={tdR}>Ponderado por volume (kg)</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderTop: `1px solid ${C.bd}` }}>
                <td style={td}>Desconto sobre a tabela</td><td style={tdR}>{pct(t.descPct.simples)}</td><td style={{ ...tdR, fontWeight: 700, color: C.bad }}>{pct(t.descPct.ponderado)}</td><td style={tdR}>{pct(t.descPct.volume)}</td>
              </tr>
              <tr style={{ borderTop: `1px solid ${C.bd}` }}>
                <td style={td}>Acréscimo sobre a tabela</td><td style={tdR}>{pct(t.ganhoPct.simples)}</td><td style={{ ...tdR, fontWeight: 700, color: C.ok }}>{pct(t.ganhoPct.ponderado)}</td><td style={tdR}>{pct(t.ganhoPct.volume)}</td>
              </tr>
              <tr style={{ borderTop: `1px solid ${C.bd}` }}>
                <td style={{ ...td, display: 'flex', alignItems: 'center', gap: 4 }}>Índice médio dos vendedores<AjudaCampo chave="com.painel.indice_media" rota={ROTA} /></td>
                <td style={tdR}>{idx1(preco.mediaIdx)}</td><td style={{ ...tdR, fontWeight: 700 }}>{idx1(preco.mediaIdxPonderada)}</td><td style={{ ...tdR, color: C.d }}>já pesa por kg</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Faixas: clique para ver quem está em cada uma (inclusive o lado acima da tabela) */}
      <div style={card}>
        <div style={titulo}>Onde o preço cai<AjudaCampo chave="com.painel.desconto" rota={ROTA} /></div>
        <div style={sub}>Toque numa faixa para ver os clientes e vendedores dela.<AjudaCampo chave="com.painel.faixa_detalhe" rota={ROTA} /></div>
        <div style={{ display: 'grid', gap: 6 }}>
          {preco.faixas.map((f) => {
            const verde = f.faixa === 'Acima da tabela' || f.faixa === 'Na tabela'
            const aberto = faixaAberta === f.faixa
            const pctFaixa = f.faixa === 'Acima da tabela' ? f.leitura.ganhoPct : f.leitura.descPct
            return (
              <div key={f.faixa}>
                <button type="button" aria-expanded={aberto} onClick={() => setFaixaAberta(aberto ? null : f.faixa)} disabled={!f.itens}
                  style={{ width: '100%', display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 8, alignItems: 'center', fontSize: 13, background: aberto ? C.off : 'none', border: 'none', borderRadius: 8, padding: '6px 4px', cursor: f.itens ? 'pointer' : 'default', textAlign: 'left', color: C.esp, minHeight: 36 }}>
                  <span>{aberto ? '▾' : '▸'} {f.faixa}</span>
                  <span style={{ height: 14, background: C.bg2, borderRadius: 4, overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: 14, width: `${(100 * f.val) / maxFaixa}%`, background: verde ? C.ok : C.gold }} />
                  </span>
                  <span style={{ color: C.m, textAlign: 'right' }}>
                    {brl0(f.val)} · {int(f.itens)} itens
                    {f.itens && f.faixa !== 'Na tabela' ? <> · {f.faixa === 'Acima da tabela' ? '+' : '−'}{pct(pctFaixa.ponderado)} pond. ({pct(pctFaixa.simples)} simples)</> : null}
                  </span>
                </button>
                {aberto && f.itens > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, padding: '8px 4px 4px 22px' }}>
                    {([['Clientes', f.clientes], ['Vendedores', f.vendedores]] as const).map(([rot, lista]) => (
                      <div key={rot}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.m, marginBottom: 4 }}>{rot} (maiores na faixa)</div>
                        {lista.map((d) => (
                          <div key={d.nome} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '3px 0', borderTop: `1px solid ${C.bg2}` }}>
                            <span>{d.nome}</span>
                            <span style={{ color: C.m, whiteSpace: 'nowrap' }}>{brl0(d.val)} · <b style={{ color: corSinal(d.diff) }}>{sinal(d.diff, brl0)}</b></span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div style={{ fontSize: 12, color: C.m, marginTop: 8 }}>Faixas somam o faturamento total; itens em verde estão na tabela ou acima dela. Ao lado de cada nome, o saldo contra a tabela (+ ganho, − desconto). Comparação com a tabela de referência do sistema de origem — pode estar desatualizada; o indicador principal de preço é o índice vs a média da empresa (abaixo).</div>
      </div>

      {/* Quem vende mais caro e mais barato: barras divergentes em relação à média */}
      <div style={card}>
        <div style={titulo}>Quem vende mais caro e mais barato<AjudaCampo chave="com.painel.indice" rota={ROTA} /></div>
        <div style={sub}>Índice de preço por vendedor, em relação à média (100 = média da empresa; média ponderada: {idx1(preco.mediaIdxPonderada)} · simples: {idx1(preco.mediaIdx)}). Acima de 100 = acréscimo (vende acima da média, conta a favor, verde); abaixo = desconto real (vermelho).</div>
        {graficoOk ? (
          <div style={{ width: '100%', height: Math.max(180, preco.vendedores.length * 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={preco.vendedores.map((v) => ({ nome: v.nome, desvio: v.desvio ?? 0, idx: v.idx, idxS: v.idxSimples }))} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={C.bd} />
                <XAxis type="number" domain={[-limEixo, limEixo]} allowDecimals={false} tickFormatter={(v: number) => idx1(100 + v)} tick={{ fontSize: 11, fill: C.m }} />
                <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 12, fill: C.esp }} />
                <ReferenceLine x={0} stroke={C.m} />
                <Tooltip allowEscapeViewBox={{ x: false, y: false }} labelFormatter={(l) => String(l)} formatter={(_v, _n, p) => {
                  const d = (p as { payload?: { idx: number | null; idxS: number | null } } | undefined)?.payload
                  return [`índice ${idx1(d?.idx)} (simples ${idx1(d?.idxS)})`, 'Vendedor']
                }} />
                <Bar dataKey="desvio" radius={[0, 4, 4, 0]}>
                  {preco.vendedores.map((v, i) => <Cell key={i} fill={(v.desvio ?? 0) >= 0 ? C.ok : C.bad} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ background: C.off, borderRadius: 10, padding: 14, fontSize: 13, lineHeight: 1.5 }}>
            {unico ? (
              <>
                <div style={{ fontSize: 13, color: C.m }}>{unico.nome}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: C.esp }}>índice {idx1(unico.idx)}</div>
                <div style={{ color: C.m }}>Só há um vendedor neste recorte: ele é a própria média (100), então não há quem comparar. Marque mais vendedores no filtro de equipe para ver quem vende mais caro e mais barato.</div>
              </>
            ) : (
              <div style={{ color: C.m }}>Sem vendedor com preço comparável neste recorte (é preciso venda com kg nos produtos da análise). Amplie o período ou a equipe no filtro.</div>
            )}
          </div>
        )}
      </div>

      {/* Ganho, desconto e líquido por vendedor */}
      <div style={card}>
        <div style={titulo}>Ganho e desconto por vendedor ({int(preco.vendedores.length)})<AjudaCampo chave="com.painel.preco_vendedor" rota={ROTA} /></div>
        <div style={sub}>Índice = ponderado por kg (indicador principal); índice simples = média do preço de cada item, toda nota com o mesmo peso. Ganho, desconto e % são contra a tabela de referência (secundária — pode estar desatualizada); % ponderado por faturamento na tabela.</div>
        <TabelaOrdenavel linhas={preco.vendedores} cols={colsVen} chave={(r) => r.vi} ordInicial={7} minW={900} />
      </div>

      {/* Ganho por cliente: espelho do desconto */}
      <div style={card}>
        <div style={titulo}>Ganho por cliente ({int(clientesGanho.length)})<AjudaCampo chave="com.painel.ganho_cliente" rota={ROTA} /></div>
        <div style={sub}>Onde o preço ficou acima da tabela. Vendedor = quem mais vendeu para o cliente no período. % acima ponderado = ganho ÷ faturamento na tabela do cliente; % simples = média do % de cada item.</div>
        {clientesGanho.length
          ? <TabelaOrdenavel linhas={clientesGanho} cols={colsGanho} chave={(r) => r.ci} ordInicial={5} minW={900} />
          : <div style={{ fontSize: 13, color: C.m }}>Nenhum cliente comprou acima da tabela neste recorte.</div>}
      </div>

      {/* Desconto por cliente: TODOS os clientes, ordenável */}
      <div style={card}>
        <div style={titulo}>Desconto por cliente ({int(preco.clientes.length)})<AjudaCampo chave="com.painel.desconto_cliente" rota={ROTA} /></div>
        <div style={sub}>Onde está o dinheiro que ficou na mesa. Vendedor = quem mais vendeu para o cliente no período. % abaixo ponderado = desconto ÷ faturamento na tabela; itens abaixo = parte dos itens vendidos abaixo da tabela. Desconto medido sobre a tabela de referência do sistema de origem (secundária — pode estar desatualizada).</div>
        <TabelaOrdenavel linhas={preco.clientes} cols={colsDesc} chave={(r) => r.ci} ordInicial={6} minW={960} />
      </div>
    </div>
  )
}

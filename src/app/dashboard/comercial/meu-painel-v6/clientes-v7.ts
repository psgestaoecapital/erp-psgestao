// Cálculos da aba Clientes do painel v7 (SPEC §2.3). Funções puras sobre o motor v5 (mesma base da
// fn_bi_comercial_base, fonte bi_comercial_venda_item_mv). Nada de rede, nada de DOM.
//
// REGRAS (documentadas; ajustáveis por decisão do CEO, sem mudar o motor):
//  - recência  = dias entre a última compra do cliente e o fim do período;
//  - frequência = dias distintos com compra no período;
//  - segmentos RFM (ordem de avaliação, o primeiro que casar vence):
//      Sumindo:            recência > 30 e frequência ≥ 3
//      Em risco:           recência 16–30 e frequência ≥ 3
//      Campeões:           recência ≤ 7 e frequência ≥ 6 e faturamento no topo 20% dos clientes
//      Fiéis:              frequência ≥ 4 e recência ≤ 15
//      Novos recapturáveis: frequência ≤ 2 e recência ≤ 30
//      Ocasionais:         o restante
//  - desconto = (tabela − praticado) ÷ tabela, só nos itens abaixo da tabela em mais de R$ 0,05.
import type { BaseV5, EstadoV5, GrupoProduto, ModeloV5 } from '../meu-painel/motor-v5'

export type Segmento = 'Campeões' | 'Fiéis' | 'Novos recapturáveis' | 'Ocasionais' | 'Em risco' | 'Sumindo'
export const SEGMENTOS: Segmento[] = ['Campeões', 'Fiéis', 'Novos recapturáveis', 'Ocasionais', 'Em risco', 'Sumindo']
export const ACAO_SEGMENTO: Record<Segmento, string> = {
  'Campeões': 'Manter o relacionamento; oferecer lançamentos',
  'Fiéis': 'Ligar para reforçar o pedido recorrente',
  'Novos recapturáveis': 'Oferecer a próxima compra com condição especial',
  'Ocasionais': 'Entrar em contato para ampliar a frequência',
  'Em risco': 'Ligar hoje: a compra está ficando para trás',
  'Sumindo': 'Ligar hoje: cliente sem comprar há mais de 30 dias',
}

export type LinhaCliente = {
  ci: number; nome: string; cidade: string; grupo: number
  val: number; part: number; kg: number; kgP: number; valP: number; rpkg: number | null
  tab: number; desc: number; descPct: number; devolucao: number
  notas: number; frequencia: number; recencia: number; ultimoDia: number
  linhas: number; curva: 'A' | 'B' | 'C'; segmento: Segmento
}

export type ClientesV7 = {
  linhas: LinhaCliente[]
  segmentos: { seg: Segmento; clientes: number; val: number; rpkg: number | null }[]
  crossSell: { linhas: number; clientes: number; val: number; media: number }[]
  notas: { faixa: string; notas: number; val: number }[]
  grupos: { grupo: number; nome: string; lojas: number; val: number; rpkg: number | null; devolucao: number }[]
  carteira: { faixa: string; clientes: number; val: number }[]
  diasPeriodo: number
}

const FAIXAS_RECENCIA: [string, (d: number) => boolean][] = [
  ['Até 7 dias', (d) => d <= 7], ['8 a 14 dias', (d) => d >= 8 && d <= 14],
  ['15 a 30 dias', (d) => d >= 15 && d <= 30], ['Mais de 30 dias', (d) => d > 30],
]
const FAIXAS_NOTA: [string, number, number][] = [
  ['Até R$ 1 mil', 0, 1000], ['R$ 1 mil a 2 mil', 1000, 2000], ['R$ 2 mil a 5 mil', 2000, 5000],
  ['R$ 5 mil a 10 mil', 5000, 10000], ['Acima de R$ 10 mil', 10000, Infinity],
]

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 86400000)

export function calcularClientesV7(base: BaseV5, modelo: ModeloV5, estado: EstadoV5, pg: GrupoProduto[]): ClientesV7 {
  const diasPeriodo = diasEntre(base.de, base.ate)
  const porCli = new Map<number, {
    val: number; kg: number; kgP: number; valP: number; tab: number; desc: number; dias: Set<number>
    ultimo: number; notas: Set<number>
  }>()
  // Itens válidos para o cliente: os do motor (já filtrados por período, vendedor e linha).
  modelo.its.forEach((x) => {
    const ci = x[3]
    let a = porCli.get(ci)
    if (!a) { a = { val: 0, kg: 0, kgP: 0, valP: 0, tab: 0, desc: 0, dias: new Set(), ultimo: -1, notas: new Set() }; porCli.set(ci, a) }
    a.val += x[6]; a.kg += x[5]; a.tab += x[7]
    if (x[7] > x[6] + 0.05) a.desc += x[7] - x[6]
    if (!estado.excl[x[4]]) { a.valP += x[6]; a.kgP += x[5] }
    a.dias.add(x[0]); if (x[0] > a.ultimo) a.ultimo = x[0]
    a.notas.add(x[1])
  })
  // Linhas de produto distintas por cliente (pelo nome da linha, não pelo índice).
  const linhasPorCli = new Map<number, Set<string>>()
  modelo.its.forEach((x) => {
    let s = linhasPorCli.get(x[3]); if (!s) { s = new Set(); linhasPorCli.set(x[3], s) }
    s.add(base.prod[x[4]]?.[1] ?? '')
  })
  const devPorCli = new Map<number, number>()
  modelo.devs.forEach((x) => { devPorCli.set(x[2] as number, (devPorCli.get(x[2] as number) || 0) + (x[4] as number)) })

  // Valor total por cliente para o topo 20% (Campeões).
  const valores = [...porCli.values()].map((a) => a.val).sort((a, b) => b - a)
  const limiteTop20 = valores.length ? valores[Math.max(0, Math.ceil(valores.length * 0.2) - 1)] : Infinity
  const totalVal = modelo.tot.val || 1

  // Curva ABC por cliente (A até 80% do faturamento, B até 95%, C o resto).
  const ordenados = [...porCli.entries()].sort((a, b) => b[1].val - a[1].val)
  let acc = 0
  const curva = new Map<number, 'A' | 'B' | 'C'>()
  ordenados.forEach(([ci, a]) => {
    const antes = acc / totalVal
    curva.set(ci, antes < 0.8 ? 'A' : antes < 0.95 ? 'B' : 'C')
    acc += a.val
  })

  const linhas: LinhaCliente[] = ordenados.map(([ci, a]) => {
    const frequencia = a.dias.size
    const recencia = diasPeriodo - a.ultimo
    let segmento: Segmento
    if (recencia > 30 && frequencia >= 3) segmento = 'Sumindo'
    else if (recencia >= 16 && recencia <= 30 && frequencia >= 3) segmento = 'Em risco'
    else if (recencia <= 7 && frequencia >= 6 && a.val >= limiteTop20) segmento = 'Campeões'
    else if (frequencia >= 4 && recencia <= 15) segmento = 'Fiéis'
    else if (frequencia <= 2 && recencia <= 30) segmento = 'Novos recapturáveis'
    else segmento = 'Ocasionais'
    const cidadeIdx = base.cli[ci]?.[1] ?? -1
    return {
      ci, nome: base.cli[ci]?.[0] ?? '—', cidade: cidadeIdx >= 0 ? base.cid[cidadeIdx] : '—',
      grupo: base.cli[ci]?.[2] ?? -1,
      val: a.val, part: 100 * a.val / totalVal, kg: a.kg, kgP: a.kgP, valP: a.valP,
      rpkg: a.kgP ? a.valP / a.kgP : null,
      tab: a.tab, desc: a.desc, descPct: a.tab ? 100 * a.desc / a.tab : 0,
      devolucao: devPorCli.get(ci) || 0,
      notas: a.notas.size, frequencia, recencia, ultimoDia: a.ultimo,
      linhas: linhasPorCli.get(ci)?.size ?? 0,
      curva: curva.get(ci) ?? 'C', segmento,
    }
  })

  const segmentos = SEGMENTOS.map((seg) => {
    const ls = linhas.filter((l) => l.segmento === seg)
    const val = ls.reduce((s, l) => s + l.val, 0)
    const kgP = ls.reduce((s, l) => s + l.kgP, 0)
    const valP = ls.reduce((s, l) => s + l.valP, 0)
    return { seg, clientes: ls.length, val, rpkg: kgP ? valP / kgP : null }
  })

  // Cross-sell: faturamento médio por cliente, conforme o número de linhas de produto compradas.
  const maxL = Math.max(0, ...linhas.map((l) => l.linhas))
  const crossSell: ClientesV7['crossSell'] = []
  for (let n = 1; n <= maxL; n++) {
    const ls = linhas.filter((l) => l.linhas === n)
    if (!ls.length) continue
    const val = ls.reduce((s, l) => s + l.val, 0)
    crossSell.push({ linhas: n, clientes: ls.length, val, media: val / ls.length })
  }

  // Tamanho das notas: uma nota = soma dos itens de mesmo número.
  const valPorNota = new Map<number, number>()
  modelo.its.forEach((x) => valPorNota.set(x[1], (valPorNota.get(x[1]) || 0) + x[6]))
  const notas = FAIXAS_NOTA.map(([faixa, min, max]) => {
    let n = 0; let val = 0
    valPorNota.forEach((v) => { if (v >= min && v < max) { n++; val += v } })
    return { faixa, notas: n, val }
  })

  // Grupos econômicos (CPF raiz). Clientes sem grupo ficam de fora desta tabela.
  const porGrupo = new Map<number, LinhaCliente[]>()
  linhas.forEach((l) => { if (l.grupo >= 0) { let g = porGrupo.get(l.grupo); if (!g) { g = []; porGrupo.set(l.grupo, g) } g.push(l) } })
  const grupos = [...porGrupo].map(([g, ls]) => {
    const val = ls.reduce((s, l) => s + l.val, 0)
    const kgP = ls.reduce((s, l) => s + l.kgP, 0)
    const valP = ls.reduce((s, l) => s + l.valP, 0)
    return { grupo: g, nome: base.grp[g] ?? '—', lojas: ls.length, val, rpkg: kgP ? valP / kgP : null, devolucao: ls.reduce((s, l) => s + l.devolucao, 0) }
  }).sort((a, b) => b.val - a.val)

  // Saúde da carteira: clientes e faturamento por faixa de recência.
  const carteira = FAIXAS_RECENCIA.map(([faixa, f]) => {
    const ls = linhas.filter((l) => f(l.recencia))
    return { faixa, clientes: ls.length, val: ls.reduce((s, l) => s + l.val, 0) }
  })

  return { linhas, segmentos, crossSell, notas, grupos, carteira, diasPeriodo }
}

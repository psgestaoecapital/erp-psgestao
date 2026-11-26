// Cálculos da aba Preço e desconto do painel v7 (SPEC §2.6). Funções puras sobre o motor v5 (fonte bi_comercial_venda_item_mv).
// Critério de "abaixo/acima da tabela": diferença maior que R$ 0,05 (centavo de arredondamento não conta).
// Faixas por item: Acima da tabela (praticado > tabela); Na tabela (diferença de até R$ 0,05);
// depois as faixas de desconto percentual sobre a tabela: 0,01–2%, 2–5%, 5–10%, mais de 10%.
//
// GANHOS NA TABELA + PONDERADO (spec do CEO 26/11): espelho do desconto.
//  · por item: desconto = tabela − praticado (quando abaixo); ganho = praticado − tabela (quando acima); senão 0.
//    No item da base, "praticado" = valor do item e "tabela" = preço de tabela × quantidade (vem do tradutor por ramo).
//  · líquido = Σ ganhos − Σ descontos: o saldo real do preço contra a tabela (positivo = vendeu acima no conjunto).
//  · % PONDERADO por faturamento = Σ R$ ÷ Σ faturamento na tabela (uma nota pequena pesa o que vale).
//    % PONDERADO por volume = Σ(% do item × kg) ÷ Σ kg.
//    % SIMPLES = média aritmética do % de cada item (toda nota pesa igual) — mostrado ao lado só para comparar.
//  · índice vs a média da empresa: por vendedor = Σ praticado ÷ Σ esperado ao preço médio do produto (já é
//    ponderado por kg); a MÉDIA da empresa passa a ser ponderada (Σ praticado ÷ Σ esperado de todos), com a média
//    simples dos índices ao lado. O índice continua o indicador primário; a tabela pode estar desatualizada.
import { venAnalise, type BaseV5, type EstadoV5, type ModeloV5 } from './motor-v5'

export const FAIXAS_PRECO = ['Acima da tabela', 'Na tabela', '0,01–2%', '2–5%', '5–10%', 'Mais de 10%'] as const
export type FaixaPreco = typeof FAIXAS_PRECO[number]

/** Percentuais de um recorte nas três leituras: simples (cada item pesa igual), ponderado por faturamento e por volume. */
export type PctLeituras = { simples: number; ponderado: number; volume: number | null }

/** Acumulador de preço vs tabela de um recorte (cliente, vendedor, faixa ou total). */
type Acc = {
  val: number; tab: number; kg: number; itens: number
  desc: number; ganho: number; nAbaixo: number; nAcima: number
  // somas para as leituras simples (Σ % por item) e por volume (Σ % × kg, Σ kg)
  sPctDesc: number; sPctGanho: number; kPctDesc: number; kPctGanho: number; kgPct: number
}
const novoAcc = (): Acc => ({ val: 0, tab: 0, kg: 0, itens: 0, desc: 0, ganho: 0, nAbaixo: 0, nAcima: 0, sPctDesc: 0, sPctGanho: 0, kPctDesc: 0, kPctGanho: 0, kgPct: 0 })

/** Leitura de preço vs tabela pronta para a tela (total, cliente, vendedor, faixa). */
export type LeituraTabela = {
  val: number; tab: number; itens: number
  desc: number; ganho: number; liquido: number
  itensAbaixoPct: number; itensAcimaPct: number
  descPct: PctLeituras; ganhoPct: PctLeituras
  /** líquido ÷ faturamento na tabela (positivo = acima da tabela no conjunto). */
  liquidoPct: number
}

function leitura(a: Acc): LeituraTabela {
  const p = (soma: number, sPct: number, kPct: number): PctLeituras => ({
    simples: a.itens ? sPct / a.itens : 0,
    ponderado: a.tab > 0 ? 100 * soma / a.tab : 0,
    volume: a.kgPct > 0 ? kPct / a.kgPct : null,
  })
  return {
    val: a.val, tab: a.tab, itens: a.itens,
    desc: a.desc, ganho: a.ganho, liquido: a.ganho - a.desc,
    itensAbaixoPct: a.itens ? 100 * a.nAbaixo / a.itens : 0,
    itensAcimaPct: a.itens ? 100 * a.nAcima / a.itens : 0,
    descPct: p(a.desc, a.sPctDesc, a.kPctDesc),
    ganhoPct: p(a.ganho, a.sPctGanho, a.kPctGanho),
    liquidoPct: a.tab > 0 ? 100 * (a.ganho - a.desc) / a.tab : 0,
  }
}

export type ClientePreco = LeituraTabela & { ci: number; nome: string; cidade: string; vendedor: string; rpkg: number | null }
export type VendedorPreco = LeituraTabela & { vi: number; nome: string; idx: number | null; idxSimples: number | null; desvio: number | null }
export type DetalheFaixa = { nome: string; val: number; itens: number; diff: number }

export type PrecoV7 = {
  faixas: { faixa: FaixaPreco; itens: number; val: number; leitura: LeituraTabela; clientes: DetalheFaixa[]; vendedores: DetalheFaixa[] }[]
  totalVal: number; totalItens: number
  /** Compatibilidade: desconto total, % ponderado por faturamento na tabela e % dos itens abaixo. */
  descR: number; descPct: number; itensAbaixoPct: number
  /** Leitura completa do total (ganho, desconto, líquido, simples × ponderado). */
  total: LeituraTabela
  vendedores: VendedorPreco[]
  clientes: ClientePreco[]
  /** Média dos índices: simples (cada vendedor pesa igual) e ponderada (Σ praticado ÷ Σ esperado). */
  mediaIdx: number | null
  mediaIdxPonderada: number | null
  /** Vendedores com índice calculável na comparação. Com menos de 2 o gráfico de desvio não tem o que comparar. */
  nVendedoresIdx: number
}

/** Quantos detalhes por faixa a tela mostra (os maiores por faturamento). */
export const TOP_DETALHE_FAIXA = 8

export function calcularPrecoV7(base: BaseV5, modelo: ModeloV5, estado: EstadoV5): PrecoV7 {
  const faixasAcc = FAIXAS_PRECO.map(() => novoAcc())
  const faixaCli = FAIXAS_PRECO.map(() => new Map<number, DetalheFaixa>())
  const faixaVen = FAIXAS_PRECO.map(() => new Map<number, DetalheFaixa>())
  const tot = novoAcc()
  const porCli = new Map<number, { acc: Acc; kgP: number; valP: number; venVal: Map<number, number> }>()
  const porVen = new Map<number, { acc: Acc; sIdx: number; nIdx: number }>()
  const nomeVen = (vi: number) => base.ven[vi]?.[1] || base.ven[vi]?.[0] || 'Sem vendedor'

  modelo.its.forEach((x) => {
    const tab = x[7]; const val = x[6]; const kg = x[5]
    // Comparação em centavos inteiros: evita que 0,05 exato caia do lado errado por ponto flutuante.
    const centavos = Math.round((val - tab) * 100)
    const tabC = Math.round(tab * 100)
    let f: FaixaPreco
    if (centavos > 5) f = 'Acima da tabela'
    else if (centavos >= -5) f = 'Na tabela'
    else {
      // Percentual em centavos inteiros: (tabela − praticado) × 100 ÷ tabela, sem erro de ponto flutuante.
      const dC = -centavos
      const ok = (lim: number) => tabC > 0 && dC * 100 <= lim * tabC
      f = ok(2) ? '0,01–2%' : ok(5) ? '2–5%' : ok(10) ? '5–10%' : 'Mais de 10%'
    }
    const abaixo = centavos < -5
    const acima = centavos > 5
    const desc = abaixo ? tab - val : 0
    const ganho = acima ? val - tab : 0
    const pctDesc = abaixo && tab > 0 ? 100 * desc / tab : 0
    const pctGanho = acima && tab > 0 ? 100 * ganho / tab : 0
    const soma = (a: Acc) => {
      a.val += val; a.tab += tab; a.kg += kg; a.itens++
      a.desc += desc; a.ganho += ganho
      if (abaixo) a.nAbaixo++
      if (acima) a.nAcima++
      a.sPctDesc += pctDesc; a.sPctGanho += pctGanho
      if (kg > 0) { a.kPctDesc += pctDesc * kg; a.kPctGanho += pctGanho * kg; a.kgPct += kg }
    }
    const fi = FAIXAS_PRECO.indexOf(f)
    soma(tot); soma(faixasAcc[fi])
    // detalhe da faixa por cliente e por vendedor
    const det = (m: Map<number, DetalheFaixa>, k: number, nome: string) => {
      let d = m.get(k)
      if (!d) { d = { nome, val: 0, itens: 0, diff: 0 }; m.set(k, d) }
      d.val += val; d.itens++; d.diff += val - tab
    }
    det(faixaCli[fi], x[3], base.cli[x[3]]?.[0] ?? '—')
    det(faixaVen[fi], x[2], nomeVen(x[2]))
    // por cliente
    let c = porCli.get(x[3])
    if (!c) { c = { acc: novoAcc(), kgP: 0, valP: 0, venVal: new Map() }; porCli.set(x[3], c) }
    soma(c.acc)
    if (!estado.excl[x[4]]) { c.valP += val; c.kgP += kg }
    c.venVal.set(x[2], (c.venVal.get(x[2]) || 0) + val)
    // por vendedor (+ índice SIMPLES: média do preço do item ÷ preço médio do produto, cada item pesa igual)
    let v = porVen.get(x[2])
    if (!v) { v = { acc: novoAcc(), sIdx: 0, nIdx: 0 }; porVen.set(x[2], v) }
    soma(v.acc)
    const pp = modelo.pPrice.get(x[4])
    if (modelo.inc(x[4]) && kg > 0 && pp && pp > 0) { v.sIdx += 100 * (val / kg) / pp; v.nIdx++ }
  })

  // Índice de preço por vendedor (100 = média), desvio = índice − 100. Só quem entra na comparação (venAnalise).
  let somaValP = 0; let somaExp = 0
  const vendedores: VendedorPreco[] = [...modelo.venM].filter(([vi]) => venAnalise(base, vi)).map(([vi, a]) => {
    const idx = a.exp > 0 ? 100 * a.valP / a.exp : null
    if (a.exp > 0) { somaValP += a.valP; somaExp += a.exp }
    const pv = porVen.get(vi)
    // desvio arredondado a 0,01 ponto: com um vendedor só o índice é 100 e o resto de ponto flutuante (~1e-14)
    // virava a escala do eixo do gráfico.
    const desvio = idx == null ? null : Math.round((idx - 100) * 100) / 100
    return {
      ...leitura(pv?.acc ?? novoAcc()),
      vi, nome: nomeVen(vi), idx, desvio,
      idxSimples: pv && pv.nIdx ? pv.sIdx / pv.nIdx : null,
    }
  }).sort((a, b) => (b.idx ?? -1) - (a.idx ?? -1))
  const comIdx = vendedores.filter((v) => v.idx != null)
  const mediaIdx = comIdx.length ? comIdx.reduce((s, v) => s + (v.idx as number), 0) / comIdx.length : null
  const mediaIdxPonderada = somaExp > 0 ? 100 * somaValP / somaExp : null

  const clientes: ClientePreco[] = [...porCli].map(([ci, c]) => {
    const vi = [...c.venVal].sort((a, b) => b[1] - a[1])[0]?.[0]
    const cidx = base.cli[ci]?.[1] ?? -1
    return {
      ...leitura(c.acc),
      ci, nome: base.cli[ci]?.[0] ?? '—', cidade: cidx >= 0 ? base.cid[cidx] : '—',
      vendedor: vi !== undefined ? nomeVen(vi) : '—',
      rpkg: c.kgP ? c.valP / c.kgP : null,
    }
  }).sort((a, b) => b.desc - a.desc)

  const topo = (m: Map<number, DetalheFaixa>) => [...m.values()].sort((a, b) => b.val - a.val).slice(0, TOP_DETALHE_FAIXA)
  const faixas = FAIXAS_PRECO.map((f, i) => ({
    faixa: f, itens: faixasAcc[i].itens, val: faixasAcc[i].val, leitura: leitura(faixasAcc[i]),
    clientes: topo(faixaCli[i]), vendedores: topo(faixaVen[i]),
  }))
  const total = leitura(tot)
  return {
    faixas, totalVal: modelo.tot.val || 1, totalItens: modelo.its.length,
    descR: total.desc, descPct: total.descPct.ponderado, itensAbaixoPct: total.itensAbaixoPct,
    total, vendedores, clientes, mediaIdx, mediaIdxPonderada, nVendedoresIdx: comIdx.length,
  }
}

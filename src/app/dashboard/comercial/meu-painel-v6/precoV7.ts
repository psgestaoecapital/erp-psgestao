// Cálculos da aba Preço e desconto do painel v7 (SPEC §2.6). Funções puras sobre o motor v5 (fonte bi_comercial_venda_item_mv).
// Critério de "abaixo da tabela": diferença maior que R$ 0,05 (centavo de arredondamento não conta).
// Faixas por item: Acima da tabela (praticado > tabela); Na tabela (diferença de até R$ 0,05);
// depois as faixas de desconto percentual sobre a tabela: 0,01–2%, 2–5%, 5–10%, mais de 10%.
import type { BaseV5, EstadoV5, ModeloV5 } from '../meu-painel/motor-v5'

export const FAIXAS_PRECO = ['Acima da tabela', 'Na tabela', '0,01–2%', '2–5%', '5–10%', 'Mais de 10%'] as const
export type FaixaPreco = typeof FAIXAS_PRECO[number]

export type PrecoV7 = {
  faixas: { faixa: FaixaPreco; itens: number; val: number }[]
  totalVal: number; totalItens: number
  descR: number; descPct: number; itensAbaixoPct: number
  vendedores: { nome: string; idx: number | null; desvio: number | null }[]
  clientes: { ci: number; nome: string; cidade: string; vendedor: string; abaixoPct: number; desc: number; val: number; rpkg: number | null }[]
  mediaIdx: number | null
}

export function calcularPrecoV7(base: BaseV5, modelo: ModeloV5, estado: EstadoV5): PrecoV7 {
  const faixas = FAIXAS_PRECO.map((f) => ({ faixa: f, itens: 0, val: 0 }))
  const idxFaixa = (f: FaixaPreco) => FAIXAS_PRECO.indexOf(f)
  let descR = 0; let tabTot = 0; let abaixo = 0
  const porCli = new Map<number, { val: number; kgP: number; valP: number; tab: number; desc: number; abaixo: number; itens: number; venVal: Map<number, number> }>()
  modelo.its.forEach((x) => {
    const tab = x[7]; const val = x[6]; const diff = tab - val
    // Comparação em centavos inteiros: evita que 0,05 exato caia do lado errado por ponto flutuante.
    const centavos = Math.round((val - tab) * 100)
    let f: FaixaPreco
    if (centavos > 5) f = 'Acima da tabela'
    else if (centavos >= -5) f = 'Na tabela'
    else {
      // Percentual em centavos inteiros: (tabela − praticado) × 100 ÷ tabela, sem erro de ponto flutuante.
      const tabC = Math.round(tab * 100); const dC = tabC - Math.round(val * 100)
      const ok = (lim: number) => tabC > 0 && dC * 100 <= lim * tabC
      f = ok(2) ? '0,01–2%' : ok(5) ? '2–5%' : ok(10) ? '5–10%' : 'Mais de 10%'
    }
    faixas[idxFaixa(f)].itens++; faixas[idxFaixa(f)].val += val
    tabTot += tab
    if (Math.round((tab - val) * 100) > 5) { descR += diff; abaixo++ }
    // por cliente
    let c = porCli.get(x[3])
    if (!c) { c = { val: 0, kgP: 0, valP: 0, tab: 0, desc: 0, abaixo: 0, itens: 0, venVal: new Map() }; porCli.set(x[3], c) }
    c.val += val; c.tab += tab; c.itens++
    if (!estado.excl[x[4]]) { c.valP += val; c.kgP += x[5] }
    if (Math.round((tab - val) * 100) > 5) { c.desc += diff; c.abaixo++ }
    c.venVal.set(x[2], (c.venVal.get(x[2]) || 0) + val)
  })
  const totalVal = modelo.tot.val || 1
  // Índice de preço por vendedor (100 = média), desvio = índice − 100.
  const vendedores = [...modelo.venM].map(([vi, a]) => {
    const idx = a.exp > 0 ? 100 * a.valP / a.exp : null
    return { nome: base.ven[vi]?.[1] || base.ven[vi]?.[0] || 'Sem vendedor', idx, desvio: idx == null ? null : idx - 100 }
  }).sort((a, b) => (b.idx ?? -1) - (a.idx ?? -1))
  const mediaIdx = vendedores.length && vendedores.some((v) => v.idx != null)
    ? vendedores.reduce((s, v) => s + (v.idx ?? 0), 0) / vendedores.filter((v) => v.idx != null).length
    : null
  const clientes = [...porCli].map(([ci, c]) => {
    const vi = [...c.venVal].sort((a, b) => b[1] - a[1])[0]?.[0]
    const cidx = base.cli[ci]?.[1] ?? -1
    return {
      ci, nome: base.cli[ci]?.[0] ?? '—', cidade: cidx >= 0 ? base.cid[cidx] : '—',
      vendedor: vi !== undefined ? (base.ven[vi]?.[1] || base.ven[vi]?.[0] || '—') : '—',
      abaixoPct: c.itens ? 100 * c.abaixo / c.itens : 0,
      desc: c.desc, val: c.val, rpkg: c.kgP ? c.valP / c.kgP : null,
    }
  }).sort((a, b) => b.desc - a.desc)
  return {
    faixas, totalVal, totalItens: modelo.its.length,
    descR, descPct: tabTot ? 100 * descR / tabTot : 0,
    itensAbaixoPct: modelo.its.length ? 100 * abaixo / modelo.its.length : 0,
    vendedores, clientes, mediaIdx,
  }
}

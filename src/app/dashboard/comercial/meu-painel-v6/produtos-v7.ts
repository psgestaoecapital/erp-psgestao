// Cálculos da aba Produtos do painel v7 (SPEC §2.5). Funções puras sobre o motor v5 (fonte bi_comercial_venda_item_mv).
// Índice de preço do produto = R$/kg do produto ÷ R$/kg médio da análise × 100 (100 = na média da empresa).
// Só produtos dentro da análise têm índice; produto fora da análise mostra "—" (decisão CEO 10/11).
// % itens abaixo da tabela usa o mesmo critério da visão geral: diferença maior que R$ 0,05.
import type { BaseV5, EstadoV5, GrupoProduto, ModeloV5 } from '../meu-painel/motor-v5'

export type ProdutoV7 = {
  pi: number; nome: string; linha: string; grupo: number; dentro: boolean
  val: number; part: number; kg: number; rpkg: number | null; indice: number | null
  desc: number; pctAbaixo: number; clientes: number; itens: number
}

export type ProdutosV7 = {
  linhas: ProdutoV7[]
  precoMedioAnalise: number | null
  maior: ProdutoV7 | null
  totalProdutos: number
}

export function calcularProdutosV7(base: BaseV5, modelo: ModeloV5, estado: EstadoV5, pg: GrupoProduto[]): ProdutosV7 {
  const totalVal = modelo.tot.val || 1
  // Estatísticas por produto a partir dos itens do motor (já filtrados por período, vendedor e linha).
  const porProd = new Map<number, { val: number; kg: number; tab: number; desc: number; abaixo: number; itens: number; clis: Set<number> }>()
  modelo.its.forEach((x) => {
    let a = porProd.get(x[4])
    if (!a) { a = { val: 0, kg: 0, tab: 0, desc: 0, abaixo: 0, itens: 0, clis: new Set() }; porProd.set(x[4], a) }
    a.val += x[6]; a.kg += x[5]; a.tab += x[7]; a.itens++; a.clis.add(x[3])
    if (x[7] > x[6] + 0.05) { a.desc += x[7] - x[6]; a.abaixo++ }
  })
  // R$/kg médio da análise = Σ valor / Σ kg dos produtos dentro da análise (mesma conta do preço médio do painel).
  let valAn = 0; let kgAn = 0
  porProd.forEach((a, pi) => { if (!estado.excl[pi]) { valAn += a.val; kgAn += a.kg } })
  const precoMedioAnalise = kgAn > 0 ? valAn / kgAn : null

  const linhas: ProdutoV7[] = [...porProd].map(([pi, a]) => {
    const dentro = !estado.excl[pi]
    // R$/kg só para produto dentro da análise (decisão do CEO 10/11): fora da análise não há preço por kg.
    const rpkg = dentro && a.kg > 0 ? a.val / a.kg : null
    return {
      pi, nome: base.prod[pi]?.[0] ?? String(pi), linha: base.prod[pi]?.[1] ?? '—', grupo: pg[pi],
      dentro, val: a.val, part: 100 * a.val / totalVal, kg: a.kg, rpkg,
      indice: dentro && rpkg != null && precoMedioAnalise ? 100 * rpkg / precoMedioAnalise : null,
      desc: a.tab > 0 && a.desc > 0 ? 100 * a.desc / a.tab : 0,
      pctAbaixo: a.itens ? 100 * a.abaixo / a.itens : 0,
      clientes: a.clis.size, itens: a.itens,
    }
  }).sort((x, y) => y.val - x.val)

  return { linhas, precoMedioAnalise, maior: linhas[0] ?? null, totalProdutos: linhas.length }
}

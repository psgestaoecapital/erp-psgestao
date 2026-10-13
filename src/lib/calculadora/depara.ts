// Calculadora de Obra (HB2 fatia 3): de-para material × produto do estoque e custo real. Sem rede: recebe os dados prontos.
import type { ItemCalculo } from './motor'

export type ProdutoEstoque = { id: string; nome: string; unidade: string | null; custo: number | null }
export type LinhaCusto = { item: ItemCalculo; produto: ProdutoEstoque | null; custoUnitario: number | null; total: number | null; aviso: string | null }

export function custearItens(itens: ItemCalculo[], vinculos: Record<string, string>, produtos: Map<string, ProdutoEstoque>) {
  const linhas: LinhaCusto[] = itens.map(item => {
    const pid = vinculos[item.chave]
    if (!pid) return { item, produto: null, custoUnitario: null, total: null, aviso: 'Sem produto do estoque vinculado' }
    const produto = produtos.get(pid) ?? null
    if (!produto) return { item, produto: null, custoUnitario: null, total: null, aviso: 'Produto vinculado não está mais no estoque' }
    if (!(produto.custo && produto.custo > 0)) return { item, produto, custoUnitario: null, total: null, aviso: 'Produto sem custo cadastrado' }
    return { item, produto, custoUnitario: produto.custo, total: Math.round(item.quantidade * produto.custo * 100) / 100, aviso: null }
  })
  const total = Math.round(linhas.reduce((s, l) => s + (l.total ?? 0), 0) * 100) / 100
  return { linhas, total, semCusto: linhas.filter(l => l.total === null).length }
}

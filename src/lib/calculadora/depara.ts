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

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const palavras = (s: string) => semAcento(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3)

// Sugere (nunca aplica) o produto do estoque cujo nome mais se parece com a descrição do material.
// Só considera produto com custo > 0; empate ou nenhuma palavra em comum = sem sugestão.
export function sugerirProduto(item: ItemCalculo, produtos: ProdutoEstoque[]): ProdutoEstoque | null {
  const alvo = new Set(palavras(item.descricao))
  if (alvo.size === 0) return null
  let melhor: ProdutoEstoque | null = null
  let melhorPontos = 0
  let empate = false
  for (const p of produtos) {
    if (!(p.custo && p.custo > 0)) continue
    const pontos = palavras(p.nome).filter(w => alvo.has(w)).length
    if (pontos === 0) continue
    if (pontos > melhorPontos) { melhor = p; melhorPontos = pontos; empate = false }
    else if (pontos === melhorPontos) empate = true
  }
  return empate ? null : melhor
}

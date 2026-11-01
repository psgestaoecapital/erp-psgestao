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

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const palavras = (s: string) => normalizar(s).split(/[^a-z0-9,.]+/).filter((w) => w.length >= 2)

// Sugere o produto do estoque mais parecido (por palavras da descrição) só para os itens ainda sem vínculo. Nunca troca vínculo existente.
export function sugerirVinculos(itens: ItemCalculo[], vinculos: Record<string, string>, produtos: ProdutoEstoque[]): Record<string, string> {
  const sugestoes: Record<string, string> = {}
  for (const item of itens) {
    if (vinculos[item.chave]) continue
    const alvo = new Set(palavras(item.descricao))
    if (alvo.size === 0) continue
    let melhor: { id: string; nota: number } | null = null
    for (const p of produtos) {
      const ps = palavras(p.nome)
      if (ps.length === 0) continue
      const acertos = ps.filter((w) => alvo.has(w)).length
      const nota = (acertos / Math.max(alvo.size, ps.length)) + (p.custo && p.custo > 0 ? 0.01 : 0)
      if (acertos >= 2 && nota >= 0.5 && (!melhor || nota > melhor.nota)) melhor = { id: p.id, nota }
    }
    if (melhor) sugestoes[item.chave] = melhor.id
  }
  return sugestoes
}

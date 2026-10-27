// Chamado #2710 (FCR) · preço de venda sugerido na ENTRADA da nota de compra.
// Custo do produto = custo da linha da nota (custo real calculado; sem ele, o valor unitário da nota) ÷ fator de conversão
// (1 CX da nota = 12 UN do produto → divide por 12). Preço sugerido = custo × (1 + markup do produto, ou o geral).
// Mesma conta do fn_preco_markup_efetivo (arredonda em 2 casas) — a tela manda o custo já convertido para a função.

export function custoProdutoDaNota(custoReal: number | null | undefined, valorUnitario: number | null | undefined, fator: number | null | undefined): number | null {
  const base = custoReal != null && Number(custoReal) > 0 ? Number(custoReal) : Number(valorUnitario ?? 0)
  if (!(base > 0)) return null
  const f = fator != null && Number(fator) > 0 ? Number(fator) : 1
  return Math.round((base / f) * 10000) / 10000
}

export function precoPorMarkup(custo: number | null | undefined, markupPct: number | null | undefined): number | null {
  if (custo == null || !(Number(custo) > 0) || markupPct == null || Number.isNaN(Number(markupPct))) return null
  return Math.round(Number(custo) * (1 + Number(markupPct) / 100) * 100) / 100
}

// "12,50" / "12.50" / "1.234,56" → 12.5 / 1234.56; vazio ou inválido → null
export function lerPreco(txt: string): number | null {
  const t = txt.trim().replace(/\s|R\$/g, '')
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

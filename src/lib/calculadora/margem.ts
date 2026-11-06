// Calculadora de Obra (Gold): margem sobre o preço de venda. Sem rede; só aritmética.
const r2 = (v: number) => Math.round(v * 100) / 100

export type Venda = { custo: number; margemPct: number; preco: number; lucro: number }

// Margem sobre o PREÇO (não markup): preço = custo ÷ (1 − margem). Margem fora de 0–95% é recusada (preço absurdo).
export function precoComMargem(custo: number, margemPct: number): Venda | null {
  if (!Number.isFinite(custo) || custo < 0 || !Number.isFinite(margemPct) || margemPct < 0 || margemPct > 95) return null
  const preco = r2(custo / (1 - margemPct / 100))
  return { custo: r2(custo), margemPct, preco, lucro: r2(preco - custo) }
}

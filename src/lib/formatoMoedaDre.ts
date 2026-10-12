// Formato de valor do DRE (CEO 07/10): moeda completa pt-BR, 2 casas, nunca abreviado.
// Negativo = "-R$ 1.234,56" (hífen na frente, sem parênteses); positivo sem sinal.
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const COR_VALOR_NEGATIVO = '#A32D2D'

export function fmtMoedaDre(n: number): string {
  if (!Number.isFinite(n)) return brl.format(0).replace(/ /g, ' ')
  const r = Math.round(n * 100) / 100
  const txt = brl.format(Math.abs(r)).replace(/ /g, ' ')
  return r < 0 ? `-${txt}` : txt
}

// despesa/custo (sinal '-') sai sempre com "-", venha o valor positivo ou já negativo.
export function valorComSinalDre(n: number, sinal: string): number {
  return sinal === '-' ? -Math.abs(n) : n
}

export const ehNegativoDre = (n: number) => Math.round(n * 100) / 100 < 0

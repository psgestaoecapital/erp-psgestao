/**
 * custo.ts — Consultor IA (PR B, item 5): custo REAL por pergunta a partir do `usage` da Messages API.
 *
 * Tabela de preço por família de modelo Claude (USD por 1 MILHÃO de tokens — preços públicos da Anthropic).
 * Mantida à mão: o id do modelo vem de env (modeloPara('consultor')), então casamos por FAMÍLIA (opus/haiku/
 * sonnet) e caímos no Sonnet como padrão. Serve para MEDIR o custo e alimentar o teto POR EMPRESA
 * (ia_consumo_empresa, padrão US$ 1/dia). O teto GLOBAL tem o ledger próprio (anthropic_budget_control).
 * Prompt caching abate: cache_read custa ~1/10 do input; cache_write custa ~1,25× o input.
 */

export type UsoLLM = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

type Preco = { input: number; output: number; cacheWrite: number; cacheRead: number } // USD por token
const porMilhao = (i: number, o: number, cw: number, cr: number): Preco => ({
  input: i / 1e6, output: o / 1e6, cacheWrite: cw / 1e6, cacheRead: cr / 1e6,
})

const SONNET = porMilhao(3, 15, 3.75, 0.3)
const TABELA: { familia: RegExp; preco: Preco }[] = [
  { familia: /opus/i, preco: porMilhao(15, 75, 18.75, 1.5) },
  { familia: /haiku/i, preco: porMilhao(0.8, 4, 1, 0.08) },
  { familia: /sonnet/i, preco: SONNET },
]

export function precoDoModelo(modelo: string): Preco {
  return TABELA.find((t) => t.familia.test(modelo || ''))?.preco ?? SONNET
}

/** Custo em USD de um `usage` (uma chamada). Soma input + output + cache (write/read). */
export function custoUsd(modelo: string, uso: UsoLLM): number {
  const p = precoDoModelo(modelo)
  return (
    Number(uso.input_tokens || 0) * p.input +
    Number(uso.output_tokens || 0) * p.output +
    Number(uso.cache_creation_input_tokens || 0) * p.cacheWrite +
    Number(uso.cache_read_input_tokens || 0) * p.cacheRead
  )
}

/** Acumula o `usage` de várias rodadas do loop numa só medida. */
export function somarUso(a: UsoLLM, b: UsoLLM | undefined | null): UsoLLM {
  const x = b || {}
  return {
    input_tokens: (a.input_tokens || 0) + (x.input_tokens || 0),
    output_tokens: (a.output_tokens || 0) + (x.output_tokens || 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens || 0) + (x.cache_creation_input_tokens || 0),
    cache_read_input_tokens: (a.cache_read_input_tokens || 0) + (x.cache_read_input_tokens || 0),
  }
}

/** Total de tokens (para log/telemetria). */
export function totalTokens(uso: UsoLLM): number {
  return (
    Number(uso.input_tokens || 0) +
    Number(uso.output_tokens || 0) +
    Number(uso.cache_creation_input_tokens || 0) +
    Number(uso.cache_read_input_tokens || 0)
  )
}

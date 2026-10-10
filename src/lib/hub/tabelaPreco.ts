// HB2 — tabela de preço por cliente: o sistema escolhe a faixa pela quantidade e aplica o adicional da condição
// (percentual da tabela, ou preço fixo por condição quando o cliente não usa percentual). Mesma regra da tela e do teste.
export interface ItemFaixa { faixa_de: number; faixa_ate: number | null; preco_base: number }
export interface Condicao { condicao: string; percentual?: number | null; preco_fixo?: number | null }

/** Faixa [de, ate): 100 cai na faixa 100–500; ate nulo = sem teto. */
export function escolherFaixa<T extends ItemFaixa>(faixas: T[], quantidade: number): T | null {
  const ord = [...faixas].sort((a, b) => a.faixa_de - b.faixa_de)
  return ord.find(f => quantidade >= f.faixa_de && (f.faixa_ate == null || quantidade < f.faixa_ate)) ?? null
}

const centavos = (v: number) => Math.round(v * 100 + 1e-9) / 100

export function precoUnitario(faixas: ItemFaixa[], quantidade: number, cond?: Condicao | null): number | null {
  const f = escolherFaixa(faixas, quantidade)
  if (!f) return null
  if (cond?.preco_fixo != null) return centavos(cond.preco_fixo)
  return centavos(f.preco_base * (1 + (cond?.percentual ?? 0) / 100))
}

export const margemContraCusto = (preco: number, custo: number) => (preco > 0 ? (preco - custo) / preco : 0)

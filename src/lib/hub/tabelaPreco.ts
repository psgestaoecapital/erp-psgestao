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

// Precedência de preço no item do orçamento: contrato do cliente > tabela por cliente > tabela padrão.
export type OrigemPreco = 'contrato' | 'tabela_cliente' | 'tabela_padrao'
export interface FontePreco { origem: OrigemPreco; preco: number | null | undefined }
const ROTULO_ORIGEM: Record<OrigemPreco, string> = {
  contrato: 'Contrato do cliente',
  tabela_cliente: 'Tabela do cliente',
  tabela_padrao: 'Tabela padrão',
}
const ORDEM_ORIGEM: OrigemPreco[] = ['contrato', 'tabela_cliente', 'tabela_padrao']

/** Escolhe a primeira fonte com preço, na ordem contrato > tabela do cliente > padrão, e explica o motivo em linguagem simples. */
export function escolherFontePreco(fontes: FontePreco[]): { origem: OrigemPreco; preco: number; motivo: string } | null {
  for (const origem of ORDEM_ORIGEM) {
    const f = fontes.find(x => x.origem === origem && x.preco != null)
    if (!f) continue
    const pulados = ORDEM_ORIGEM.slice(0, ORDEM_ORIGEM.indexOf(origem)).map(o => ROTULO_ORIGEM[o].toLowerCase())
    const motivo = pulados.length === 0
      ? `${ROTULO_ORIGEM[origem]} tem preço para este serviço e vale primeiro.`
      : `${ROTULO_ORIGEM[origem]}: não há preço em ${pulados.join(' nem em ')} para este serviço.`
    return { origem, preco: f.preco as number, motivo }
  }
  return null
}

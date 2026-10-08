// Hub · HB2 — preço da tabela do cliente: o usuário escolhe serviço, quantidade e condição; a faixa e o adicional saem sozinhos.
// Faixa = faixa_de < quantidade <= faixa_ate (ate nulo = sem teto); a primeira faixa começa em 0. Adicional = percentual da tabela
// sobre o preço base, ou preço fixo da condição quando o item tiver um. Arredonda em 2 casas.
export type Condicao = 'normal' | 'noturno' | 'sabado' | 'domingo_feriado'

export interface ItemTabela {
  servico_id: string
  faixa_de: number
  faixa_ate: number | null
  preco_base: number
  precos_fixos?: Partial<Record<Condicao, number>>
  adicional?: boolean
}
export interface RegraTabela { condicao: Exclude<Condicao, 'normal'>; percentual: number }
export interface CodigoTabela { servico_id: string; condicao: Condicao; codigo_externo: string }

export interface PrecoCalculado {
  preco: number
  faixa: ItemTabela
  percentual: number
  fixo: boolean
  codigo: string | null
  total: number
  margem: number | null // contra a CPU (custo unitário), se informada
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function escolherFaixa(itens: ItemTabela[], servicoId: string, qtd: number): ItemTabela | null {
  return itens.find((i) => i.servico_id === servicoId && qtd > i.faixa_de && (i.faixa_ate == null || qtd <= i.faixa_ate)) ?? null
}

export function precoDaTabela(
  itens: ItemTabela[], regras: RegraTabela[], codigos: CodigoTabela[],
  q: { servico_id: string; quantidade: number; condicao: Condicao; custo_unitario?: number },
): PrecoCalculado | null {
  const faixa = escolherFaixa(itens, q.servico_id, q.quantidade)
  if (!faixa) return null
  const fixoCond = q.condicao === 'normal' ? undefined : faixa.precos_fixos?.[q.condicao]
  const pct = q.condicao === 'normal' || fixoCond != null ? 0 : regras.find((r) => r.condicao === q.condicao)?.percentual ?? 0
  const preco = r2(fixoCond ?? faixa.preco_base * (1 + pct / 100))
  const codigo = codigos.find((c) => c.servico_id === q.servico_id && c.condicao === q.condicao)?.codigo_externo ?? null
  const margem = q.custo_unitario != null && preco > 0 ? r2(((preco - q.custo_unitario) / preco) * 100) : null
  return { preco, faixa, percentual: pct, fixo: fixoCond != null, codigo, total: r2(preco * q.quantidade), margem }
}

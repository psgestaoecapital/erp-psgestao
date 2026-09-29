// #340 (R.R) · medição do ESCOPO da obra pela NFS-e. A mesma regra do banco (fn_nfse_obra_medicao_validar), para o
// modal conferir ANTES de enviar e a pessoa ver quanto falta ou sobra. Decisão do CEO (29/09): a soma dos itens
// (quantidade × preço unitário) tem de bater com o valor da nota, tolerância R$ 0,01; a mensagem diz quanto falta ou
// sobra. A medição só é lançada com a nota autorizada; rejeitada não lança; cancelada estorna (gatilho no banco).

export interface ItemEscopo {
  id: string
  descricao: string
  preco_unitario: number
  quantidade_a_medir: number
}
export interface ConferenciaMedicao {
  ok: boolean
  soma: number
  diferenca: number          // valor da nota − soma dos itens (> 0 faltam · < 0 sobram)
  itens: { item_id: string; quantidade: number }[]
  erros: string[]
}

const cent = (n: number) => Math.round(n * 100) / 100
export const brl = (n: number) => cent(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function conferirMedicaoEscopo(escopo: ItemEscopo[], quantidades: Record<string, number | null | undefined>, valorNota: number): ConferenciaMedicao {
  const erros: string[] = []
  const itens: { item_id: string; quantidade: number }[] = []
  let soma = 0
  for (const it of escopo) {
    const q = Number(quantidades[it.id] ?? 0)
    if (!Number.isFinite(q) || q <= 0) continue
    if (q > Number(it.quantidade_a_medir) + 0.00005) {
      erros.push(`"${it.descricao}": a medição (${q}) passa do que falta medir (${Number(it.quantidade_a_medir)}).`)
    }
    soma += cent(q * Number(it.preco_unitario))
    itens.push({ item_id: it.id, quantidade: q })
  }
  soma = cent(soma)
  const diferenca = cent((Number(valorNota) || 0) - soma)
  if (itens.length > 0 && Math.abs(diferenca) > 0.01) {
    erros.push(`Os itens medidos somam R$ ${brl(soma)} e a nota é de R$ ${brl(Number(valorNota) || 0)}: ${diferenca > 0 ? 'faltam' : 'sobram'} R$ ${brl(Math.abs(diferenca))} nos itens.`)
  }
  return { ok: itens.length > 0 && erros.length === 0, soma, diferenca, itens, erros }
}

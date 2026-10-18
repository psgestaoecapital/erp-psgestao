// #106 (Jordana · Gean): título a receber PARCIAL na conciliação. O atendente já registrou o pagamento (baixa em
// erp_receber_baixa, sem crédito do extrato ligado); o financeiro precisa ver, separados, o que já foi PAGO (cada
// baixa) e o SALDO em aberto, e conciliar o crédito com a baixa certa — sem criar outra baixa.
// O banco já faz a ligação sem duplicar (fn_receber_conciliacao_sync, #38): crédito com o mesmo valor de uma baixa
// sem movimento é LIGADO a ela. Aqui fica só a leitura para a tela e o valor de referência do crédito, igual ao
// fn_receber_valor_referencia (valor cheio · saldo aberto · baixa sem crédito — o mais próximo do crédito).

export interface BaixaTitulo {
  id: string
  valor: number
  data: string | null
  forma: string | null
  movimento_banco_id: string | null
}

export interface TituloReceber {
  valor: number
  juros?: number | null
  multa?: number | null
  desconto?: number | null
  valor_pago?: number | null
}

export interface LinhaTitulo {
  tipo: 'pago' | 'conciliado' | 'aberto'
  valor: number
  data: string | null
  forma: string | null
  baixa_id: string | null
}

const cent = (n: number) => Math.round(n * 100) / 100

export function saldoAberto(t: TituloReceber): number {
  return cent(Math.max(Number(t.valor) + Number(t.juros ?? 0) + Number(t.multa ?? 0) - Number(t.desconto ?? 0) - Number(t.valor_pago ?? 0), 0))
}

/** Uma linha por baixa (pago = sem crédito ligado · conciliado = já ligada a um crédito) + a linha do saldo aberto. */
export function linhasDoTitulo(t: TituloReceber, baixas: BaixaTitulo[]): LinhaTitulo[] {
  const linhas: LinhaTitulo[] = baixas
    .slice()
    .sort((a, b) => (a.data ?? '').localeCompare(b.data ?? ''))
    .map((b) => ({
      tipo: b.movimento_banco_id ? 'conciliado' : 'pago',
      valor: cent(Number(b.valor)),
      data: b.data,
      forma: b.forma,
      baixa_id: b.id,
    }))
  const aberto = saldoAberto(t)
  if (aberto > 0.01) linhas.push({ tipo: 'aberto', valor: aberto, data: null, forma: null, baixa_id: null })
  return linhas
}

/** Valor do título que o crédito está pagando: valor cheio, saldo aberto ou uma baixa sem crédito — o mais próximo. */
export function valorReferencia(t: TituloReceber, baixas: BaixaTitulo[], credito: number): number {
  const c = Math.abs(Number(credito))
  const candidatos = [cent(Number(t.valor))]
  if (Number(t.valor_pago ?? 0) > 0) candidatos.push(saldoAberto(t))
  for (const b of baixas) if (!b.movimento_banco_id) candidatos.push(cent(Number(b.valor)))
  return candidatos.filter((v) => v > 0).sort((a, b) => Math.abs(a - c) - Math.abs(b - c))[0] ?? cent(Number(t.valor))
}

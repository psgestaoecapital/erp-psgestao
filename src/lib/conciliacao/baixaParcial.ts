// #145 (André · PS) · "Vincular vários" (fatura agrupada): baixa PARCIAL por conta. O banco já aceitava — cada vínculo
// guarda o seu valor (fn_conciliacao_vincular p_valor) e a baixa nasce desse valor (fn_pagar/receber_conciliacao_sync);
// a tela é que sempre mandava o valor cheio. Esta regra confere o valor digitado contra o saldo do título.

export interface ConferenciaBaixaParcial {
  ok: boolean
  parcial: boolean       // o título fica "parcial" (saldo em aberto)
  restante: number       // o que continua em aberto no título
  erro: string | null
}

const cent = (n: number) => Math.round(n * 100) / 100
const brl = (n: number) => 'R$ ' + cent(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** saldo do título = valor + juros + multa − desconto − já pago */
export function saldoTitulo(t: { valor: number; juros?: number | null; multa?: number | null; desconto?: number | null; valor_pago?: number | null }): number {
  return cent(Number(t.valor) + Number(t.juros ?? 0) + Number(t.multa ?? 0) - Number(t.desconto ?? 0) - Number(t.valor_pago ?? 0))
}

export function conferirBaixaParcial(saldo: number, valor: number): ConferenciaBaixaParcial {
  const s = cent(saldo), v = cent(valor)
  if (!Number.isFinite(v) || v <= 0) return { ok: false, parcial: false, restante: s, erro: 'Informe um valor maior que zero.' }
  if (v > s + 0.01) return { ok: false, parcial: false, restante: s, erro: `O valor (${brl(v)}) passa do saldo do título (${brl(s)}).` }
  const restante = cent(Math.max(s - v, 0))
  return { ok: true, parcial: restante > 0.01, restante, erro: null }
}

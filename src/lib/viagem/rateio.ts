// Rateio de um cupom de viagem entre obras — a MESMA conta do fn_viagem_lancamento_ratear (o banco continua sendo o juiz;
// aqui é para a tela mostrar a divisão antes de enviar). Valor da parte = round(valor × % ÷ 100, 2); os centavos que
// sobram vão para a maior parte (empate: a última), para a soma fechar exatamente no valor do cupom.
export type ParteRateio = { obra_id: string; percentual: number }
export type ParteCalculada = ParteRateio & { valor: number }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function validarRateio(partes: ParteRateio[]): string[] {
  const e: string[] = []
  if (partes.length < 2 || partes.length > 10) e.push('partes: de 2 a 10 obras')
  if (partes.some(p => !p.obra_id || !(p.percentual > 0))) e.push('parte: cada uma precisa de obra e percentual maior que zero')
  const soma = r2(partes.reduce((a, p) => a + (Number(p.percentual) || 0), 0))
  if (soma !== 100) e.push(`percentuais: somam ${soma.toFixed(2)}%, precisam somar 100%`)
  if (new Set(partes.map(p => p.obra_id)).size !== partes.length) e.push('obras: repetidas no rateio')
  return e
}

export function dividirRateio(valor: number, partes: ParteRateio[]): ParteCalculada[] {
  const out = partes.map(p => ({ ...p, valor: r2(valor * p.percentual / 100) }))
  if (out.length === 0) return out
  let maior = 0
  out.forEach((p, i) => { if (p.percentual >= out[maior].percentual) maior = i })
  out[maior].valor = r2(out[maior].valor + r2(valor - out.reduce((a, p) => a + p.valor, 0)))
  return out
}

// custo por km da viagem (= fn_viagem_resumo / fn_viagem_custo_relatorio) e km rateado de uma obra
export const custoKm = (total: number, km: number | null) => (km && km > 0 ? r2(total / km) : null)
export const kmRateado = (km: number | null, valorObra: number, totalViagem: number) =>
  (km != null && totalViagem > 0 ? Math.round((km * valorObra / totalViagem) * 10) / 10 : null)

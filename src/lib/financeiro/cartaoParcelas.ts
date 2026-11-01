// #3740 · prévia dos repasses de cartão por parcela — a MESMA conta de fn_cartao_registrar_recebimento:
// bruto = total / n (a última parcela leva o arredondamento), taxa = bruto × % do cadastro, líquido = bruto − taxa,
// repasse da parcela i = venda + prazo do cadastro + 30·(i−1). Sem rede (o gate check-cartao-repasse-3740 testa).
export type ParcelaCartao = { i: number; bruto: number; taxa: number; liquido: number; repasse: string }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const somaDias = (iso: string, d: number) => {
  const x = new Date(iso + 'T00:00:00Z')
  x.setUTCDate(x.getUTCDate() + d)
  return x.toISOString().split('T')[0]
}

export function parcelasCartao(total: number, n: number, pct: number, prazo: number, dataVenda: string): ParcelaCartao[] {
  const out: ParcelaCartao[] = []
  let acum = 0
  for (let i = 1; i <= n; i++) {
    const bruto = i < n ? r2(total / n) : r2(total - acum)
    acum = r2(acum + bruto)
    const taxa = r2(bruto * pct / 100)
    out.push({ i, bruto, taxa, liquido: r2(bruto - taxa), repasse: somaDias(dataVenda, prazo + 30 * (i - 1)) })
  }
  return out
}

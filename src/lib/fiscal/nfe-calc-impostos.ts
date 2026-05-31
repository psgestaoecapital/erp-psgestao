import type { NFeProdutoItem } from './types'

export interface ImpostosCalculados {
  valorProdutos: number
  valorIcms: number
  valorIpi: number
  valorPis: number
  valorCofins: number
  valorTotalImpostos: number
  valorTotalNota: number
}

// Focus NFe recalcula no envio · este calculo e so pra preview UI.
export function calcularImpostos(
  itens: NFeProdutoItem[],
  valorFrete: number = 0,
  valorDesconto: number = 0
): ImpostosCalculados {
  let valorProdutos = 0
  let valorIcms = 0
  let valorIpi = 0
  let valorPis = 0
  let valorCofins = 0

  for (const item of itens) {
    valorProdutos += item.valorTotal
    const base = item.valorTotal
    if (item.icms?.aliquota) valorIcms += base * (item.icms.aliquota / 100)
    if (item.ipi?.aliquota) valorIpi += base * (item.ipi.aliquota / 100)
    if (item.pis?.aliquota) valorPis += base * (item.pis.aliquota / 100)
    if (item.cofins?.aliquota) valorCofins += base * (item.cofins.aliquota / 100)
  }

  const round = (n: number) => Math.round(n * 100) / 100
  // IPI soma ao total · ICMS/PIS/COFINS sao "por dentro"
  const valorTotalImpostos = round(valorIpi)
  const valorTotalNota = round(valorProdutos + valorFrete - valorDesconto + valorTotalImpostos)

  return {
    valorProdutos: round(valorProdutos),
    valorIcms: round(valorIcms),
    valorIpi: round(valorIpi),
    valorPis: round(valorPis),
    valorCofins: round(valorCofins),
    valorTotalImpostos,
    valorTotalNota,
  }
}

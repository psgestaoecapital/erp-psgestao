// PARSER do arquivo de RETORNO CNAB 240 de PAGAMENTO — Sicredi (banco 748). Lê POSICIONALMENTE (240 chars,
// nunca por conteúdo) e extrai, de cada segmento J000 (pagamento de boleto), o que precisa pra dar baixa:
// código de barras (casa com o título), valor pago e data do pagamento efetivos, e a ocorrência do banco.
//
// ⚠️ RD-38 — o layout do RETURN Sicredi (posições de valor pago/data/ocorrência) segue o padrão FEBRABAN do
// segmento J e é SIMÉTRICO ao da remessa que já provamos byte a byte (mesmas posições de código de barras,
// data e valor). Ainda assim, os CÓDIGOS de ocorrência e a posição exata devem ser CONFIRMADOS contra o
// PRIMEIRO arquivo de retorno real da Jordana (scripts/cnab-retorno-proof-sicredi.ts aceita um real em
// .cnab-real/). Por segurança, a decisão "pago" NÃO depende só da ocorrência: exige data + valor pago > 0,
// e a baixa só ocorre se o valor pago BATER com o título (o casamento/guarda de valor é feito na RPC). Assim
// um erro de posição/ocorrência FALHA SEGURO (vira "revisar"), nunca uma baixa errada.
//
// Segmento J000 (pagamento) — offsets FEBRABAN (1-based): banco[1-3] lote[4-7] tipo[8]=3 nSeq[9-13]
// seg[14]=J mov[15-17] codBarras[18-61] nomeBenef[62-91] dtVenc[92-99] valTitulo[100-114] desc[115-129]
// acresc[130-144] dtPagto[145-152] valPagto[153-167] qtdMoeda[168-182] seuNum[183-202] ... ocorr[231-240].
// O J-52 (par do J000) tem o [15] em branco e carrega pagador/beneficiário — ignorado no retorno.

export type ItemRetornoSicredi = {
  codBarras: string          // 44 dígitos (pos 18-61) — chave de casamento com o título
  nomeBenef: string
  dtVencimento: string | null // AAAA-MM-DD (de DDMMAAAA, pos 92-99)
  valTitulo: number          // reais (pos 100-114 / 100)
  dtPagamento: string | null // AAAA-MM-DD (pos 145-152) — null se zerada (não pago)
  valPago: number            // reais (pos 153-167 / 100)
  codMovimento: string       // pos 15-17 (código de movimento do retorno)
  ocorrencias: string        // pos 231-240 (códigos de ocorrência, cru/trim)
  ocorrencia: string         // rótulo combinado p/ auditar: "mov/ocorr"
  pagoHint: boolean          // heurística POSICIONAL de pago: tem data + valor pago > 0
}

export type RetornoSicredi = {
  banco: string
  nsa: number                // Número Sequencial do Arquivo (header pos 158-163) — casa com a remessa gerada
  itens: ItemRetornoSicredi[]
}

const num = (s: string) => parseInt((s || '').replace(/\D/g, '') || '0', 10)
// DDMMAAAA -> AAAA-MM-DD (null se zerada/ inválida)
function dataIso(ddmmaaaa: string): string | null {
  const d = (ddmmaaaa || '').replace(/\D/g, '')
  if (d.length !== 8 || d === '00000000') return null
  const dia = d.slice(0, 2), mes = d.slice(2, 4), ano = d.slice(4, 8)
  if (dia === '00' || mes === '00' || ano === '0000') return null
  return `${ano}-${mes}-${dia}`
}

/** Faz o parse de um arquivo de retorno CNAB 240 de pagamento do Sicredi (latin-1). */
export function parseRetornoSicredi(raw: string): RetornoSicredi {
  const linhas = raw.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
  if (!linhas.length) return { banco: '', nsa: 0, itens: [] }

  const header = linhas.find((l) => l[7] === '0') ?? linhas[0]
  const banco = header.slice(0, 3)
  const nsa = num(header.slice(157, 163)) // pos 158-163

  const itens: ItemRetornoSicredi[] = []
  for (const l of linhas) {
    if (l.length < 167) continue
    if (l[7] !== '3' || l[13] !== 'J' || l[14] === ' ') continue // só J000 (J-52 tem [15] em branco)
    const codBarras = l.slice(17, 61).replace(/\D/g, '')
    if (codBarras.length !== 44) continue
    const dtPagamento = dataIso(l.slice(144, 152))
    const valPago = num(l.slice(152, 167)) / 100
    const codMovimento = l.slice(14, 17).trim()
    const ocorrencias = l.slice(230, 240).trim()
    itens.push({
      codBarras,
      nomeBenef: l.slice(61, 91).replace(/ +$/, ''),
      dtVencimento: dataIso(l.slice(91, 99)),
      valTitulo: num(l.slice(99, 114)) / 100,
      dtPagamento,
      valPago,
      codMovimento,
      ocorrencias,
      ocorrencia: `${codMovimento || '—'}${ocorrencias ? '/' + ocorrencias : ''}`,
      pagoHint: dtPagamento !== null && valPago > 0,
    })
  }
  return { banco, nsa, itens }
}

// Parser de código de barras de BOLETO BANCÁRIO (Fase 1 do auto-preenchimento).
// Extrai VALOR e VENCIMENTO. NÃO trata guia de arrecadação (prefixo 8 → Fase 2).
// RD-38: não prometer o que não dá — recebedor NÃO está no código (Fase 3, por histórico).
// RD-46: não fabricar dado ausente — valor 0 ou fator 0 → não retorna o campo.
//
// ⚠️ Fator de vencimento: base 07/10/1997; o contador estourou 9999 em 21/02/2025 e
// rolou pra 1000 = 22/02/2025 (regra Febraban). Aqui resolvemos a ambiguidade escolhendo
// a data MAIS PRÓXIMA de hoje entre as duas eras. VALIDAR na tela com boleto recente real.

export interface BoletoLido {
  valor?: number
  vencimento?: string // YYYY-MM-DD
}

// Linha digitável (47 díg) → código de barras (44 díg).
function linhaParaBarras(l: string): string {
  const bancoMoeda = l.slice(0, 4) // banco(3) + moeda(1)
  const dvGeral = l.slice(32, 33) // DV geral do código de barras
  const fatorValor = l.slice(33, 47) // fator(4) + valor(10)
  const campoLivre = l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31) // 25 díg
  return bancoMoeda + dvGeral + fatorValor + campoLivre // 4+1+14+25 = 44
}

// DV geral do código de barras (módulo 11, pesos 2..9 da direita p/ esquerda).
function dvModulo11(digits43: string): number {
  let soma = 0
  let peso = 2
  for (let i = digits43.length - 1; i >= 0; i--) {
    soma += parseInt(digits43[i], 10) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  const dv = 11 - resto
  if (dv === 0 || dv === 10 || dv === 11) return 1
  return dv
}

function fatorParaData(fator: number): string {
  const DIA = 86400000
  const base1 = Date.UTC(1997, 9, 7) // 07/10/1997 (era original)
  const base2 = Date.UTC(2025, 1, 22) // 22/02/2025 (rollover: fator 1000)
  const cand1 = base1 + fator * DIA
  const cand2 = fator >= 1000 ? base2 + (fator - 1000) * DIA : null
  const hoje = Date.now()
  let escolhido = cand1
  if (cand2 !== null && Math.abs(cand2 - hoje) < Math.abs(cand1 - hoje)) {
    escolhido = cand2
  }
  return new Date(escolhido).toISOString().slice(0, 10)
}

export function parseBoletoBarras(entrada: string): BoletoLido | null {
  const dig = (entrada || '').replace(/\D/g, '')
  let barras: string
  if (dig.length === 47) barras = linhaParaBarras(dig)
  else if (dig.length === 44) barras = dig
  else return null
  if (barras.length !== 44) return null
  if (barras[0] === '8') return null // guia de arrecadação — Fase 2

  // valida o DV geral (posição 5 · índice 4) sobre os outros 43 dígitos
  const semDv = barras.slice(0, 4) + barras.slice(5)
  if (dvModulo11(semDv) !== parseInt(barras[4], 10)) return null

  const fator = parseInt(barras.slice(5, 9), 10)
  const valorCent = parseInt(barras.slice(9, 19), 10)
  const valor = valorCent > 0 ? valorCent / 100 : undefined // valor 0/aberto → não preenche
  const vencimento = fator > 0 ? fatorParaData(fator) : undefined
  if (valor === undefined && vencimento === undefined) return null
  return { valor, vencimento }
}

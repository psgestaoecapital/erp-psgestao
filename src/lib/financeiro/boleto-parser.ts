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

// Normaliza QUALQUER entrada de boleto para o CÓDIGO DE BARRAS de 44 dígitos.
// Aceita linha digitável (47 díg · boleto bancário) e código de barras (44 díg), retornando sempre 44.
// - 47 → converte (linhaParaBarras) e valida o DV geral (mód 11); DV errado → null (paste com erro).
// - 44 → devolve como está (preserva o comportamento antigo; guia de arrecadação começa com '8' e
//   tem DV próprio mód 10/11, então NÃO reaplicamos o DV bancário aqui).
// - qualquer outro tamanho → null. Não fabrica dado (RD-46/51).
export function normalizarCodigoBarras(entrada?: string | null): string | null {
  const dig = (entrada || '').replace(/\D/g, '')
  if (!dig) return null
  if (dig.length === 44) return dig
  if (dig.length === 47) {
    const barras = linhaParaBarras(dig)
    if (barras.length !== 44) return null
    const semDv = barras.slice(0, 4) + barras.slice(5)
    if (dvModulo11(semDv) !== parseInt(barras[4], 10)) return null
    return barras
  }
  return null
}

// Valor CANÔNICO pra CONSULTA (anti-duplicidade / anti-fraude): tem que casar com o que a
// GRAVAÇÃO persiste (44 díg do boleto bancário — ver normalizarCodigoBarras usado no salvar).
// - boleto bancário (linha 47 / barras 44) → sempre os 44 canônicos (mesmo formato do banco).
// - guia de arrecadação (começa com '8', 44/48 díg, DV próprio) → NÃO tem conversão bancária;
//   segue com os dígitos crus (dedup entre guias, não fabrica um 44 inválido — RD-46).
// Assim o mesmo boleto colado como linha (47) OU como barras (44) consulta no MESMO valor —
// era o furo que deixava a duplicidade passar (linha 47 nunca batia com os 44 salvos).
export function codigoBarrasParaConsulta(entrada?: string | null): string | null {
  const dig = (entrada || '').replace(/\D/g, '')
  if (!dig) return null
  return normalizarCodigoBarras(dig) ?? dig
}

export interface BoletoReconhecido {
  reconhecido: boolean
  tipo: 'boleto' | 'arrecadacao' | null
  linhaDigitavel: string | null // 47 díg — só quando a pessoa digitou/colou a linha digitável
  codigoBarras: string | null // 44 díg canônico (boleto bancário)
  valor?: number
  vencimento?: string // YYYY-MM-DD
}

// Reconhece a entrada pra dar FEEDBACK ao usuário (Pilar 3): "boleto reconhecido", com a
// linha digitável (read-only) e o código de barras canônico. NÃO inventa nada — se não bate
// no formato/DV, reconhecido=false. Guia de arrecadação ('8') é sinalizada como tal (fora do
// auto-preenchimento bancário, mas ainda de-duplica pelos dígitos crus via codigoBarrasParaConsulta).
export function reconhecerBoleto(entrada?: string | null): BoletoReconhecido {
  const vazio: BoletoReconhecido = { reconhecido: false, tipo: null, linhaDigitavel: null, codigoBarras: null }
  const dig = (entrada || '').replace(/\D/g, '')
  if (!dig) return vazio
  if (dig[0] === '8') {
    // arrecadação: 44 (barras) ou 48 (linha) — não convertemos, mas reconhecemos o tipo.
    if (dig.length === 44 || dig.length === 48) {
      return { reconhecido: true, tipo: 'arrecadacao', linhaDigitavel: dig.length === 48 ? dig : null, codigoBarras: dig.length === 44 ? dig : null }
    }
    return vazio
  }
  const cb = normalizarCodigoBarras(dig)
  if (!cb) return vazio
  const lido = parseBoletoBarras(cb)
  return {
    reconhecido: true,
    tipo: 'boleto',
    linhaDigitavel: dig.length === 47 ? dig : null,
    codigoBarras: cb,
    valor: lido?.valor,
    vencimento: lido?.vencimento,
  }
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

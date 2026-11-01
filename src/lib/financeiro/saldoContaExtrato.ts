// #2751 etapa 3 (Jordana · Gean): por conta, o saldo do sistema × o saldo lido no último extrato importado.
// Sem leitura de extrato → null (a tela não mostra a linha). Diferença = sistema − extrato; abaixo de 1 centavo "bate".
export type ComparaExtrato = { extrato: number; diferenca: number; bate: boolean }

export function compararContaExtrato(saldoSistema: number | null | undefined, saldoExtrato: number | null | undefined): ComparaExtrato | null {
  if (saldoExtrato === null || saldoExtrato === undefined || !Number.isFinite(Number(saldoExtrato))) return null
  const extrato = Number(saldoExtrato)
  const diferenca = Math.round((Number(saldoSistema ?? 0) - extrato) * 100) / 100
  return { extrato, diferenca, bate: Math.abs(diferenca) < 0.01 }
}

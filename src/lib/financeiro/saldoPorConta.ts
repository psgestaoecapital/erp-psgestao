// #3952 (Jordana · Pdois/Prigol): saldo bancário POR CONTA e a data CERTA do saldo lido do OFX.
// Regras puras (testadas em scripts/gates/check-saldo-por-conta.ts).
import { parseDataOFX } from '@/lib/ofx-parser'
import { compararContaExtrato, type ComparaExtrato } from '@/lib/financeiro/saldoContaExtrato'

// Banco brasileiro manda o OFX no horário de Brasília; sem fuso no arquivo, é -03:00.
const FUSO_PADRAO = '-03:00'

// Data a que o saldo de fechamento (<LEDGERBAL>) se refere.
// Caso real (Sicredi, 21/10): DTASOF "20261021000000", sem fuso, e o saldo JÁ inclui os movimentos do dia 21.
// Gravado como 21/10 00:00 UTC, a tela mostrava "20/10 21:00" — um dia antes de movimentos que estão no saldo.
// Regra: o dia do saldo é o maior entre o dia do DTASOF e o último dia com movimento no arquivo; a hora é o FIM
// desse dia (23:59:59). Só mantém a hora do DTASOF quando o banco manda uma hora de verdade (≠ 00:00:00) e o dia
// dele não é anterior ao último movimento. Assim a tela nunca rotula um saldo com data anterior aos movimentos.
export function dataReferenciaSaldoOFX(dtasofBruto: string | null, datasMovimentos: string[]): string | null {
  const iso = parseDataOFX(dtasofBruto)
  const diaDtasof = iso ? iso.slice(0, 10) : null
  const ultimoMov = datasMovimentos.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() ?? null
  const dia = [diaDtasof, ultimoMov].filter((d): d is string => !!d).sort().pop()
  if (!dia) return null
  const offset = iso?.match(/[+-]\d{2}:\d{2}$/)?.[0] ?? FUSO_PADRAO
  const hora = iso ? iso.slice(11, 19) : '00:00:00'
  if (iso && dia === diaDtasof && hora !== '00:00:00') return `${iso.slice(0, 19)}${offset}`
  return `${dia}T23:59:59${offset}`
}

const BR = 'America/Sao_Paulo'

// Rótulo da data do saldo na tela, sempre no horário de Brasília.
// "fim de 21/10" quando o saldo é de fim de dia (23:59) ou é leitura antiga só com data (gravada 00:00 UTC);
// "21/10 às 14:30" quando o banco informou a hora.
export function rotuloDataSaldo(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const soData = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
  if (soData) {
    return `fim de ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: BR, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  ) as Record<string, string>
  if (p.hour === '23' && p.minute === '59') return `fim de ${p.day}/${p.month}`
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`
}

export type ContaSaldo = {
  id: string
  nome: string
  categoria: 'banco' | 'caixa' | 'cartao'
  saldo: number | null
  saldo_extrato_em: string | null
  saldo_extrato_origem: string | null
  gerencial?: number | null
}

export type LinhaSaldoConta = {
  id: string
  nome: string
  banco: string | null
  saldo: number | null           // saldo lido do extrato (null = conta sem leitura)
  data: string                   // rótulo da data a que o saldo se refere
  origem: string | null
  comparacao: ComparaExtrato | null  // sistema − extrato
}

// Um bloco por conta BANCÁRIA ativa (caixa e cartão ficam fora, como sempre), com o total consolidado das lidas.
export function saldosPorConta(contas: ContaSaldo[], bancos: Record<string, string | null> = {}): { linhas: LinhaSaldoConta[]; total: number } {
  const linhas = contas
    .filter((c) => c.categoria === 'banco')
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      banco: bancos[c.id] ?? null,
      saldo: c.saldo === null || c.saldo === undefined ? null : Number(c.saldo),
      data: rotuloDataSaldo(c.saldo_extrato_em),
      origem: c.saldo_extrato_origem,
      comparacao: c.gerencial === null || c.gerencial === undefined ? null : compararContaExtrato(c.gerencial, c.saldo),
    }))
  const total = Math.round(linhas.reduce((s, l) => s + (l.saldo ?? 0), 0) * 100) / 100
  return { linhas, total }
}

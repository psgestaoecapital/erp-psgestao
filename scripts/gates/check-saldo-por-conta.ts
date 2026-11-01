/**
 * Gate de build · #3952 (Jordana · Pdois/Prigol): saldo bancário POR CONTA no Início e a data CERTA do saldo do OFX.
 * Caso real: Sicredi manda DTASOF "20261021000000" (sem fuso) com o saldo JÁ depois dos movimentos de 21/10; gravado como
 * 21/10 00:00 UTC, a tela mostrava "20/10 21:00". Regra em src/lib/financeiro/saldoPorConta.ts.
 */
import { readFileSync } from 'node:fs'
import { dataReferenciaSaldoOFX, rotuloDataSaldo, saldosPorConta } from '../../src/lib/financeiro/saldoPorConta'

let falhas = 0
function ok(cond: boolean, msg: string, obtido?: unknown) {
  if (!cond) { falhas++; console.error(`✘ ${msg}${obtido !== undefined ? ` — obtido: ${JSON.stringify(obtido)}` : ''}`) } else console.log(`✓ ${msg}`)
}

// 1) data a que o saldo se refere
const prigol = dataReferenciaSaldoOFX('20261021000000', ['2026-10-19', '2026-10-21', '2026-10-20'])
ok(prigol === '2026-10-21T23:59:59-03:00', 'Prigol: DTASOF 21/10 00:00 sem fuso → fim de 21/10 (Brasília)', prigol)
ok(rotuloDataSaldo(prigol) === 'fim de 21/10', 'Prigol: a tela mostra "fim de 21/10"', rotuloDataSaldo(prigol))
const atrasado = dataReferenciaSaldoOFX('20261020', ['2026-10-19', '2026-10-21'])
ok(atrasado === '2026-10-21T23:59:59-03:00', 'DTASOF anterior ao último movimento → usa o último dia com movimento', atrasado)
const fim20 = dataReferenciaSaldoOFX('20261020000000', ['2026-10-19', '2026-10-20'])
ok(fim20 === '2026-10-20T23:59:59-03:00', 'OFX que termina em 20/10 → saldo do fim de 20/10', fim20)
const comHora = dataReferenciaSaldoOFX('20261021143000[-3:BRT]', ['2026-10-21'])
ok(comHora === '2026-10-21T14:30:00-03:00', 'banco que manda hora e fuso de verdade → mantém', comHora)
ok(rotuloDataSaldo(comHora) === '21/10 às 14:30', 'hora informada → "21/10 às 14:30"', rotuloDataSaldo(comHora))
const semFusoComHora = dataReferenciaSaldoOFX('20261021143000', ['2026-10-21'])
ok(semFusoComHora === '2026-10-21T14:30:00-03:00', 'hora sem fuso → horário de Brasília', semFusoComHora)
ok(dataReferenciaSaldoOFX(null, ['2026-10-18']) === '2026-10-18T23:59:59-03:00', 'sem DTASOF → fim do último dia com movimento')
ok(dataReferenciaSaldoOFX(null, []) === null, 'sem DTASOF e sem movimento → sem data')
ok(dataReferenciaSaldoOFX('20261018000000', ['2026-10-16']) === '2026-10-18T23:59:59-03:00', 'DTASOF depois do último movimento → dia do DTASOF')
// leitura antiga, gravada 00:00 UTC (só data): continua mostrando o dia certo
ok(rotuloDataSaldo('2026-10-21T00:00:00+00:00') === 'fim de 21/10', 'leitura antiga 21/10 00:00 UTC → "fim de 21/10" (não "20/10 21:00")', rotuloDataSaldo('2026-10-21T00:00:00+00:00'))
// OFX antigo não passa à frente do novo: a data dele é menor (fn_banco_saldo_registrar só grava data >= a gravada)
ok((dataReferenciaSaldoOFX('20261020000000', ['2026-10-20']) ?? '') < (prigol ?? ''), 'OFX de 20/10 tem data menor que o de 21/10 → não sobrescreve')

// 2) um bloco por conta bancária e o total
const r = saldosPorConta([
  { id: 'a', nome: 'SICREDI', categoria: 'banco', saldo: 17528.27, saldo_extrato_em: prigol, saldo_extrato_origem: 'ofx', gerencial: 17528.27 },
  { id: 'b', nome: 'CRESOL', categoria: 'banco', saldo: 1000, saldo_extrato_em: '2026-10-20T23:59:59-03:00', saldo_extrato_origem: 'ofx', gerencial: 900 },
  { id: 'c', nome: 'Caixa', categoria: 'caixa', saldo: 50, saldo_extrato_em: null, saldo_extrato_origem: null },
  { id: 'd', nome: 'ITAU', categoria: 'banco', saldo: null, saldo_extrato_em: null, saldo_extrato_origem: null, gerencial: null },
], { b: 'Cresol' })
ok(r.linhas.length === 3, 'só contas bancárias viram bloco (caixa fica separado)', r.linhas.length)
ok(r.total === 18528.27, 'total = soma dos saldos lidos', r.total)
ok(r.linhas[0].comparacao?.bate === true, 'conta que bate com o sistema')
ok(r.linhas[1].comparacao?.diferenca === -100 && r.linhas[1].banco === 'Cresol', 'diferença sistema − extrato por conta e nome do banco')
ok(r.linhas[2].saldo === null && r.linhas[2].comparacao === null, 'conta sem leitura não inventa saldo nem diferença')

// 3) a tela e a importação usam a regra
const tela = readFileSync('src/components/ge/HeroSaldoBancario.tsx', 'utf8')
ok(tela.includes('saldosPorConta(d.contas ?? [], bancos)'), 'Início monta os blocos por conta pela regra única')
ok(tela.includes('data-testid="saldo-por-conta"'), 'blocos por conta têm data-testid')
ok(/saldo-por-conta[\s\S]*<AjudaCampo chave="ge\.saldo\.conta_extrato"/.test(tela), 'bloco por conta tem o "?" (RD-95)')
ok(!/horaCurta\(/.test(tela), 'a data do saldo não usa mais o horário cru (rotuloDataSaldo)')
const inbox = readFileSync('src/app/dashboard/financeiro/conciliacao/inbox/page.tsx', 'utf8')
ok(/dataReferenciaSaldoOFX\(saldo\.dtasof_bruto, movimentos\.map/.test(inbox), 'importação grava o saldo com a data de referência')
ok(!inbox.includes('saldo.presente ? saldo.dataISO'), 'importação não grava mais o DTASOF cru')

if (falhas) { console.error(`\n${falhas} falha(s) no gate do saldo por conta (#3952)`); process.exit(1) }
console.log('✓ #3952: saldo por conta e data certa do saldo do OFX')

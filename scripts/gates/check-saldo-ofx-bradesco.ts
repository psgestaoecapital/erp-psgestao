/**
 * Gate de build · #4969 (Jordana · Troian): OFX do Bradesco com <LEDGERBAL><BALAMT>-23831,33<DTASOF>00000000.
 * Antes: o DTASOF zerado virava data nula e a RPC só grava saldo com data → o saldo ficava parado (13/10) sem aviso.
 * Agora: data do saldo = último movimento (ou DTEND, se posterior); período do lote pelos movimentos; sem saldo
 * válido a importação avisa. Regras em src/lib/financeiro/saldoPorConta.ts.
 */
import { readFileSync } from 'node:fs'
import { parseOFX, parseSaldoFechamento } from '../../src/lib/ofx-parser'
import {
  dataReferenciaSaldoOFX, dtendDoOFX, periodoPorMovimentos, saldoOFXValido, rotuloDataSaldo, AVISO_SALDO_INVALIDO,
} from '../../src/lib/financeiro/saldoPorConta'

let falhas = 0
function ok(cond: boolean, msg: string, obtido?: unknown) {
  if (!cond) { falhas++; console.error(`✘ ${msg}${obtido !== undefined ? ` — obtido: ${JSON.stringify(obtido)}` : ''}`) } else console.log(`✓ ${msg}`)
}

// Mesma estrutura do arquivo original do Bradesco (SGML v102, CHARSET 1252), com valores fictícios nos movimentos.
const trn = (data: string, valor: string, fitid: string) =>
  `<STMTTRN>\n<TRNTYPE>OTHER\n<DTPOSTED>${data}120000\n<TRNAMT>${valor}\n<FITID>${fitid}\n<MEMO>MOVIMENTO TESTE\n</STMTTRN>\n`
const bradesco = (ledger: string) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252
<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>00000000000000<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0237<ACCTID>12345<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261026120000
<DTEND>20261026120000
${trn('20261022', '-789,00', 'N100FE')}${trn('20261024', '150,25', 'N100FF')}${trn('20261026', '-10,00', 'N10100')}</BANKTRANLIST>
${ledger}
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`
const ofx = bradesco('<LEDGERBAL><BALAMT>-23831,33<DTASOF>00000000</LEDGERBAL>')

const movs = parseOFX(ofx).movimentos
ok(movs.length === 3 && movs[0].valor === 789 && movs[0].natureza === 'debito', 'movimentos com vírgula decimal lidos', movs.map((m) => m.valor))

// 1) BALAMT com vírgula
const saldo = parseSaldoFechamento(ofx)
ok(saldo.presente && saldo.valor === -23831.33, 'BALAMT "-23831,33" → -23831.33', saldo.valor)
ok(saldo.dataISO === null, 'DTASOF "00000000" não é data (o motivo do saldo parado)', saldo.dataISO)

// 2) data do saldo com DTASOF zerado
const datas = movs.map((m) => m.data_transacao)
const dataRef = dataReferenciaSaldoOFX(saldo.dtasof_bruto, datas, dtendDoOFX(ofx))
ok(dtendDoOFX(ofx) === '20261026120000', 'DTEND lido do <BANKTRANLIST>', dtendDoOFX(ofx))
ok(dataRef === '2026-10-26T23:59:59-03:00', 'Troian: DTASOF zerado → saldo do fim de 26/10', dataRef)
ok(rotuloDataSaldo(dataRef) === 'fim de 26/10', 'a tela mostra "fim de 26/10"', rotuloDataSaldo(dataRef))
ok(saldoOFXValido(saldo.valor, dataRef), 'saldo -23.831,33 com data → vai para a gravação')
// DTEND posterior aos movimentos (DTASOF zerado) → dia do DTEND
ok(dataReferenciaSaldoOFX('00000000', ['2026-10-22'], '20261026120000') === '2026-10-26T23:59:59-03:00', 'DTASOF zerado e DTEND depois dos movimentos → dia do DTEND')
// DTEND anterior aos movimentos → último movimento
ok(dataReferenciaSaldoOFX('00000000', ['2026-10-26'], '20261020') === '2026-10-26T23:59:59-03:00', 'DTEND antes dos movimentos → último movimento')
// DTASOF válido: o DTEND não muda nada (regra do #3952 intacta)
ok(dataReferenciaSaldoOFX('20261021000000', ['2026-10-21'], '20261030') === '2026-10-21T23:59:59-03:00', 'DTASOF válido → DTEND ignorado')

// 3) sem saldo válido → aviso, não grava calado
ok(!saldoOFXValido(null, dataRef), 'BALAMT ilegível → não grava')
ok(!saldoOFXValido(-1, dataReferenciaSaldoOFX('00000000', [], null)), 'sem data nenhuma → não grava')
ok(AVISO_SALDO_INVALIDO.includes('este extrato não informa saldo válido'), 'texto do aviso')
const semValor = parseSaldoFechamento(bradesco('<LEDGERBAL><BALAMT>abc<DTASOF>00000000</LEDGERBAL>'))
ok(semValor.presente && semValor.valor === null, 'LEDGERBAL presente com BALAMT inválido é detectado', semValor)

// 4) período do lote pelos movimentos, não pelo DTSTART/DTEND do Bradesco
const per = periodoPorMovimentos(datas)
ok(per.inicio === '2026-10-22' && per.fim === '2026-10-26', 'período 22/10 a 26/10', per)
ok(periodoPorMovimentos([]).inicio === null, 'sem movimentos → período vazio')

// 5) a importação usa a regra
const inbox = readFileSync('src/app/dashboard/financeiro/conciliacao/inbox/page.tsx', 'utf8')
ok(/dataReferenciaSaldoOFX\(saldo\.dtasof_bruto, movimentos\.map\(\(m\) => m\.data_transacao\), dtendDoOFX\(text\)\)/.test(inbox), 'importação passa o DTEND para a data do saldo')
ok(/saldo\.presente && !saldoLedgerOk\)[\s\S]{0,80}AVISO_SALDO_INVALIDO/.test(inbox), 'importação mostra o aviso de saldo inválido')
ok(!/p_periodo_inicio/.test(inbox), 'importação não manda DTSTART/DTEND como período (a RPC usa menor/maior movimento)')
const upload = readFileSync('src/components/conciliacao/UploadOfxArea.tsx', 'utf8')
ok(!/tranList\?\.DTSTART/.test(upload) && upload.includes('periodoPorMovimentos('), 'UploadOfxArea: período pelos movimentos')

if (falhas) { console.error(`\n${falhas} falha(s) no gate do saldo OFX do Bradesco (#4969)`); process.exit(1) }
console.log('✓ #4969: saldo do OFX do Bradesco com DTASOF zerado')

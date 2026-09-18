// Prova do extrator de saldo de fechamento do OFX (SPEC Saldo Bancário, 18/09).
// Rodar: npx tsx scripts/ofx-saldo-proof.ts
// OFX 100% SINTÉTICO — nunca usa arquivo de cliente real (RD-38 / LGPD).
import { parseSaldoFechamento, parseValorOFX, parseDataOFX } from '../src/lib/ofx-parser'

let ok = 0, fail = 0
function check(nome: string, cond: boolean, got: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { fail++; console.log(`  ❌ ${nome} — obtido: ${JSON.stringify(got)}`) }
}

const ledger = (balamt: string, dtasof: string) => `
OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260910<TRNAMT>-100,00<FITID>1<MEMO>Teste</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>${balamt}<DTASOF>${dtasof}</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

const semLedger = `
OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260910<TRNAMT>50.00<FITID>2<MEMO>Sem saldo</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

console.log('parseValorOFX (BALAMT → number, aceita vírgula e sinal):')
check('positivo com ponto  "1234.56" → 1234.56', parseValorOFX('1234.56') === 1234.56, parseValorOFX('1234.56'))
check('positivo com vírgula "1.234,56" → 1234.56', parseValorOFX('1.234,56') === 1234.56, parseValorOFX('1.234,56'))
check('vírgula simples "500,00" → 500', parseValorOFX('500,00') === 500, parseValorOFX('500,00'))
check('negativo "-2.500,90" → -2500.9', parseValorOFX('-2.500,90') === -2500.9, parseValorOFX('-2.500,90'))
check('negativo ponto "-42.10" → -42.1', parseValorOFX('-42.10') === -42.1, parseValorOFX('-42.10'))

console.log('parseDataOFX (DTASOF → ISO, respeita o fuso quando presente):')
check('com fuso "20260918120000[-3:BRT]" → -03:00', parseDataOFX('20260918120000[-3:BRT]') === '2026-09-18T12:00:00-03:00', parseDataOFX('20260918120000[-3:BRT]'))
check('só data "20260918" → meia-noite sem offset', parseDataOFX('20260918') === '2026-09-18T00:00:00', parseDataOFX('20260918'))
check('sem fuso "20260918153000" → sem offset', parseDataOFX('20260918153000') === '2026-09-18T15:30:00', parseDataOFX('20260918153000'))

console.log('parseSaldoFechamento (extrator completo):')
const positivo = parseSaldoFechamento(ledger('12345.67', '20260918120000[-3:BRT]'))
check('LEDGERBAL positivo → presente + valor + dataISO', positivo.presente && positivo.valor === 12345.67 && positivo.dataISO === '2026-09-18T12:00:00-03:00', positivo)
const negativo = parseSaldoFechamento(ledger('-1.500,25', '20260918'))
check('LEDGERBAL negativo com vírgula → -1500.25', negativo.presente && negativo.valor === -1500.25, negativo)
const virgula = parseSaldoFechamento(ledger('2.000,00', '20260901000000[-3:BRT]'))
check('LEDGERBAL com vírgula → 2000 + bruto preservado', virgula.presente && virgula.valor === 2000 && virgula.balamt_bruto === '2.000,00', virgula)
const sem = parseSaldoFechamento(semLedger)
check('sem LEDGERBAL → presente=false, valor=null', sem.presente === false && sem.valor === null, sem)

console.log(`\nResultado: ${ok} passaram, ${fail} falharam`)
process.exit(fail === 0 ? 0 : 1)

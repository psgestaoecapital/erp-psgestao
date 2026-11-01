// Prova do parser OFX tolerante (chamado #2705). Rodar: npx tsx scripts/ofx-tolerante-proof.ts
// OFX 100% SINTÉTICO (RD-38 / LGPD).
import { parseOFX, parseValorOFX, parseDataOFX, parseSaldoFechamento, decodificarOFX, mensagemErroOFX } from '../src/lib/ofx-parser'

let fail = 0
function check(nome: string, cond: boolean, got?: unknown) {
  if (cond) console.log(`  ✅ ${nome}`)
  else { fail++; console.log(`  ❌ ${nome} — obtido: ${JSON.stringify(got)}`) }
}

check('273,81', parseValorOFX('273,81') === 273.81)
check('-1081,94', parseValorOFX('-1081,94') === -1081.94)
check('1.234,56', parseValorOFX('1.234,56') === 1234.56)
check('1,234.56', parseValorOFX('1,234.56') === 1234.56)
check('1,234,567.89', parseValorOFX('1,234,567.89') === 1234567.89)
check('1.234.567', parseValorOFX('1.234.567') === 1234567)
check('-26498,62', parseValorOFX('-26498,62') === -26498.62)
check('lixo → null', parseValorOFX('abc') === null)
check('DTASOF 00000000 → null', parseDataOFX('00000000') === null)
check('DTASOF fuso', parseDataOFX('20260910120000[-3:BRT]') === '2026-09-10T12:00:00-03:00')

const ofx = '\n\n﻿OFXHEADER:100\nCHARSET:1252\n<OFX><DTSERVER>00000000000000<BANKTRANLIST>\n' +
  '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261001000000[-3:BRT]<TRNAMT>-1081,94<FITID>1<MEMO>PAGAMENTO\n</STMTTRN>\n' +
  '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261002<TRNAMT>273,81<FITID>2<MEMO>RECEBIMENTO\n</STMTTRN>\n' +
  '</BANKTRANLIST><LEDGERBAL><BALAMT>-26498,62<DTASOF>00000000</LEDGERBAL></OFX>'
const r = parseOFX(ofx)
check('2 movimentos com vírgula', r.movimentos.length === 2 && r.movimentos[0].valor === 1081.94 && r.movimentos[0].natureza === 'debito', r)
const s = parseSaldoFechamento(ofx)
check('saldo -26498.62 sem data', s.valor === -26498.62 && s.dataISO === null, s)

const latin1 = Uint8Array.from([...'OFXHEADER:100\nCHARSET:1252\n<OFX><MEMO>A'].map((c) => c.charCodeAt(0)).concat([0xe7, 0xe3, 0x6f]))
check('Latin-1 decodifica acento', decodificarOFX(latin1.buffer).endsWith('Ação'), decodificarOFX(latin1.buffer))
check('erro objeto legível', mensagemErroOFX({ message: 'falhou', details: 'coluna x' }) === 'falhou — coluna x')
check('erro objeto sem [object Object]', !mensagemErroOFX({ code: 1 }).includes('[object'))
if (fail) { console.log(`FALHOU: ${fail}`); process.exit(1) }
console.log('OK')

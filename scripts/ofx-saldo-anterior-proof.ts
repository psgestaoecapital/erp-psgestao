// Prova do adendo #1541 "Saldo Anterior" (OFX sintético — nenhum dado real).
// Verifica:
//   (1) ehLinhaSaldoOFX classifica corretamente linhas de saldo vs movimentos de verdade;
//   (2) num OFX SEM <LEDGERBAL> mas COM linha "SALDO ANTERIOR", a linha NÃO vira movimento e a
//       linha de saldo mais recente vira o fallback do saldo de fechamento (sinal contábil);
//   (3) quando há <LEDGERBAL>, ele tem prioridade sobre a linha de saldo.
// Roda com: npx tsx scripts/ofx-saldo-anterior-proof.ts
import { parseOFX, ehLinhaSaldoOFX, parseSaldoFechamento } from '../src/lib/ofx-parser'

let pass = 0, fail = 0
function check(nome: string, cond: boolean, detalhe = '') {
  if (cond) { pass++; console.log(`  ✅ ${nome}`) }
  else { fail++; console.log(`  ❌ ${nome} ${detalhe}`) }
}

console.log('\n=== (1) ehLinhaSaldoOFX — classificação ===')
// É saldo (NÃO deve virar movimento):
for (const s of ['SALDO', 'SALDO ANTERIOR', 'Saldo do dia', 'SALDO ANTERIOR 1.234,56',
                 'saldo   anterior', 'SALDO 123456', 'Saldo Dia']) {
  check(`saldo: "${s}"`, ehLinhaSaldoOFX(s) === true)
}
// NÃO é saldo (movimento de verdade — deve ser mantido):
for (const s of ['SALDO REMUNERADO', 'SALDO DEVEDOR', 'APLIC SALDO', 'RESGATE SALDO REMUNERADO',
                 'PIX ENVIADO', 'TED RECEBIDA', 'PAGAMENTO FORNECEDOR', 'SALDOS APLICADOS']) {
  check(`movimento: "${s}"`, ehLinhaSaldoOFX(s) === false)
}

// Replica a lógica de importarOFX (filtro + fallback) sobre a saída do parser.
function importarSimulado(text: string) {
  const brutos = parseOFX(text).movimentos
  const linhasSaldo = brutos.filter((m) => ehLinhaSaldoOFX(m.descricao))
  const movimentos = brutos.filter((m) => !ehLinhaSaldoOFX(m.descricao))
  const saldo = parseSaldoFechamento(text)
  let saldoLinha: { valor: number; dataISO: string; descricao: string } | null = null
  if (!saldo.presente && linhasSaldo.length > 0) {
    let melhor = linhasSaldo[0]
    for (const l of linhasSaldo) if (l.data_transacao >= melhor.data_transacao) melhor = l
    const valorAssinado = melhor.natureza === 'debito' ? -melhor.valor : melhor.valor
    saldoLinha = { valor: valorAssinado, dataISO: `${melhor.data_transacao}T00:00:00`, descricao: melhor.descricao }
  }
  const saldoValor = saldo.presente ? saldo.valor : (saldoLinha ? saldoLinha.valor : null)
  const origem = saldo.presente ? 'ofx' : (saldoLinha ? 'ofx_saldo_linha' : null)
  return { movimentos, linhasSaldo, saldoValor, origem, saldoDataISO: saldo.presente ? saldo.dataISO : (saldoLinha?.dataISO ?? null) }
}

console.log('\n=== (2) OFX SEM LEDGERBAL, COM linha "SALDO ANTERIOR" (fallback) ===')
const ofxLinha = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>OTHER</TRNTYPE><DTPOSTED>20260901</DTPOSTED><TRNAMT>1500.00</TRNAMT><FITID>S1</FITID><MEMO>SALDO ANTERIOR</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260902</DTPOSTED><TRNAMT>-200.50</TRNAMT><FITID>M1</FITID><MEMO>PIX ENVIADO</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260903</DTPOSTED><TRNAMT>800.00</TRNAMT><FITID>M2</FITID><MEMO>TED RECEBIDA</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>OTHER</TRNTYPE><DTPOSTED>20260903</DTPOSTED><TRNAMT>2099.50</TRNAMT><FITID>S2</FITID><MEMO>SALDO DO DIA</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
const r1 = importarSimulado(ofxLinha)
check('2 linhas de saldo detectadas', r1.linhasSaldo.length === 2)
check('só 2 movimentos reais importados', r1.movimentos.length === 2, `(veio ${r1.movimentos.length})`)
check('movimentos NÃO contêm "SALDO"', r1.movimentos.every((m) => !/SALDO/i.test(m.descricao)))
check('fallback usa origem ofx_saldo_linha', r1.origem === 'ofx_saldo_linha', `(veio ${r1.origem})`)
check('saldo = linha mais recente (2099.50)', r1.saldoValor === 2099.50, `(veio ${r1.saldoValor})`)
check('data do saldo = 2026-09-03', r1.saldoDataISO === '2026-09-03T00:00:00', `(veio ${r1.saldoDataISO})`)

console.log('\n=== (3) OFX COM LEDGERBAL — tem prioridade ===')
const ofxLedger = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>OTHER</TRNTYPE><DTPOSTED>20260901</DTPOSTED><TRNAMT>1500.00</TRNAMT><FITID>S1</FITID><MEMO>SALDO ANTERIOR</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260902</DTPOSTED><TRNAMT>-200.50</TRNAMT><FITID>M1</FITID><MEMO>PIX ENVIADO</MEMO></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>9999.99</BALAMT><DTASOF>20260902</DTASOF></LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
const r2 = importarSimulado(ofxLedger)
check('linha SALDO ANTERIOR ainda é filtrada', r2.movimentos.length === 1 && r2.movimentos[0].descricao.includes('PIX'))
check('origem = ofx (LEDGERBAL tem prioridade)', r2.origem === 'ofx', `(veio ${r2.origem})`)
check('saldo = LEDGERBAL 9999.99', r2.saldoValor === 9999.99, `(veio ${r2.saldoValor})`)

console.log('\n=== (extra) linha de saldo com débito → sinal negativo ===')
const ofxNeg = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>OTHER</TRNTYPE><DTPOSTED>20260905</DTPOSTED><TRNAMT>-350.00</TRNAMT><FITID>S9</FITID><MEMO>SALDO</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260905</DTPOSTED><TRNAMT>10.00</TRNAMT><FITID>M9</FITID><MEMO>TARIFA ESTORNO</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
const r3 = importarSimulado(ofxNeg)
check('saldo negativo preservado (-350)', r3.saldoValor === -350, `(veio ${r3.saldoValor})`)
check('1 movimento real (TARIFA)', r3.movimentos.length === 1)

console.log(`\n=== RESULTADO: ${pass} passaram, ${fail} falharam ===`)
process.exit(fail === 0 ? 0 : 1)

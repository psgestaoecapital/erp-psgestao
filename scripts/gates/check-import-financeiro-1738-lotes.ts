// Gate (chamado #1738 · Troian): a migração financeira em massa envia em LOTES (1295 linhas numa RPC só estouravam o
// statement_timeout). Roda no build, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const tela = readFileSync('src/components/financeiro/ImportMigracaoFinanceiraCard.tsx', 'utf8')
ok(/const LOTE_IMPORT = \d+/.test(tela), 'tamanho do lote definido')
ok(/records\.slice\(i, i \+ LOTE_IMPORT\)/.test(tela), 'a RPC recebe só uma fatia dos registros')
ok(!/p_records: records,/.test(tela), 'não manda todos os registros numa chamada só')
ok(/linha: \(e\.linha \?\? 0\) \+ i/.test(tela), 'a linha do erro é somada ao deslocamento do lote')
ok(/suba a planilha de novo/.test(tela), 'falha no meio diz o que já entrou e que reenviar não duplica')

if (falhas) { console.error(`\n${falhas} falha(s) (#1738)`); process.exit(1) }
console.log('\nImportação em lotes (#1738): ok')

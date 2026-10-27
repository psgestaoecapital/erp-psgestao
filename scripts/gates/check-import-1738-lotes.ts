// Gate (chamado #1738 · Troian): a importação de planilha financeira manda as linhas em lotes ao banco (um RPC com a
// planilha inteira estourava o statement_timeout). Roda no build, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const rota = readFileSync('src/app/api/import/universal/route.ts', 'utf8')
ok(/TAM_LOTE\s*=\s*\d+/.test(rota), 'a importação define o tamanho do lote')
ok(/for \(let ini = 0; ini < records\.length; ini \+= TAM_LOTE\)[\s\S]{0,400}fn_import_universal_dispatch/.test(rota), 'o dispatch é chamado por lote, não com a planilha inteira')
ok(/p_records: records\.slice\(ini, ini \+ TAM_LOTE\)/.test(rota), 'cada chamada leva só a fatia do lote')
ok(/\(e\.linha \?\? 0\) \+ ini/.test(rota), 'a linha do erro continua referindo a planilha inteira')

if (falhas) { console.error(`\n${falhas} falha(s) na importação em lotes (#1738)`); process.exit(1) }
console.log('\nImportação em lotes (#1738): ok')

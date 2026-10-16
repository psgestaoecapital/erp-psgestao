/**
 * Gate: PR em conflito (update-branch falha) NÃO ocupa vaga do teto de preparo da fila (CEO 16/10).
 * Incidente: 4 PRs com conflito incrementavam em_preparo antes do update-branch e travavam 7 PRs prontas ("teto 4").
 *   tsx scripts/gates/check-fila-conflito-nao-ocupa-vaga.ts
 */
import { readFileSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const sh = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
const ini = sh.indexOf('if [ "$atras" -gt 0 ]; then')
const fim = sh.indexOf('# (b) só PR COM migration', ini)
const bloco = ini >= 0 && fim > ini ? sh.slice(ini, fim) : ''

ok(bloco.length > 0, 'bloco "atrás da main" localizado em fila-merge.sh')
const iUpdate = bloco.indexOf('update-branch')
const iThen = bloco.indexOf('; then', iUpdate)
const iIncr = bloco.indexOf('em_preparo=$((em_preparo + 1))')
const iElse = bloco.indexOf('else', iThen)
ok(iIncr > iThen && iIncr < iElse, 'em_preparo só incrementa dentro do ramo de sucesso do update-branch')
ok(bloco.split('em_preparo=$((em_preparo + 1))').length === 2, 'um único incremento no bloco')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nconflito não ocupa vaga: OK')

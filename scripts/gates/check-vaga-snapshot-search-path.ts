// Gate (Eng. Chefe 19/10, esteira parada) — o restore.sql da vaga recriava view/função/índice que usa pg_trgm
// (similarity) sem extensions no search_path → "function similarity(text,text) does not exist" 2x → vaga 0 SUJA.
// Infra de teste apenas (sem produção).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const sh = readFileSync('scripts/banco-testes/vaga-snapshot.sh', 'utf8')
const i = sh.indexOf('txn="$dir/restore.sql"')
const f = sh.indexOf('# 1) DROP do que a PR criou')
const cab = sh.slice(i, f)
ok(i > 0 && f > i, 'cabeçalho do restore.sql localizado')
ok(/set local search_path = public, extensions, pg_catalog;/.test(cab), 'restore.sql define search_path com extensions (pg_trgm) dentro da transação')
ok(cab.indexOf('begin;') < cab.indexOf('set local search_path'), 'search_path é SET LOCAL depois do begin (não vaza para a sessão)')

// 20/10: a conferência (verify-before-commit) precisa rodar com o search_path PADRÃO, o mesmo da foto — senão
// column_default/pg_get_*def mudam de texto e a vaga "não volta à foto" (1166 diferenças em col) em toda PR com migration.
const v = sh.indexOf('# 5) VERIFY-BEFORE-COMMIT')
const verif = sh.slice(v)
ok(v > 0, 'bloco de conferência localizado')
const iDef = verif.indexOf('set local search_path to default;')
const iAgora = verif.indexOf('create temp table _agora')
ok(iDef > 0 && iAgora > iDef, 'conferência volta ao search_path padrão (o da foto) antes de calcular a assinatura atual')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-vaga-snapshot-search-path: OK')

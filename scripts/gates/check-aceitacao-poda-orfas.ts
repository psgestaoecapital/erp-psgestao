// Gate (20/10, gilberto-desenv): a vaga 0 abortava a aceitação em segundos no `db push` de sincronização com a main por
// órfão de ledger (RD-52; versão sem arquivo, p.ex. migration renumerada pela fila depois de testada na vaga). A poda do
// ledger do banco de TESTES roda antes de cada sync da main em aceitacao-pr.yml. Sem rede/banco.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗ ' + msg) } else console.log('✓ ' + msg) }
const wf = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8').replace(/^\s*#.*$/gm, '')
const poda = 'scripts/banco-testes/podar-orfas-ledger.sh'
const push = 'cd "$mmain" && supabase db push --include-all --db-url "$TEST_DATABASE_URL"'
let i = 0, n = 0
while ((i = wf.indexOf(push, i)) >= 0) {
  n++
  const antes = wf.slice(Math.max(0, i - 400), i)
  ok(antes.includes(poda) && antes.includes('MIGR_DIR="$mmain/supabase/migrations"'), `aceitacao-pr: sync da main #${n} poda o ledger antes do db push`)
  i += push.length
}
ok(n === 2, 'aceitacao-pr: 2 syncs da main com poda')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-aceitacao-poda-orfas: ok')

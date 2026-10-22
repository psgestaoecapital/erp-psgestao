// Gate (20/10, gilberto-desenv): a aceitação poda o ledger da vaga (versão sem arquivo, RD-52) ANTES de cada db push da
// main, cortando a fonte da órfã que re-sujava a vaga 0 (PR renumerada/refeita deixa versão abaixo do max). Sem rede/banco.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗ ' + msg) } else console.log('✓ ' + msg) }
const y = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8').replace(/^\s*#.*$/gm, '')
const poda = 'scripts/banco-testes/podar-orfas-ledger.sh'
const push = 'supabase db push --include-all --db-url "$TEST_DATABASE_URL" )'
const nPoda = y.split(poda).length - 1
ok(nPoda >= 2, 'aceitacao-pr: poda em ao menos 2 pontos (referência e sync da main)')
let i = 0, antes = true
while ((i = y.indexOf('cd "$mmain" && supabase db push', i)) >= 0) {
  const ult = y.lastIndexOf(poda, i)
  const passo = y.lastIndexOf('- name:', i)
  if (!(ult > passo)) antes = false
  i += 10
}
ok(antes, 'aceitacao-pr: todo db push da main é precedido da poda no mesmo passo')
void push
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-aceitacao-poda-orfas: ok')

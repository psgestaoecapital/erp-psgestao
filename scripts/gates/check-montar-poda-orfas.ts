// Gate (20/10, gilberto-desenv): o Montar em workflow_run falhava ~50% ("Remote migration versions not found", órfão
// apply-time no ledger da vaga 0, RD-52) e abortava catálogos/semente/fn_demo_reset. O passo de migrations novas poda
// antes o ledger do banco de TESTES (toda versão sem arquivo no repo, acima ou abaixo da maior), com trava contra a produção. Sem rede/banco.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗ ' + msg) } else console.log('✓ ' + msg) }
const montar = readFileSync('.github/workflows/montar-banco-testes.yml', 'utf8')
const sh = readFileSync('scripts/banco-testes/podar-orfas-ledger.sh', 'utf8')

const ini = montar.indexOf('- name: Migrations novas (aplica só as pendentes no banco da vaga)')
const fim = montar.indexOf('- name:', ini + 10)
const passo = ini >= 0 ? montar.slice(ini, fim > ini ? fim : undefined).replace(/^\s*#.*$/gm, '') : ''
ok(passo.length > 0, 'montar: passo de migrations novas existe')
const iPoda = passo.indexOf('scripts/banco-testes/podar-orfas-ledger.sh')
const iPush = passo.indexOf('supabase db push --include-all --db-url "$TEST_DATABASE_URL"')
ok(iPoda >= 0 && iPush > iPoda, 'montar: poda o ledger ANTES do db push')
ok(/\*horsymhsinqcimflrtjo\*\) echo "::error::[^\n]*PRODUÇÃO — abortado"; exit 1;;/.test(sh), 'poda: trava de PRODUÇÃO aborta')
ok(/pooler\.supabase\.com/.test(sh), 'poda: exige Session pooler')
ok(/where version not in \(\$lista\)/.test(sh) && !/version <= '\$max'/.test(sh), 'poda: só versão sem arquivo no repo (acima ou abaixo da maior)')
ok(!/truncate|drop /i.test(sh), 'poda: sem TRUNCATE/DROP')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-montar-poda-orfas: ok')

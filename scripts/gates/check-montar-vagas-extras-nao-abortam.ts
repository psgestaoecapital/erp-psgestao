// Gate (19/10, gilberto-desenv): o passo "Migrations novas nas vagas extras provisionadas" do Montar roda sob a trava
// da vaga 0 (aceitacao-testes), não sob a das vagas 1/2. Com uma aceitação de PR no meio da vaga 2, o db push via a
// migration da PR ("Remote migration versions not found") e abortava o Montar inteiro (8 de 9 Montar de 19/10 08:50–12:50):
// sem catálogos/semente/fn_demo_reset na vaga 0, sem aceitação da main e com o regime de construção desligado.
// Regra: falha de db push numa vaga extra é AVISO (o Montar segue); as travas de produção/pooler continuam abortando; e
// cada vaga continua se sincronizando com a main sob a própria trava antes de testar. Sem rede, banco ou variável.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗ ' + msg) } else console.log('✓ ' + msg) }
const ler = (f: string) => readFileSync(f, 'utf8')

const montar = ler('.github/workflows/montar-banco-testes.yml')
const pr = ler('.github/workflows/aceitacao-pr.yml')
const main = ler('.github/workflows/aceitacao-main.yml')

const ini = montar.indexOf('- name: Migrations novas nas vagas extras provisionadas')
const fim = montar.indexOf('- name:', ini + 10)
const passo = ini >= 0 ? montar.slice(ini, fim > ini ? fim : undefined).replace(/^\s*#.*$/gm, '') : ''
ok(passo.length > 0, 'montar-banco-testes: passo das vagas extras existe')

const linhas = passo.split('\n').map((l) => l.trim())
const push = linhas.filter((l) => /supabase db push/.test(l))
ok(push.length === 1 && /^if ! supabase db push --include-all --db-url "\$u"; then$/.test(push[0]),
  'vagas extras: db push dentro de "if ! …; then" (falha não aborta o Montar da vaga 0)')
ok(/::warning title=Vaga \$v::/.test(passo), 'vagas extras: falha do db push vira ::warning com a vaga')
ok(!/supabase db push[^\n]*\|\|\s*exit/.test(passo) && !/set -e/.test(passo), 'vagas extras: sem set -e nem "|| exit" no db push')
ok(/\*horsymhsinqcimflrtjo\*\) echo "::error::vaga \$v aponta para a PRODUÇÃO — abortado"; exit 1;;/.test(passo),
  'vagas extras: trava de PRODUÇÃO continua abortando')
ok(/\*pooler\.supabase\.com\*\) ;; \*\) echo "::error::vaga \$v: precisa ser Session pooler"; exit 1;;/.test(passo),
  'vagas extras: trava de Session pooler continua abortando')

// a vaga extra se sincroniza com a main sob a PRÓPRIA trava antes de testar — é o que torna o aviso seguro
ok(/sincronizando a vaga \$\{ACEITACAO_VAGA:-0\} SÓ com a main/.test(pr) && /supabase db push --include-all --db-url "\$TEST_DATABASE_URL"/.test(pr),
  'aceitacao-pr: sincroniza a vaga com a main (db push) antes dos testes')
ok(/group: aceitacao-testes-1\s*\n/.test(main) && /supabase db push --include-all --db-url "\$TEST_DATABASE_URL"/.test(main),
  'aceitacao-main: sincroniza a vaga 1 com a main (db push) sob a trava aceitacao-testes-1')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-montar-vagas-extras-nao-abortam: ok')

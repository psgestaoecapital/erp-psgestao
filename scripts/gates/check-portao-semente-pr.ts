// Gate (INFRA-TESTES slice 1, erp_contexto_projeto f076af2d) — o portão de semente no PR é ADITIVO e SEGURO: roda num banco
// efêmero local (127.0.0.1), nunca na produção nem nas vagas de aceitação, e a única mudança no catalogos.sh é um desvio
// opt-in que só aceita destino local. Checagem estática.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const wf = readFileSync('.github/workflows/portao-semente-pr.yml', 'utf8')
ok(/pull_request:/.test(wf) && /supabase\/migrations\/\*\*/.test(wf), 'dispara em PR que toca migration/banco-testes')
ok(/TEST_DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:54322/.test(wf), 'destino fixo no banco efêmero local (127.0.0.1)')
ok(!/secrets\.TEST_DATABASE_URL/.test(wf) && !/aceitacao-testes/.test(wf), 'não usa banco/fila de aceitação compartilhados')
ok(/supabase start/.test(wf) && /smoke\.sh/.test(wf) && /catalogos\.sh/.test(wf), 'sobe o banco do zero, carrega catálogos e roda o smoke')
ok(/head\.repo\.full_name == github\.repository/.test(wf), 'só PR do próprio repositório (segredo de leitura)')

const sm = readFileSync('scripts/banco-testes/smoke.sh', 'utf8')
ok(/127\.0\.0\.1/.test(sm) && /só roda em banco local efêmero/.test(sm), 'smoke.sh recusa destino que não seja local')
ok(/fn_demo_reset/.test(sm) && /semente\.sql/.test(sm) && /exit 1/.test(sm), 'smoke roda semente + fn_demo_reset e falha se quebrar')

const cat = readFileSync('scripts/banco-testes/catalogos.sh', 'utf8')
ok(/BANCO_EFEMERO_LOCAL:-0\}" = 1/.test(cat) && /127\.0\.0\.1:/.test(cat), 'catalogos.sh: desvio opt-in aceita SÓ destino local')
ok(/\*"\$PROD_REF"\*\) erro "TEST_DATABASE_URL aponta para a PRODUÇÃO/.test(cat), 'catalogos.sh: a produção continua recusada como destino')

if (falhas) { console.error(`\ncheck-portao-semente-pr: ${falhas} falha(s)`); process.exit(1) }
console.log('\nPortão de semente no PR: ok')

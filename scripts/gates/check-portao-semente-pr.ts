// Gate (INFRA-TESTES slice 1) — Portão de semente no PR: ADITIVO, em Postgres efêmero, nunca vaga nem produção.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const wf = readFileSync('.github/workflows/portao-semente-pr.yml', 'utf8')
const sh = readFileSync('scripts/banco-testes/smoke.sh', 'utf8')
const cat = readFileSync('scripts/banco-testes/catalogos.sh', 'utf8')

ok(/pull_request:/.test(wf) && /supabase\/migrations\/\*\*/.test(wf), 'roda em PR que toca migrations/semente')
ok(/head\.repo\.full_name == github\.repository/.test(wf), 'só PR do próprio repo (fork não tem segredos)')
ok(/127\.0\.0\.1:54322/.test(wf) && !/secrets\.TEST_DATABASE_URL/.test(wf), 'banco efêmero local — não usa segredo de vaga')
ok(!/aceitacao-testes/.test(wf.replace(/#.*$/gm, '')), 'fora da fila aceitacao-testes (não disputa vaga)')
ok(/continue-on-error: true/.test(wf), 'estágio 1 informativo (continue-on-error) — não derruba a PR')
ok(/db push --include-all/.test(wf), 'schema por migrations (db push --include-all)')
ok(/smoke\.sh/.test(wf), 'chama o smoke')
ok(/127\.0\.0\.1/.test(sh) && /horsymhsinqcimflrtjo/.test(sh), 'smoke recusa destino não-local e a produção')
ok(/fn_demo_reset/.test(sh) && /epi_catalogo/.test(sh) && /exit 1/.test(sh), 'smoke roda fn_demo_reset, confere semente e falha alto')
ok(/DESTINO_EFEMERO_LOCAL/.test(cat) && /127\.0\.0\.1/.test(cat), 'catalogos.sh aceita só destino local quando DESTINO_EFEMERO_LOCAL=1')

if (falhas) { console.error(`\ncheck-portao-semente-pr: ${falhas} falha(s)`); process.exit(1) }

// Gate (Onda INFRA-TESTES · Slice 1): o portão de semente da PR existe, é aditivo e tem as travas.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const wf = readFileSync('.github/workflows/portao-semente-pr.yml', 'utf8')
const sh = readFileSync('scripts/banco-testes/smoke.sh', 'utf8')
ok(/pull_request:/.test(wf) && /draft == false/.test(wf), 'workflow roda em PR Ready (draft não gasta runner)')
ok(/supabase start/.test(wf) && /smoke\.sh/.test(wf), 'sobe banco local e roda o smoke')
ok(!/secrets\./.test(wf), 'sem segredo: não toca produção nem banco de testes')
ok(!/horsymhsinqcimflrtjo/.test(wf.replace(/#.*$/gm, '')) , 'workflow não referencia a produção fora de comentário')
ok(sh.includes('127.0.0.1') && /PROD_REF/.test(sh), 'smoke recusa banco que não seja local / produção')
ok(/semente\.sql/.test(sh) && /for i in 1 2/.test(sh), 'smoke planta a semente 2x (idempotência)')
ok((sh.match(/b0700000|ded00000/g) ?? []).length >= 6, 'smoke tem 1 asserção por vertical (6 empresas DEMO)')
ok(/SMOKE_ESTRITO/.test(sh), 'fn_demo_reset informativo até o Slice 3 (SMOKE_ESTRITO liga a falha)')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nPortão de semente PR: ok')

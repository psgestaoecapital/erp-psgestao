// Gate (CEO 07/10) — acionar-revisor.yml: o revisor age por evento, sem checkout nem execução de código da PR.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const y = readFileSync('.github/workflows/acionar-revisor.yml', 'utf8')
const semComentario = y.replace(/^\s*#.*$/gm, '')
ok(/on:\s*\n\s*pull_request_target:\s*\n\s*types:\s*\[labeled, synchronize, ready_for_review\]/.test(semComentario), 'pull_request_target [labeled, synchronize, ready_for_review]')
ok(!/\n\s+pull_request:/.test(semComentario), 'não usa pull_request (roda o código da main)')
ok(/!github\.event\.pull_request\.draft/.test(semComentario) && /head\.repo\.full_name == github\.repository/.test(semComentario)
  && /contains\(github\.event\.pull_request\.labels\.\*\.name, 'revisao-eng-chefe'\)/.test(semComentario), 'só PR não draft, do próprio repo, com revisao-eng-chefe')
ok(/cancel-in-progress: true/.test(semComentario) && /group: acionar-revisor/.test(semComentario) && /sleep 120/.test(semComentario), 'concurrency cancel-in-progress + sleep 120')
const checkouts = [...semComentario.matchAll(/uses: actions\/checkout@[^\n]*\n((?:\s+with:\n(?:\s+[^\n]*\n)*)?)/g)]
ok(checkouts.length === 1 && /ref: \$\{\{ github\.event\.pull_request\.base\.ref \}\}/.test(checkouts[0][1])
  && !/head\.(sha|ref)/.test(checkouts[0][1]), 'o único checkout é o da BASE (nunca o head da PR)')
ok(!/\$\{\{\s*github\.event\.pull_request\.(title|body|head\.ref)/.test(semComentario), 'texto da PR nunca interpolado no shell')
ok(/scripts\/merge\/patch-id\.sh/.test(semComentario) && /MERGE AUTORIZADO #\$N/.test(semComentario), 'não aciona se já há MERGE AUTORIZADO com o patch-id atual')
ok(/Authorization: Bearer \$REVISOR_ROTINA_TOKEN/.test(semComentario) && /anthropic-beta: experimental-cc-routine-2026-04-01/.test(semComentario)
  && /anthropic-version: 2023-06-01/.test(semComentario) && /aguardando revisão \(evento \$EVENTO\)/.test(semComentario), 'POST no formato do fn_agente_acionar')
ok(/secrets\.REVISOR_ROTINA_URL/.test(semComentario) && /secrets\.REVISOR_ROTINA_TOKEN/.test(semComentario), 'segredos REVISOR_ROTINA_URL / REVISOR_ROTINA_TOKEN')
ok(/::warning[^\n]*\n?[^\n]*REVISOR_ROTINA/.test(semComentario) && /exit 0/.test(semComentario) && !/\bexit 1\b/.test(semComentario), 'segredo ausente = warning, nunca falha a PR')
ok(/acionar-revisor\.yml/.test(readFileSync('AGENTS.md', 'utf8')), 'AGENTS.md documenta o acionar-revisor.yml')

if (falhas) { console.error(`\n${falhas} falha(s) em acionar-revisor`); process.exit(1) }
console.log('\nAcionar revisor: ok')

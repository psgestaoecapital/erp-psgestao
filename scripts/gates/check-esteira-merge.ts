/**
 * Gate de build (CEO 06/10 "destravar a esteira"): lógica das novas regras de merge + workflows.
 *   1) run @pos-migration CANCELADO sem verde → re-roda; verde em qualquer commit desde a migration → libera; vermelho bloqueia;
 *   2) PR sem arquivo em supabase/migrations não espera o @pos-migration;
 *   3) autorização por CONTEÚDO: id igual após atualizar com a main; muda se o código muda; só vale de OWNER/MEMBER;
 *   4) fila: ordem de chegada, um por vez; workflows sem GraphQL, com concurrency única e sem checkout de código da PR.
 *   npm run gates -- esteira-merge
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { autorizada, decidirPosMigration, idConteudo, ordemFila, resumirChecks, temMigration } from '../esteira/logica'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const run = (id: number, status: string, conclusion: string | null, head_sha = 'a') => ({ id, head_sha, status, conclusion })

// (1) @pos-migration
ok(decidirPosMigration([run(2, 'completed', 'cancelled'), run(1, 'completed', 'success')]).acao === 'liberado', 'verde em algum commit desde a migration libera')
const rr = decidirPosMigration([run(7, 'completed', 'cancelled')])
ok(rr.acao === 'rerun' && rr.runId === 7, 'cancelado sem verde → re-rodar o run cancelado')
ok(decidirPosMigration([run(8, 'completed', 'failure')]).acao === 'bloqueado', 'vermelho de verdade bloqueia (reverter, não re-rodar)')
ok(decidirPosMigration([run(9, 'in_progress', null)]).acao === 'esperar', 'em andamento espera')
ok(decidirPosMigration([]).acao === 'esperar', 'sem run ainda espera')
// (2) PR sem migration
ok(!temMigration(['src/app/x.ts', '.github/workflows/a.yml']), 'PR sem migration não espera o @pos-migration')
ok(temMigration(['supabase/migrations/20261006120000_x.sql']), 'PR com migration espera')
// (3) autorização por conteúdo
const diff = (ctx: string, base: string) => `diff --git a/f.ts b/f.ts\nindex ${base}..2222222 100644\n--- a/f.ts\n+++ b/f.ts\n@@ -${ctx},3 +${ctx},3 @@\n ctx ${ctx}\n-velho\n+novo\n`
const id1 = idConteudo(diff('10', '1111111'))
ok(id1 === idConteudo(diff('99', '3333333')), 'atualizar com a main (contexto/índice/linha mudam) mantém o id')
ok(id1 !== idConteudo(diff('10', '1111111').replace('+novo', '+outro')), 'mudar o código da PR muda o id')
const com = (body: string, a = 'OWNER') => ({ body, author_association: a })
ok(autorizada(id1, [com(`MERGE AUTORIZADO #5 · patch-id: \`${id1}\``)], 5, []), 'comentário do dono com o id atual autoriza')
ok(!autorizada(id1, [com(`MERGE AUTORIZADO #5 · patch-id: \`${'0'.repeat(40)}\``)], 5, []), 'id antigo (código mudou) não autoriza')
ok(!autorizada(id1, [com(`MERGE AUTORIZADO #5 · patch-id: \`${id1}\``, 'NONE')], 5, []), 'comentário de quem não é OWNER/MEMBER não vale')
ok(!autorizada(id1, [com(`MERGE AUTORIZADO #6 · patch-id: \`${id1}\``)], 5, []), 'autorização de outra PR não vale')
ok(autorizada(id1, [], 5, ['autorizada-rd-94-1']), 'label de categoria RD-94.1 autoriza')
// (4) fila
const f = ordemFila([
  { number: 3, draft: false, labels: ['fila-merge'], filaDesde: '2026-10-06T12:00:00Z' },
  { number: 1, draft: false, labels: ['fila-merge'], filaDesde: '2026-10-06T10:00:00Z' },
  { number: 2, draft: true, labels: ['fila-merge'], filaDesde: '2026-10-06T09:00:00Z' },
  { number: 4, draft: false, labels: [], filaDesde: '2026-10-06T08:00:00Z' },
])
ok(f.map((p) => p.number).join() === '1,3', 'fila por ordem de chegada, sem draft nem PR sem label')
ok(resumirChecks([{ name: 'a', status: 'completed', conclusion: 'success' }, { name: 'b', status: 'completed', conclusion: 'skipped' }]).ok, 'checks verdes/skipped = ok')
ok(!resumirChecks([{ name: 'a', status: 'in_progress', conclusion: null }]).ok, 'check pendente não é ok')
ok(!resumirChecks([{ name: 'a', status: 'completed', conclusion: 'cancelled' }]).ok, 'check cancelado não é ok')

const wf = (n: string) => readFileSync(join(__dirname, '../../.github/workflows', n), 'utf8')
const fila = wf('fila-merge.yml')
ok(/concurrency:\s+group: fila-merge\s+cancel-in-progress: false/.test(fila), 'fila-merge: um merge por vez (concurrency única, sem cancelar)')
ok(!/actions\/checkout/.test(fila) || !/pull_request\.head/.test(fila), 'fila-merge não executa código da PR')
ok(/FILA_MERGE_TOKEN/.test(fila), 'fila-merge exige token que dispara os checks (GITHUB_TOKEN não dispara)')
ok(!/gh pr |graphql/.test(fila + wf('pos-migration-rerun.yml')), 'workflows só usam REST (sem gh pr/GraphQL)')
ok(/conclusion == 'cancelled'/.test(wf('pos-migration-rerun.yml')), 'pos-migration-rerun reage a run cancelado')

if (falhas) { console.error(`\n[check-esteira-merge] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-esteira-merge] regras da esteira de merge conferidas.')

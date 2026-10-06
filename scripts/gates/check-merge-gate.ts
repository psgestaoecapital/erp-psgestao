/**
 * Gate de build (CEO 06/10, destravar a esteira): regras puras do gate de merge e a fila de merge própria.
 *   1) run @pos-migration CANCELADO = re-rodar (não vermelho); verde existente libera; falha real bloqueia;
 *   2) PR sem migration não espera o @pos-migration;
 *   3) autorização vale pelo patch-id (conteúdo), não pelo SHA; mudar o código invalida; só autorizador listado vale;
 *   4) fila: ordem de chegada, um por vez (concurrency), nunca auto-merge, token próprio (GITHUB_TOKEN não dispara deploy).
 *   npm run gates -- merge-gate
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-ignore módulo .mjs sem tipos
import * as g from '../ci/merge-gate-lib.mjs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const r = (id: number, status: string, conclusion: string | null, t = '2026-10-06T10:00:00Z') => ({ id, status, conclusion, created_at: t })

ok(g.decidirPosMigration({ prTemMigration: false, runs: [r(1, 'completed', 'failure')] }).acao === 'liberar', 'PR sem migration libera mesmo com @pos-migration vermelho')
ok(g.decidirPosMigration({ prTemMigration: true, runs: [r(1, 'completed', 'cancelled'), r(2, 'completed', 'success')] }).acao === 'liberar', 'cancelado + verde existente libera')
const c = g.decidirPosMigration({ prTemMigration: true, runs: [r(1, 'completed', 'cancelled')] })
ok(c.acao === 'rerodar' && c.runId === 1, 'só cancelado → re-roda o run cancelado')
ok(g.decidirPosMigration({ prTemMigration: true, runs: [r(1, 'in_progress', null)] }).acao === 'esperar', 'em andamento espera')
ok(g.decidirPosMigration({ prTemMigration: true, runs: [] }).acao === 'esperar', 'sem run espera')
ok(g.decidirPosMigration({ prTemMigration: true, runs: [r(1, 'completed', 'failure')] }).acao === 'bloquear', 'falha real bloqueia')
ok(g.temMigration(['supabase/migrations/20261006000000_x.sql']) && !g.temMigration(['src/a.ts', '.github/workflows/x.yml']), 'detecta arquivo de migration')

const P = 'a'.repeat(40), Q = 'b'.repeat(40)
const com = (user: string, body: string, t = '2026-10-06T12:00:00Z') => ({ user, body, created_at: t })
const base = { pr: 2100, autorizadores: ['revisor'], patchIdAtual: P }
ok(g.autorizacaoValida({ ...base, comentarios: [com('revisor', `MERGE AUTORIZADO #2100\npatch-id: ${P}`)] }).ok, 'patch-id igual → autorizada (atualizar com a main mantém)')
ok(!g.autorizacaoValida({ ...base, comentarios: [com('revisor', `MERGE AUTORIZADO #2100\npatch-id: ${Q}`)] }).ok, 'patch-id diferente → exige nova revisão')
ok(!g.autorizacaoValida({ ...base, comentarios: [com('intruso', `MERGE AUTORIZADO #2100\npatch-id: ${P}`)] }).ok, 'comentário de quem não é autorizador não vale')
ok(!g.autorizacaoValida({ ...base, comentarios: [com('revisor', `MERGE AUTORIZADO #2100`)] }).ok, 'sem patch-id não vale')
ok(!g.autorizacaoValida({ ...base, comentarios: [com('revisor', `MERGE AUTORIZADO #2101\npatch-id: ${P}`)] }).ok, 'autorização de outra PR não vale')
ok(g.autorizacaoValida({ ...base, comentarios: [com('revisor', `MERGE AUTORIZADO #2100\npatch-id: ${Q}`, '2026-10-06T10:00:00Z'), com('revisor', `MERGE AUTORIZADO #2100\npatch-id: ${P}`)] }).ok, 'vale o comentário mais recente')
ok(g.estadoChecks([{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'skipped' }]) === 'verde', 'checks verdes (skipped conta)')
ok(g.estadoChecks([{ status: 'in_progress', conclusion: null }]) === 'esperar' && g.estadoChecks([{ status: 'completed', conclusion: 'failure' }]) === 'vermelho', 'checks: esperar / vermelho')
ok(g.proximaDaFila([{ n: 2, fila_desde: '2026-10-06T12:00:00Z' }, { n: 1, fila_desde: '2026-10-06T11:00:00Z' }]).n === 1, 'fila por ordem de chegada')

ok(g.somenteWorkflowGatesDocs(['.github/workflows/a.yml','scripts/gates/x.ts','AGENTS.md']) && !g.somenteWorkflowGatesDocs(['src/app/a.tsx','AGENTS.md']) && !g.somenteWorkflowGatesDocs([]), 'RD-94.1(a): só workflow/gates/docs dispensa autorização')

const wf = readFileSync(join(__dirname, '../../.github/workflows/fila-merge.yml'), 'utf8')
ok(/concurrency:\s*\n\s*group: fila-merge/.test(wf) && /cancel-in-progress: false/.test(wf), 'workflow: um por vez (concurrency fila-merge, sem cancelar)')
ok(/secrets\.FILA_MERGE_TOKEN/.test(wf), 'workflow: usa token próprio (GITHUB_TOKEN não dispara o deploy-migrations)')
ok(!/enable_pr_auto_merge|--auto|auto_merge/i.test(wf), 'workflow: nunca auto-merge (RD-94)')

if (falhas) { console.error(`\n[check-merge-gate] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-merge-gate] regras do gate de merge e da fila conferidas.')

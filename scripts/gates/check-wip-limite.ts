// Gate (Eng. Chefe 17/10, tarefa c66b6ea4) — limite de WIP por Code: 3 abertas, 1 em construção; excedeu = limite-wip.
import { readFileSync } from 'node:fs'
import { avaliarTodas, avaliarWip, codeDaPr, type PrWip } from '../merge/wip-limite'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const AGORA = Date.parse('2026-10-17T12:00:00Z')
const H = 3600_000
const pr = (number: number, o: Partial<PrWip> = {}): PrWip => ({
  number, draft: false, labels: [], created_at: new Date(AGORA - (100 - number) * H).toISOString(),
  last_commit_at: new Date(AGORA - 10 * H).toISOString(), body: 'Code: gilberto-chamados', ...o,
})
const excedidas = (l: PrWip[]) => avaliarWip(l, AGORA).filter((v) => v.excede).map((v) => v.number)

ok(codeDaPr('texto\nCode: gilberto-chamados\n🤖') === 'gilberto-chamados' && codeDaPr('sem linha') === null && codeDaPr(null) === null, 'Code do autor sai da linha `Code:` do corpo')
ok(excedidas([pr(1), pr(2), pr(3)]).length === 0, '3 PRs esperando terceiros (commit antigo, prontas): dentro do limite')
ok(excedidas([pr(1), pr(2), pr(3), pr(4)]).join() === '4', '4ª PR aberta do mesmo Code excede (a mais nova)')
ok(excedidas([pr(1, { draft: true }), pr(2, { draft: true })]).join() === '2', '2 rascunhos: só 1 em construção, o 2º excede')
ok(excedidas([pr(1), pr(2, { last_commit_at: new Date(AGORA - 1 * H).toISOString() })]).length === 0, '1 PR com commit na última hora (em construção) + 1 esperando: ok')
ok(excedidas([pr(1, { last_commit_at: new Date(AGORA - 1 * H).toISOString() }), pr(2, { last_commit_at: new Date(AGORA - 30 * 60_000).toISOString() })]).join() === '2',
  '2 PRs com commit nas últimas 2 h sem estar prontas: a 2ª excede')
ok(excedidas([pr(1, { draft: true }), pr(2), pr(3), pr(4)]).join() === '4', '1 construção + 2 esperando + 1 esperando: 4ª excede por quantidade')
ok(excedidas([pr(1), pr(2), pr(3, { draft: true }), pr(4, { draft: true })]).join() === '4', 'rascunho nº 2 excede mesmo com vaga no total')
{
  const m = avaliarTodas([pr(1), pr(2), pr(3), pr(4), pr(5, { body: 'Code: rodrigo-code' }), pr(6, { body: 'sem code' })], AGORA)
  ok((m.get('gilberto-chamados') ?? []).filter((v) => v.excede).length === 1 && !(m.get('rodrigo-code') ?? [{ excede: true }])[0].excede && m.size === 2,
    'Codes diferentes não se misturam; PR sem linha `Code:` fica fora')
}

// o resto do pacote: workflow e a fila que ignora
const wf = readFileSync('.github/workflows/limite-wip.yml', 'utf8')
ok(/pull_request_target/.test(wf) && /wip-limite\.ts/.test(wf) && /limite-wip/.test(wf) && /fn_agente_mensagem_enviar/.test(wf), 'workflow limite-wip: etiqueta e avisa o Code autor')
ok(!/ref: \$\{\{ github\.event\.pull_request\.head/.test(wf), 'workflow limite-wip: nunca faz checkout da PR')
const fila = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
ok(/LIMITE_WIP='limite-wip'/.test(fila) && /\$LIMITE_WIP/.test(fila), 'fila: ignora PR com a label limite-wip')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-wip-limite: OK')

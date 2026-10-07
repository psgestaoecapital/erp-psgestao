// Gate (CEO 07/10) — fila de merge SEM BLOQUEIO PELA CABEÇA. A PR atrás da main é atualizada e a PR com checks rodando
// fica esperando, mas a rodada SEGUE para as próximas (antes dava exit 0 e uma PR lenta segurava todas). Continua:
// no máximo 1 merge por rodada; ordem das migrations preservada; vermelhos de verdade saem da fila.
//
// Parte 1 (sempre): leitura do script. Parte 2 (se houver jq e git, como no Actions e na máquina do Code): roda o
// scripts/merge/fila-merge.sh de verdade contra um `gh` simulado, num repositório git temporário, nos cenários do CEO.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1: estrutura do laço ───────────────────────────────────────────────────────────────────────────────────────
const SCRIPT = resolve('scripts/merge/fila-merge.sh')
const sh = readFileSync(SCRIPT, 'utf8')
const laco = sh.slice(sh.indexOf('for n in $fila; do'))
ok(/SEM BLOQUEIO PELA CABEÇA/.test(sh), 'comentário do topo explica a fila sem bloqueio pela cabeça')
ok(/update-branch"[\s\S]*?\n\s*continue\n\s*fi/.test(laco), 'update-branch bem-sucedido → continue (segue para a próxima)')
ok(/esperar:\*\)[^\n]*\n[\s\S]*?continue;;/.test(laco), '"esperar:*" do estado_checks → continue (segue para a próxima)')
const exits = laco.match(/exit 0/g) ?? []
ok(exits.length === 1 && /MERGEADA[\s\S]*?exit 0/.test(laco), 'no laço, o único exit 0 é depois do merge (no máximo 1 merge por rodada)')
ok((laco.match(/\[ "\$com_migration" = 1 \] && so_sem_migration=1/g) ?? []).length >= 2,
  'PR com migration que fica para trás (atualizando ou esperando) segura as outras COM migration')

// ── Parte 2: cenários de verdade contra um gh simulado ───────────────────────────────────────────────────────────────
const tem = (bin: string) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0
if (!tem('jq') || !tem('git')) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente (a parte 1 continua valendo)')
} else {
  const raiz = mkdtempSync(join(tmpdir(), 'fila-gate-'))
  try {
    const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
    // origem com a main + um commit por PR (refs/pull/N/head); clone onde a fila roda
    const o = join(raiz, 'o'); const w = join(raiz, 'w')
    execFileSync('git', ['init', '-q', '-b', 'main', o])
    for (const [k, v] of [['user.email', 'g@g'], ['user.name', 'gate']]) git(o, 'config', k, v)
    writeFileSync(join(o, 'a'), 'a\n'); git(o, 'add', '.'); git(o, 'commit', '-qm', 'base')
    const sha: Record<number, string> = {}
    for (const n of [1, 2, 3]) {
      git(o, 'checkout', '-q', '-b', `pr${n}`, 'main'); writeFileSync(join(o, `f${n}`), `${n}\n`)
      git(o, 'add', '.'); git(o, 'commit', '-qm', `pr${n}`); sha[n] = git(o, 'rev-parse', 'HEAD')
      git(o, 'update-ref', `refs/pull/${n}/head`, 'HEAD')
    }
    git(o, 'checkout', '-q', 'main'); execFileSync('git', ['clone', '-q', o, w])

    // gh simulado: GET lê <fx>/<caminho normalizado>.json (com --jq aplicado); escrita é registrada e responde {}
    const bin = join(raiz, 'bin'); const fx = join(raiz, 'fx')
    execFileSync('mkdir', ['-p', bin, fx])
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
shift; m=GET; jqe=; path=; campos=()
while [ $# -gt 0 ]; do case "$1" in -X) m=$2; shift 2;; -H) shift 2;; --paginate) shift;; --jq) jqe=$2; shift 2;; -f|-F) campos+=("$2"); shift 2;; *) path=$1; shift;; esac; done
echo "$m $path \${campos[*]}" >> "$FX/chamadas.log"
[ "$m" = GET ] || { echo '{}'; exit 0; }
f="$FX/$(echo "$path" | sed 's/[^A-Za-z0-9]/_/g').json"
[ -f "$f" ] || { echo "SEM FIXTURE: $path" >&2; exit 1; }
if [ -n "$jqe" ]; then jq -r "$jqe" "$f"; else cat "$f"; fi
`)
    chmodSync(join(bin, 'gh'), 0o755)

    const R = 'repos/o/r'
    type Pr = { n: number; atras?: number; checksRodando?: boolean; migration?: boolean }
    const rodar = (prs: Pr[]): { log: string; escritas: string[] } => {
      rmSync(fx, { recursive: true, force: true }); execFileSync('mkdir', ['-p', fx])
      const put = (p: string, v: unknown) => writeFileSync(join(fx, `${p.replace(/[^A-Za-z0-9]/g, '_')}.json`), JSON.stringify(v))
      put(`${R}/issues?state=open&labels=fila-merge&per_page=100`, prs.map((p) => ({ number: p.n, pull_request: {} })))
      prs.forEach((p, i) => {
        put(`${R}/issues/${p.n}/events?per_page=100`, [{ event: 'labeled', label: { name: 'fila-merge' }, created_at: `2026-10-07T10:0${i}:00Z` }])
        put(`${R}/pulls/${p.n}`, { number: p.n, title: `PR ${p.n}`, draft: false, mergeable: true, base: { ref: 'main' },
          head: { sha: sha[p.n], repo: { full_name: 'o/r' } }, labels: [{ name: 'fila-merge' }] })
        put(`${R}/pulls/${p.n}/files`, [{ filename: p.migration ? `supabase/migrations/${p.n}.sql` : `src/${p.n}.ts` }])
        put(`${R}/compare/main...${sha[p.n]}`, { behind_by: p.atras ?? 0 })
        put(`${R}/commits/${sha[p.n]}/check-runs?per_page=100`, { check_runs: [
          { name: 'check_menu', status: p.checksRodando ? 'in_progress' : 'completed', conclusion: p.checksRodando ? null : 'success', details_url: '' },
          { name: 'aceitacao', status: 'in_progress', conclusion: null, details_url: '' }] })
        put(`${R}/commits/${sha[p.n]}/status`, { statuses: [{ context: 'Vercel', state: 'success', description: 'Deployment has completed' }] })
      })
      put(`${R}/actions/workflows/deploy-migrations.yml/runs?branch=main&per_page=1`, { workflow_runs: [{ id: 1, status: 'completed', conclusion: 'success' }] })
      put(`${R}/actions/workflows/aceitacao-pos-migration.yml/runs?branch=main&per_page=1`, { workflow_runs: [{ id: 2, status: 'completed', conclusion: 'success' }] })
      const r = spawnSync('bash', [SCRIPT], { cwd: w, encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FX: fx, GH_TOKEN: 'x', REPO: 'o/r', GITHUB_STEP_SUMMARY: '' } })
      const log = `${r.stdout}${r.stderr}`
      if (r.status !== 0) console.error(log)
      const escritas = readFileSync(join(fx, 'chamadas.log'), 'utf8').split('\n').filter((l) => l && !l.startsWith('GET '))
      return { log, escritas }
    }
    const merges = (e: string[]) => e.filter((l) => /\/merge merge_method/.test(l)).map((l) => Number(l.match(/pulls\/(\d+)\/merge/)?.[1]))
    const updates = (e: string[]) => e.filter((l) => /update-branch/.test(l)).map((l) => Number(l.match(/pulls\/(\d+)\/update-branch/)?.[1]))

    let x = rodar([{ n: 1, checksRodando: true }, { n: 2 }])
    ok(merges(x.escritas).join() === '2', 'cenário: PR 1 esperando + PR 2 pronta → PR 2 mergeada no mesmo run')
    x = rodar([{ n: 1, atras: 2 }, { n: 2 }])
    ok(updates(x.escritas).join() === '1' && merges(x.escritas).join() === '2', 'cenário: PR 1 atrás da main + PR 2 pronta → PR 1 atualizada e PR 2 mergeada')
    x = rodar([{ n: 1, atras: 1 }, { n: 2, atras: 3 }, { n: 3 }])
    ok(updates(x.escritas).join() === '1,2' && merges(x.escritas).join() === '3', 'cenário: duas atrás da main + uma pronta → duas atualizadas no mesmo run e a 3ª mergeada')
    x = rodar([{ n: 1 }, { n: 2 }])
    ok(merges(x.escritas).join() === '1', 'cenário: duas prontas → só 1 merge por run (a 1ª)')
    x = rodar([{ n: 1, atras: 1, migration: true }, { n: 2, migration: true }, { n: 3 }])
    ok(updates(x.escritas).join() === '1' && merges(x.escritas).join() === '3',
      'cenário: migration atrás da main → a outra COM migration não passa à frente; a SEM migration é mergeada')
    x = rodar([{ n: 1, checksRodando: true, migration: true }, { n: 2, migration: true }])
    ok(merges(x.escritas).length === 0 && /espera a main/.test(x.log), 'cenário: migration com checks rodando → a outra COM migration espera')
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

if (falhas) { console.error(`\ncheck-fila-sem-bloqueio: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila de merge sem bloqueio pela cabeça: ok')

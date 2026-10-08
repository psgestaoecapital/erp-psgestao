// Simulador da fila de merge para os gates (check-fila-sem-bloqueio, check-fila-sem-etiqueta): roda o
// scripts/merge/fila-merge.sh DE VERDADE contra um `gh` falso (fixtures em JSON), num repositório git temporário.
// Fica fora de scripts/gates/ (o rodar-gates executa todo arquivo daquela pasta como gate).
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const SCRIPT_FILA = resolve('scripts/merge/fila-merge.sh')
export const temFerramentas = () => ['jq', 'git'].every((b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0)

export type PrSimulada = {
  n: number
  atras?: number
  checksRodando?: boolean
  migration?: boolean
  migrationBaixa?: boolean     // versão da migration NÃO maior que a última da main (incidente 08/10)
  draft?: boolean
  labels?: string[]            // padrão: ['fila-merge'] (como antes da etiqueta opcional)
  comentarios?: string[]       // corpos de comentários já existentes na PR
  aceitacao?: 'success' | 'in_progress'
}
export type Rodada = { log: string; escritas: string[]; status: number }

export function comFilaSimulada<T>(fn: (rodar: (prs: PrSimulada[], mainOcupada?: boolean, cota?: number) => Rodada) => T): T {
  const raiz = mkdtempSync(join(tmpdir(), 'fila-gate-'))
  try {
    const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
    const o = join(raiz, 'o'); const w = join(raiz, 'w')
    execFileSync('git', ['init', '-q', '-b', 'main', o])
    for (const [k, v] of [['user.email', 'g@g'], ['user.name', 'gate']]) git(o, 'config', k, v)
    writeFileSync(join(o, 'a'), 'a\n'); git(o, 'add', '.'); git(o, 'commit', '-qm', 'base')
    const sha: Record<number, string> = {}
    for (const n of [1, 2, 3, 4]) {
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
    const rodar = (prs: PrSimulada[], mainOcupada = false, cota = 5000): Rodada => {
      rmSync(fx, { recursive: true, force: true }); execFileSync('mkdir', ['-p', fx])
      const put = (p: string, v: unknown) => writeFileSync(join(fx, `${p.replace(/[^A-Za-z0-9]/g, '_')}.json`), JSON.stringify(v))
      put(`${R}/pulls?state=open&base=main&per_page=100`, prs.map((p, i) => ({
        number: p.n, title: `PR ${p.n}`, draft: !!p.draft, created_at: `2026-10-07T09:0${i}:00Z`, base: { ref: 'main' },
        head: { sha: sha[p.n], repo: { full_name: 'o/r' } }, labels: (p.labels ?? ['fila-merge']).map((name) => ({ name })) })))
      prs.forEach((p, i) => {
        const labels = p.labels ?? ['fila-merge']
        put(`${R}/issues/${p.n}/events?per_page=100`, labels.includes('fila-merge')
          ? [{ event: 'labeled', label: { name: 'fila-merge' }, created_at: `2026-10-07T10:0${i}:00Z` }] : [])
        put(`${R}/issues/${p.n}/comments`, (p.comentarios ?? []).map((body) => ({ body })))
        put(`${R}/pulls/${p.n}`, { number: p.n, title: `PR ${p.n}`, draft: !!p.draft, mergeable: true, base: { ref: 'main' },
          head: { sha: sha[p.n], repo: { full_name: 'o/r' } }, labels: labels.map((name) => ({ name })) })
        put(`${R}/pulls/${p.n}/files`, [{ status: 'added', filename: p.migration ? `supabase/migrations/${(p.migrationBaixa ? 20261001000000 : 20261009000000) + p.n}_m.sql` : `src/${p.n}.ts` }])
        put(`${R}/git/trees/main:supabase/migrations`, { tree: [{ path: '20261008150005_ultima.sql' }, { path: 'README.md' }] })
        put(`${R}/compare/main...${sha[p.n]}`, { behind_by: p.atras ?? 0 })
        const acc = p.aceitacao ?? 'in_progress'
        put(`${R}/commits/${sha[p.n]}/check-runs?per_page=100`, { check_runs: [
          { name: 'check_menu', status: p.checksRodando ? 'in_progress' : 'completed', conclusion: p.checksRodando ? null : 'success', details_url: '' },
          { name: 'aceitacao', status: acc === 'success' ? 'completed' : 'in_progress', conclusion: acc === 'success' ? 'success' : null, details_url: '' },
          { name: 'gates', status: 'completed', conclusion: 'success', details_url: '' }] })
        put(`${R}/commits/${sha[p.n]}/status`, { statuses: [{ context: 'Vercel', state: 'success', description: 'Deployment has completed' }] })
      })
      put('rate_limit', { resources: { core: { remaining: cota } } })
      put(`${R}/actions/workflows/deploy-migrations.yml/runs?branch=main&per_page=1`,
        { workflow_runs: [{ id: 1, status: mainOcupada ? 'in_progress' : 'completed', conclusion: mainOcupada ? null : 'success' }] })
      put(`${R}/actions/workflows/aceitacao-pos-migration.yml/runs?branch=main&per_page=1`, { workflow_runs: [{ id: 2, status: 'completed', conclusion: 'success' }] })
      const r = spawnSync('bash', [SCRIPT_FILA], { cwd: w, encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FX: fx, GH_TOKEN: 'x', REPO: 'o/r', GITHUB_STEP_SUMMARY: '' } })
      const log = `${r.stdout}${r.stderr}`
      if (r.status !== 0) console.error(log)
      const escritas = readFileSync(join(fx, 'chamadas.log'), 'utf8').split('\n').filter((l) => l && !l.startsWith('GET '))
      return { log, escritas, status: r.status ?? 1 }
    }
    return fn(rodar)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

export const merges = (e: string[]) => e.filter((l) => /\/merge merge_method/.test(l)).map((l) => Number(l.match(/pulls\/(\d+)\/merge/)?.[1]))
export const updates = (e: string[]) => e.filter((l) => /update-branch/.test(l)).map((l) => Number(l.match(/pulls\/(\d+)\/update-branch/)?.[1]))
export const comentariosEm = (e: string[], n: number) => e.filter((l) => l.startsWith(`POST repos/o/r/issues/${n}/comments`))

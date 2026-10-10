// Gate (CEO 10/10, sessão interativa) — prune da fila de aceitação: cancela a vaga única só dos runs MORTOS
// (PR mergeada/fechada ou SHA superado/órfão), nunca da versão viva de PR aberta, do run da main, nem do SHA da própria
// rodada (SELF_SHA). Roda o scripts/merge/aceitacao-prune.sh DE VERDADE contra um `gh` simulado (fixtures em JSON).
// Parte 1: fiação (triagem + vigia chamam o script; "Versão antiga?" cancela versão morta; serialização intacta).
// Parte 2: os cenários de aceitação do CEO.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1: fiação ──────────────────────────────────────────────────────────────────────────────────────────────
const pr = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
const vig = readFileSync('.github/workflows/vigia-runs.yml', 'utf8')
ok(/- name: Liberar vaga[\s\S]*?scripts\/merge\/aceitacao-prune\.sh/.test(pr) && /SELF_SHA: \$\{\{ github\.event\.deployment\.sha \}\}/.test(pr),
  'triagem: passo "Liberar vaga" chama o prune protegendo o SHA da própria rodada (SELF_SHA)')
ok(/scripts\/merge\/aceitacao-prune\.sh/.test(vig), 'vigia: chama o mesmo prune (rede de segurança a cada 10 min)')
ok(/Versão morta[\s\S]*?gh run cancel "\$RUN_ID"/.test(pr) && /\[ -z "\$heads" \] && \[ -n "\$main_head" \] && \[ "\$SHA" != "\$main_head" \]/.test(pr),
  '"Versão antiga?": cancela também a versão MORTA (sem PR aberta e fora da main) antes de rodar 40 min')
ok(/group: \$\{\{ vars\.ACEITACAO_BANCO == 'testes' && 'aceitacao-testes' \|\| 'demo-e2e' \}\}/.test(pr)
  && /cancel-in-progress: false/.test(pr) && /timeout-minutes: 40/.test(pr),
  'NÃO mexe: serialização (demo-e2e/aceitacao-testes), cancel-in-progress:false, timeout-minutes:40')
// o prune protege a versão viva e o SHA próprio
const sh = readFileSync('scripts/merge/aceitacao-prune.sh', 'utf8')
ok(/state==/.test(sh) && /head\.sha==/.test(sh) && /hsha/.test(sh)
  && /\[ "\$hsha" = "\$self_sha" \] && continue/.test(sh) && /\[ "\$hsha" = "\$MAIN_HEAD" \] && continue/.test(sh),
  'prune: mantém versão viva de PR aberta (open & head.sha==hsha), o SHA próprio e o commit da main')

// ── Parte 2: cenários de verdade contra um `gh` simulado ─────────────────────────────────────────────────────────
if (['jq', 'bash'].some((b) => spawnSync('sh', ['-c', `command -v ${b}`]).status !== 0)) {
  console.log('… cenários pulados: jq/bash ausente (a parte 1 continua valendo)')
} else {
  const SCRIPT = resolve('scripts/merge/aceitacao-prune.sh')
  const raiz = mkdtempSync(join(tmpdir(), 'prune-'))
  try {
    const bin = join(raiz, 'bin'); const fx = join(raiz, 'fx')
    mkdirSync(bin); mkdirSync(fx)
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
shift; m=GET; jqe=; path=
while [ $# -gt 0 ]; do case "$1" in -X) m=$2; shift 2;; -H) shift 2;; --jq) jqe=$2; shift 2;; *) path=$1; shift;; esac; done
echo "$m $path" >> "$FX/calls.log"
[ "$m" = GET ] || { echo '{}'; exit 0; }
f="$FX/$(printf '%s' "$path" | sed 's/[^A-Za-z0-9]/_/g').json"
[ -f "$f" ] || { echo "SEM FIXTURE: $path" >&2; exit 1; }
if [ -n "$jqe" ]; then jq -r "$jqe" "$f"; else cat "$f"; fi
`)
    chmodSync(join(bin, 'gh'), 0o755)
    const put = (p: string, v: unknown) => writeFileSync(join(fx, `${p.replace(/[^A-Za-z0-9]/g, '_')}.json`), JSON.stringify(v))
    const R = 'repos/o/r'
    put(`${R}/commits/main`, { sha: 'mainsha' })
    // runs por status: queued leva a maioria; in_progress leva os presos na fila (105 morto, 106 vivo)
    put(`${R}/actions/workflows/aceitacao-pr.yml/runs?status=queued&per_page=100`, { workflow_runs: [101, 102, 103, 104, 107].map((id) => ({ id })) })
    put(`${R}/actions/workflows/aceitacao-pr.yml/runs?status=waiting&per_page=100`, { workflow_runs: [] })
    put(`${R}/actions/workflows/aceitacao-pr.yml/runs?status=in_progress&per_page=100`, { workflow_runs: [105, 106].map((id) => ({ id })) })
    const heads: Record<number, string> = { 101: 'shaMerged', 102: 'shaSuperseded', 103: 'shaLive', 104: 'shaOrphan', 105: 'shaMergedExec', 106: 'shaLiveExec', 107: 'mainsha' }
    for (const [id, s] of Object.entries(heads)) put(`${R}/actions/runs/${id}`, { head_sha: s })
    put(`${R}/commits/shaMerged/pulls`, [{ number: 900, state: 'closed', head: { sha: 'shaNew' } }])
    put(`${R}/commits/shaSuperseded/pulls`, [{ number: 901, state: 'open', head: { sha: 'shaNew' } }])
    put(`${R}/commits/shaLive/pulls`, [{ number: 902, state: 'open', head: { sha: 'shaLive' } }])
    put(`${R}/commits/shaOrphan/pulls`, [])
    put(`${R}/commits/shaMergedExec/pulls`, [{ number: 903, state: 'closed', head: { sha: 'z' } }])
    put(`${R}/commits/shaLiveExec/pulls`, [{ number: 904, state: 'open', head: { sha: 'shaLiveExec' } }])

    const rodar = (env: Record<string, string>) => {
      rmSync(join(fx, 'calls.log'), { force: true })
      const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FX: fx, GH_TOKEN: 'x', REPO: 'o/r', GITHUB_STEP_SUMMARY: '/dev/null', ...env } })
      if (r.status !== 0) console.error(r.stdout, r.stderr)
      let log = ''
      try { log = readFileSync(join(fx, 'calls.log'), 'utf8') } catch { /* vazio */ }
      return [...log.matchAll(/POST repos\/o\/r\/actions\/runs\/(\d+)\/cancel/g)].map((m) => Number(m[1])).sort((a, b) => a - b)
    }

    const cancelados = rodar({})
    ok(cancelados.includes(101), '1) run de PR MERGEADA (fechada) → cancelado na hora (não espera 90 min)')
    ok(cancelados.includes(102), '2) run de SHA SUPERADO (PR aberta, outro head) → cancelado')
    ok(!cancelados.includes(103), '3) run de PR aberta de head ATUAL → NÃO mexe (roda normal)')
    ok(cancelados.includes(104), 'orphan: SHA sem PR → cancelado')
    ok(cancelados.includes(105) && !cancelados.includes(106), 'in_progress: versão morta cancelada (preso na fila), versão viva mantida')
    ok(!cancelados.includes(107), 'main: run do commit da ponta da main → mantido')
    ok(cancelados.join() === '101,102,104,105', `4) só os mortos são cancelados (${cancelados.join() || 'nenhum'})`)

    const comSelf = rodar({ SELF_SHA: 'shaSuperseded', SELF_RUN_ID: '101' })
    ok(!comSelf.includes(102) && !comSelf.includes(101), 'self: a triagem não cancela o próprio SHA nem o próprio run')
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

if (falhas) { console.error(`\ncheck-aceitacao-prune: ${falhas} falha(s)`); process.exit(1) }
console.log('\nAceitação · prune da vaga: ok')

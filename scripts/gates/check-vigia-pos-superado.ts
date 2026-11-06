// Gate (gilberto-desenv 23/10) — o vigia cancela o @pos-migration SUPERADO: run esperando a vez na fila demo-e2e que não
// é o mais novo da main (a fila de merge só olha o mais novo). Roda scripts/merge/pos-superado-cancelar.sh contra um `gh`
// simulado e prova os dois lados: cancela os antigos que esperam; nunca o mais novo nem o que já executa.
import { readFileSync, writeFileSync, mkdtempSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const y = readFileSync('.github/workflows/vigia-runs.yml', 'utf8')
ok(/scripts\/merge\/pos-superado-cancelar\.sh/.test(y), 'vigia chama o pos-superado-cancelar.sh')
ok(/actions: write/.test(y), 'vigia tem actions: write')

// gh simulado: runs do @pos na main (mais novo = 800); 790 e 795 esperam; 780 já executa (job com runner)
const dir = mkdtempSync(join(tmpdir(), 'pos-sup-'))
const log = join(dir, 'cancel.log')
const gh = `#!/usr/bin/env bash
args="$*"
case "$args" in
  *"-X POST"*"/cancel"*) echo "$args" | grep -oE 'runs/[0-9]+' >> "${log}"; exit 0;;
  *"per_page=1"*) echo 800;;
  *"status=pending"*) printf '800\\n790\\n';;
  *"status=queued"*) echo 795;;
  *"status=in_progress"*) echo 780;;
  *"status=waiting"*) ;;
  *"runs/780/jobs"*) echo 1;;
  *"/jobs"*) echo 0;;
esac
`
writeFileSync(join(dir, 'gh'), gh); chmodSync(join(dir, 'gh'), 0o755)
writeFileSync(log, '')
const out = execFileSync('bash', ['scripts/merge/pos-superado-cancelar.sh'], {
  env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_TOKEN: 'x', REPO: 'o/r' }, encoding: 'utf8',
})
const cancelados = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).sort()
ok(cancelados.join(',') === 'runs/790,runs/795', `cancela só os antigos esperando (790, 795) — veio: ${cancelados.join(',') || 'nenhum'}`)
ok(!cancelados.includes('runs/800'), 'nunca cancela o run mais novo')
ok(!cancelados.includes('runs/780'), 'nunca cancela run com job executando')
ok(/2 run\(s\)/.test(out), 'resume a contagem')

if (falhas) { console.error(`\ncheck-vigia-pos-superado: ${falhas} falha(s)`); process.exit(1) }
console.log('\nVigia de @pos superado: ok')

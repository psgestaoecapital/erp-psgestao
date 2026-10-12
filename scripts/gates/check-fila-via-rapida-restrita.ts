// Gate (CEO 12/10, spec infra camada 2) — via rápida só para PR que NÃO toca tela (src/app, src/components), cálculo,
// migration ou RLS/policy (que vive em migration): essas PRs viram via revisada (etiqueta + MERGE AUTORIZADO).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sh = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
const m = sh.match(/^VIA_RAPIDA_PROIBIDA='([^']+)'/m)
ok(!!m, 'fila: padrão VIA_RAPIDA_PROIBIDA definido')
const re = new RegExp(m ? m[1] : '$^')
for (const f of ['src/app/dashboard/x/page.tsx', 'src/components/a/B.tsx', 'supabase/migrations/20261012000000_x.sql', 'src/lib/obra/calculo-custo.ts'])
  ok(re.test(f), `via revisada obrigatória: ${f}`)
for (const f of ['scripts/gates/x.ts', 'e2e/x.spec.ts', 'AGENTS.md', '.github/workflows/x.yml'])
  ok(!re.test(f), `continua via rápida: ${f}`)
ok(/via=revisada[\s\S]{0,300}labels\[\]=\$SENSIVEL/.test(sh) && sh.includes('grep -qE "$VIA_RAPIDA_PROIBIDA" <<< "$arquivos"'),
  'fila: PR que casa o padrão vira revisada e recebe a etiqueta')
process.exit(falhas ? 1 : 0)

// Gate (Eng. Chefe 14/10) — a etiqueta revisao-eng-chefe é posta por CONTEÚDO e a fila nunca publica essas PRs pela via rápida.
import { readFileSync } from 'node:fs'
import { exigeViaRevisada } from '../merge/exige-via-revisada'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

ok(exigeViaRevisada(['supabase/migrations/20261015120030_x.sql', 'src/app/dashboard/financeiro/dre/page.tsx']).revisada, 'migration + tela de financeiro (caso #2592) → revisada')
ok(exigeViaRevisada(['src/app/dashboard/obras/page.tsx']).revisada, 'tela → revisada')
ok(exigeViaRevisada(['src/lib/preco/calculo-markup.ts']).revisada, 'cálculo → revisada')
ok(exigeViaRevisada(['src/lib/nfe/montar-xml.ts']).revisada, 'fiscal/NF-e → revisada')
ok(exigeViaRevisada(['supabase/functions/x/index.ts']).revisada, 'edge function → revisada')
ok(!exigeViaRevisada(['docs/x.md', '.github/workflows/a.yml', 'e2e/jornadas/a.spec.ts']).revisada, 'docs/CI/e2e → via rápida')
ok(!exigeViaRevisada(['scripts/gates/check-x.ts']).revisada, 'só script/gate → via rápida')
ok(!exigeViaRevisada([]).revisada, 'sem arquivos → sem sinal')

const y = readFileSync('.github/workflows/etiquetar-revisao.yml', 'utf8').replace(/^\s*#.*$/gm, '')
ok(/pull_request_target:\s*\n\s*types:\s*\[opened, reopened, synchronize, ready_for_review\]/.test(y) && !/\n\s+pull_request:/.test(y), 'pull_request_target (código da main)')
const co = [...y.matchAll(/uses: actions\/checkout@[^\n]*\n((?:\s+with:\n(?:\s+[^\n]*\n)*)?)/g)]
ok(co.length === 1 && /base\.ref/.test(co[0][1]) && !/head\.(sha|ref)/.test(co[0][1]), 'único checkout é o da BASE')
ok(/exige-via-revisada\.ts/.test(y) && /labels\[\]=revisao-eng-chefe/.test(y) && !/-X DELETE/.test(y), 'coloca a etiqueta e nunca a tira')
const f = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
ok(/exige-via-revisada\.ts/.test(f) && /ponho \$SENSIVEL e espero/.test(f), 'fila não publica pela via rápida PR de conteúdo sensível sem etiqueta')
ok(/etiquetar-revisao\.yml/.test(readFileSync('AGENTS.md', 'utf8')), 'AGENTS.md documenta etiquetar-revisao.yml')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nEtiqueta automática: ok')

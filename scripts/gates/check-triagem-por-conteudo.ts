// Gate (Eng. Chefe 14/10; regra do CEO 12/10) — a triagem da aceitação decide a via pelo CONTEÚDO da PR. Sem rede.
// Via rápida SÓ para PR que não toca migration/tela/cálculo/RLS; a etiqueta pode forçar a revisada, nunca a rápida.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const wf = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
ok(/scripts\/merge\/caminhos-revisados\.sh/.test(wf), 'triagem consulta caminhos-revisados.sh')
ok(/sensivel=\$\(echo "\$files" \| scripts\/merge\/caminhos-revisados\.sh/.test(wf), 'triagem passa os arquivos da PR ao classificador')
ok(/if \[ -n "\$sensivel" \]; then\s*\n\s*revisada=true/.test(wf), 'caminho sensível força a via revisada')
ok(/labels\[\]=revisao-eng-chefe/.test(wf), 'triagem põe a etiqueta revisao-eng-chefe sozinha')
ok(/revisada=\$etiquetada/.test(wf), 'etiqueta continua podendo forçar a revisada')
ok(/issues: write/.test(wf), 'permissão para etiquetar')

const classifica = (arq: string[]) =>
  execFileSync('scripts/merge/caminhos-revisados.sh', { input: arq.join('\n') + '\n' }).toString().trim()
ok(classifica(['supabase/migrations/20261014200005_x.sql']) !== '', 'migration → revisada')
ok(classifica(['src/app/dashboard/hub/page.tsx']) !== '', 'tela (page.tsx) → revisada')
ok(classifica(['src/components/hub/Calc.tsx']) !== '', 'componente de tela → revisada')
ok(classifica(['src/lib/hub/calculo-forro.ts']) !== '', 'função de cálculo → revisada')
ok(classifica(['supabase/rls-policies.sql']) !== '', 'policy/RLS → revisada')
ok(classifica(['README.md', 'scripts/gates/x.ts', 'e2e/a.spec.ts', 'docs/a.md']) === '', 'doc/gate/teste → via rápida')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }

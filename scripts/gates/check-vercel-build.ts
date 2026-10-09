// Gate (CEO 07/10 — custo de Build CPU Minutes na Vercel). Sem rede.
//  · o build da Vercel roda SÓ o next build (vercel.json › buildCommand); os gates rodam no gates.yml, em toda PR e
//    na main (check "gates"), e a fila de merge exige esse check;
//  · Ignored Build Step: não builda preview de PR draft, de PR só .md/docs/.github, nem de branch sem PR; main sempre;
//    falha na consulta → builda;
//  · PR que fica pronta sem preview ganha o build (preview-pronta.yml).
import { readFileSync } from 'node:fs'
import { decidir, SO_DOCS } from '../vercel-ignore.mjs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (p: string) => readFileSync(p, 'utf8')

const vercel = JSON.parse(ler('vercel.json')) as { buildCommand?: string; ignoreCommand?: string }
ok(vercel.buildCommand === 'next build', `vercel.json: buildCommand = "next build" (hoje: "${vercel.buildCommand}")`)
ok(vercel.ignoreCommand === 'bash scripts/vercel-ignore.sh', 'vercel.json: ignoreCommand = scripts/vercel-ignore.sh')

const gates = ler('.github/workflows/gates.yml')
ok(/^  pull_request:/m.test(gates) && /branches: \[main\]/.test(gates), 'gates.yml: roda em toda PR e no push da main')
ok(/^  gates:\s*$/m.test(gates) && /run: npm run gates\s*$/m.test(gates), 'gates.yml: job "gates" roda npm run gates')
ok(!/secrets\./.test(gates), 'gates.yml: não depende de segredo (gates são estáticos)')

const fila = ler('scripts/merge/fila-merge.sh')
ok(/\$1 == "gates"/.test(fila) && /esperar:gates ainda não rodaram/.test(fila), 'fila de merge: exige o check "gates" verde')
ok(/so_docs=1/.test(fila), 'fila de merge: PR só de docs não espera preview')

const pronta = ler('.github/workflows/preview-pronta.yml')
ok(/types: \[opened, reopened, ready_for_review, synchronize\]/.test(pronta), 'preview-pronta: dispara ao abrir/reabrir/sair de draft/push (synchronize)')
ok(/success\) if grep -qiE 'cancel\|ignor'/.test(pronta), 'preview-pronta: success "Canceled by Ignored Build Step" não conta como preview')
ok(/test\("cancel\|ignor"; "i"\)/.test(fila), 'fila de merge: build ignorado não conta como Vercel verde')
ok(/secrets\.FILA_MERGE_TOKEN/.test(pronta) && /-F force=false/.test(pronta), 'preview-pronta: commit vazio com PAT, sem force')

// decisões do Ignored Build Step (0 = não builda; 1 = builda)
type Entrada = { env: string; ref: string; pr?: { number: number; draft: boolean } | null; arquivos?: string[] }
const decide = decidir as unknown as (e: Entrada) => { codigo: number; motivo: string }
const pr = (o: Partial<{ number: number; draft: boolean }> = {}) => ({ number: 1, draft: false, ...o })
const casos: [string, Entrada, number][] = [
  ['produção sempre builda', { env: 'production', ref: 'main' }, 1],
  ['main sempre builda (mesmo como preview)', { env: 'preview', ref: 'main' }, 1],
  ['branch sem PR não builda', { env: 'preview', ref: 'x', pr: null }, 0],
  ['PR draft não builda', { env: 'preview', ref: 'x', pr: pr({ draft: true }) }, 0],
  ['PR só .md/docs/.github não builda', { env: 'preview', ref: 'x', pr: pr(), arquivos: ['AGENTS.md', 'docs/a.png', '.github/workflows/w.yml'] }, 0],
  ['PR com código builda', { env: 'preview', ref: 'x', pr: pr(), arquivos: ['AGENTS.md', 'src/app/page.tsx'] }, 1],
  ['PR com migration builda', { env: 'preview', ref: 'x', pr: pr(), arquivos: ['supabase/migrations/1.sql'] }, 1],
  ['consulta da PR falhou → builda', { env: 'preview', ref: 'x', pr: undefined }, 1],
  ['consulta dos arquivos falhou → builda', { env: 'preview', ref: 'x', pr: pr(), arquivos: undefined }, 1],
  ['PR sem arquivos → builda (falha segura)', { env: 'preview', ref: 'x', pr: pr(), arquivos: [] }, 1],
  ['sem branch → builda', { env: 'preview', ref: '' }, 1],
]
for (const [nome, entrada, esperado] of casos) ok(decide(entrada).codigo === esperado, `ignore: ${nome}`)
ok(SO_DOCS.test('docs/x.ts') && !SO_DOCS.test('src/docs.ts') && !SO_DOCS.test('README.mdx'), 'ignore: regra de "só docs" exata')

if (falhas) { console.error(`\ncheck-vercel-build: ${falhas} falha(s)`); process.exit(1) }
console.log('\nBuild da Vercel enxuto (gates no Actions, Ignored Build Step): ok')

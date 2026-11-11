// Gate (CEO 07/10 + CEO 10/11 — custo de Build CPU Minutes na Vercel). Sem rede.
//  · a Vercel builda SÓ o `next build` (vercel.json › buildCommand) e, desde CEO 10/11, SÓ a produção (main): o
//    preview de PR foi DESLIGADO (scripts/vercel-ignore.mjs: ref ≠ main → não builda);
//  · a COMPILAÇÃO por PR (`next build`) roda no GitHub Actions (build-pr.yml → check "build-pr"), de graça; a fila de
//    merge exige o check "build-pr" verde no lugar do antigo "Vercel (build real)" (transição: ainda aceita um preview
//    real da Vercel já verde);
//  · os gates de scripts/gates/ rodam no gates.yml (só na main, informativos — CEO 22/10);
//  · e2e segue PÓS-MERGE (aceitacao-main.yml).
import { readFileSync } from 'node:fs'
import { decidir, SO_DOCS } from '../vercel-ignore.mjs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (p: string) => readFileSync(p, 'utf8')

const vercel = JSON.parse(ler('vercel.json')) as { buildCommand?: string; ignoreCommand?: string }
ok(vercel.buildCommand === 'next build', `vercel.json: buildCommand = "next build" (hoje: "${vercel.buildCommand}")`)
ok(vercel.ignoreCommand === 'bash scripts/vercel-ignore.sh', 'vercel.json: ignoreCommand = scripts/vercel-ignore.sh')

const gates = ler('.github/workflows/gates.yml')
ok(/^  push:/m.test(gates) && /branches: \[main\]/.test(gates) && !/^  pull_request:/m.test(gates), 'gates.yml: roda SÓ na main (não em PR — suíte informativa, CEO 22/10; libera runner do Actions)')
ok(/^  gates:\s*$/m.test(gates) && /run: npm run gates\s*$/m.test(gates), 'gates.yml: job "gates" roda npm run gates')
ok(!/secrets\./.test(gates), 'gates.yml: não depende de segredo (gates são estáticos)')

// COMPILAÇÃO por PR no Actions (CEO 10/11): build-pr.yml roda next build em toda PR (fora draft/docs), sem segredo.
const build = ler('.github/workflows/build-pr.yml')
ok(/^  pull_request:/m.test(build) && /run: npx next build\s*$/m.test(build), 'build-pr.yml: roda `npx next build` em pull_request')
ok(/paths-ignore:/.test(build) && /'\*\*\/\*\.md'/.test(build) && /'docs\/\*\*'/.test(build) && /'\.github\/\*\*'/.test(build), 'build-pr.yml: pula PR só de .md/docs/.github (igual ao so_docs da fila)')
ok(/!github\.event\.pull_request\.draft/.test(build), 'build-pr.yml: não roda em rascunho (como o preview não rodava)')
ok(!/secrets\./.test(build), 'build-pr.yml: compila com placeholders — não depende de segredo (não conecta a banco)')
ok(/NEXT_PUBLIC_SUPABASE_URL:/.test(build) && /NEXT_PUBLIC_SUPABASE_ANON_KEY:/.test(build), 'build-pr.yml: define as NEXT_PUBLIC_* (placeholders) que o src/lib/supabase.ts exige')

const fila = ler('scripts/merge/fila-merge.sh')
ok(/\$1 != "gates"/.test(fila) && !/esperar:gates ainda não rodaram/.test(fila), 'fila de merge: suíte "gates" é informativa (fora do bloqueio) — guardas focados + compilação bloqueiam (CEO 22/10)')
ok(/so_docs=1/.test(fila), 'fila de merge: PR só de docs não espera compilação')
ok(/\$1 == "build-pr"/.test(fila) && /\[ "\$bp" = success \]/.test(fila), 'fila de merge: exige o check "build-pr" verde (compilação no Actions, CEO 10/11)')
ok(/esperar:compilação \(build-pr\) ainda não rodou/.test(fila), 'fila de merge: sem build-pr nem preview legado verde → ESPERA (nunca passa sem compilar)')
ok(/test\("cancel\|ignor"; "i"\)/.test(fila), 'fila de merge: preview legado "Canceled by Ignored Build Step" não conta como verde (transição)')

// decisões do Ignored Build Step (0 = não builda; 1 = builda). CEO 10/11: só main/produção builda; preview de PR off.
type Entrada = { env: string; ref: string }
const decide = decidir as unknown as (e: Entrada) => { codigo: number; motivo: string }
const casos: [string, Entrada, number][] = [
  ['produção sempre builda', { env: 'production', ref: 'main' }, 1],
  ['main sempre builda (mesmo como preview)', { env: 'preview', ref: 'main' }, 1],
  ['preview de PR NÃO builda (desligado, CEO 10/11)', { env: 'preview', ref: 'x' }, 0],
  ['branch sem env também não builda (preview off)', { env: '', ref: 'alguma-branch' }, 0],
]
for (const [nome, entrada, esperado] of casos) ok(decide(entrada).codigo === esperado, `ignore: ${nome}`)
ok(SO_DOCS.test('docs/x.ts') && !SO_DOCS.test('src/docs.ts') && !SO_DOCS.test('README.mdx'), 'ignore: regra de "só docs" exata (ainda usada pela fila/so_docs)')

if (falhas) { console.error(`\ncheck-vercel-build: ${falhas} falha(s)`); process.exit(1) }
console.log('\nVercel builda só produção; compilação por PR no Actions (build-pr): ok')

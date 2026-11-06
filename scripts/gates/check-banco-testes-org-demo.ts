// Gate (24/10, gilberto-desenv, msg ba5e5e8a): organização FIXA das DEMOs no banco de testes. As migrations das DEMOs gravam a
// empresa na organização c830f980-… da produção; o banco de testes nasce do dump sem dados + semente.sql (organização com id
// aleatório). A 20261022203600 (Corretora/Agro) parou o `db push` da vaga 1 (companies_org_id_fkey) e a aceitação da main
// abortava em segundos (#800, #802). Regras: o script garante a organização só no banco de TESTES, idempotente, sem apagar
// nem alterar nada, e roda ANTES de cada `db push` das vagas (aceitação da main, Montar vaga 0 e extras, aceitação de PR).
// Sem rede, banco ou variável.
import { readdirSync, readFileSync, statSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗ ' + msg) } else console.log('✓ ' + msg) }
const ler = (f: string) => readFileSync(f, 'utf8')
const ORG = 'c830f980-9be9-40c1-bb46-584cdc92dd65'
const SCRIPT = 'scripts/banco-testes/garantir-org-demo.sh'

const sh = ler(SCRIPT)
const corpo = sh.replace(/^#[^\n]*$/gm, '')
ok((statSync(SCRIPT).mode & 0o111) !== 0, 'garantir-org-demo.sh é executável')
ok(/\*horsymhsinqcimflrtjo\*\) echo "::error::[^"]*PRODUÇÃO[^"]*"; exit 1/.test(sh), 'script: aborta se a URL for a produção')
ok(/\*pooler\.supabase\.com\*\) ;;/.test(sh), 'script: só Session pooler de teste')
ok(new RegExp(`INSERT INTO public\\.organizations \\(id, name, slug\\)\\s*VALUES \\('${ORG}'`).test(corpo), 'script: cria a organização com o id fixo das DEMOs')
ok(/ON CONFLICT DO NOTHING;/.test(corpo), 'script: idempotente (ON CONFLICT DO NOTHING)')
ok(!/\b(DELETE|TRUNCATE|DROP|UPDATE)\b/i.test(corpo), 'script: não apaga nem altera linha existente')
ok(/SET statement_timeout = '15s';[\s\S]*SET lock_timeout = '5s';/.test(corpo), 'script: statement_timeout e lock_timeout curtos')
ok(/\[ "\$n" = 1 \] \|\| \{ echo "::error::/.test(sh), 'script: falha explícito se a organização não ficou presente')

// toda migration que grava empresa nessa organização usa o MESMO id (se mudar o id, o script precisa acompanhar)
const migr = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
const usam = migr.filter((f) => ler(`supabase/migrations/${f}`).includes(ORG))
ok(usam.includes('20261022203600_demo_corretora_agro_empresas.sql'), `a migration que travou a vaga 1 usa a organização ${ORG.slice(0, 8)}…`)

// roda ANTES do db push em cada lugar
const antesDoPush = (arq: string, ancora: string, push: string, rotulo: string) => {
  const s = ler(arq)
  const i = s.indexOf(ancora)
  const j = i < 0 ? -1 : s.indexOf(push, i)
  const g = i < 0 ? -1 : s.indexOf('garantir-org-demo.sh', i)
  ok(i >= 0 && g > i && j > g, `${rotulo}: garantir-org-demo.sh antes do db push`)
}
antesDoPush('.github/workflows/aceitacao-main.yml', 'Sincronizar o banco da vaga 1', 'supabase db push --include-all --db-url "$TEST_DATABASE_URL"', 'aceitacao-main (vaga 1)')
antesDoPush('.github/workflows/montar-banco-testes.yml', 'Migrations novas (aplica só as pendentes', 'supabase db push --include-all --db-url "$TEST_DATABASE_URL"', 'montar (vaga 0)')
antesDoPush('.github/workflows/montar-banco-testes.yml', 'echo "== vaga $v =="', 'supabase db push --include-all --db-url "$u"', 'montar (vagas extras)')
antesDoPush('.github/workflows/aceitacao-pr.yml', 'scripts/banco-testes/podar-orfas-ledger.sh', 'supabase db push --include-all --db-url "$TEST_DATABASE_URL"', 'aceitacao-pr (sync da vaga antes da referência)')
antesDoPush('.github/workflows/aceitacao-pr.yml', 'TEST_DATABASE_URL="$REF_DATABASE_URL" MIGR_DIR', 'supabase db push --include-all --db-url "$REF_DATABASE_URL"', 'aceitacao-pr (referência)')
antesDoPush('.github/workflows/aceitacao-pr.yml', '1) sincronizando a vaga', 'supabase db push --include-all --db-url "$TEST_DATABASE_URL"', 'aceitacao-pr (sync só com a main)')
ok(/TEST_DATABASE_URL="\$u" scripts\/banco-testes\/garantir-org-demo\.sh/.test(ler('.github/workflows/montar-banco-testes.yml')),
  'montar (vagas extras): roda contra a URL da própria vaga')
ok(/TEST_DATABASE_URL="\$REF_DATABASE_URL" scripts\/banco-testes\/garantir-org-demo\.sh/.test(ler('.github/workflows/aceitacao-pr.yml')),
  'aceitacao-pr (referência): roda contra a URL da referência')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-banco-testes-org-demo: ok')

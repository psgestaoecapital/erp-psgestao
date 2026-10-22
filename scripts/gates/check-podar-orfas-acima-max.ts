// Gate (rodrigo-code 20/10) — CORTA A FONTE da órfã RD-52 que re-sujava as vagas de teste e travava a esteira.
// Órfã = versão no ledger da vaga de TESTES sem arquivo em supabase/migrations (sobra de migration de PR não mergeada,
// aplicada na vaga e deixada por run cancelado antes do teardown). Duas brechas que este gate trava:
//  (1) podar-orfas-ledger.sh podava só `version <= maior do repo` → órfã ACIMA da main (ex. 20261020130020) sobrevivia
//      e o `db push` abortava. Agora poda TODA versão sem arquivo (invariante: "not in (<arquivos do repo>)").
//  (2) ledger.sh (Montar recriar) não removia órfã — o recriar mexe só no schema public, o ledger vive em
//      supabase_migrations → órfã sobrevivia ao recriar. Agora o ledger de testes = EXATAMENTE os arquivos do repo
//      (insere faltantes + remove versão sem arquivo).
// Estático (sem rede/banco), conforme "um arquivo por gate".
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const podar = readFileSync('scripts/banco-testes/podar-orfas-ledger.sh', 'utf8')
const ledger = readFileSync('scripts/banco-testes/ledger.sh', 'utf8')

// (1) o pruner NÃO pode mais restringir por "version <= $max" (deixava passar órfã acima da main)
ok(!/version\s*<=\s*'?\$\{?max\}?'?/.test(podar),
  "(1) podar-orfas-ledger.sh NÃO restringe mais a '<= $max' (poda órfã acima da main também)")
ok(/delete from supabase_migrations\.schema_migrations where version not in \(\$lista\)/.test(podar),
  '(1) podar-orfas-ledger.sh remove toda versão sem arquivo (version not in ($lista))')
ok(/\*horsymhsinqcimflrtjo\*/.test(podar),
  '(1) podar-orfas-ledger.sh mantém a trava anti-produção')

// (2) ledger.sh reconcilia: além de inserir, REMOVE versão sem arquivo do repo → recriar deixa a vaga limpa
ok(/_repo_led/.test(ledger) && /delete from supabase_migrations\.schema_migrations where version not in \(select version from _repo_led\)/.test(ledger),
  '(2) ledger.sh remove versão sem arquivo (ledger de testes = arquivos do repo) — recriar limpa a órfã')
ok(/\*horsymhsinqcimflrtjo\*/.test(ledger),
  '(2) ledger.sh ganhou a trava anti-produção')
ok(/on conflict \(version\) do nothing/.test(ledger),
  '(2) ledger.sh continua inserindo os arquivos do repo (on conflict do nothing)')

if (falhas) { console.error(`\n${falhas} falha(s) — corte da fonte da órfã RD-52 na vaga de testes`); process.exit(1) }
console.log('\ncheck-podar-orfas-acima-max: ok')

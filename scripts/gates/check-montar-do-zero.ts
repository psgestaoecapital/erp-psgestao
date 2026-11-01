// Gate (CEO 21/10) — Causa 2, fatia 1: o montar DETERMINÍSTICO (do_zero) aplica as migrations do zero (schema+ledger
// batem com a main por construção), em vez do dump da produção + carimbo do ledger. Opt-in e paralelo: default=false
// não muda o fluxo atual. Checagem estática do script e da fiação do workflow.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const sh = readFileSync('scripts/banco-testes/montar-do-zero.sh', 'utf8')
// só o código executável (os comentários explicam o que o script NÃO faz, citando dump/ledger.sh de propósito)
const code = sh.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
ok(/supabase db push --include-all --db-url/.test(code), 'aplica TODAS as migrations do zero (db push --include-all)')
ok(!/db dump/.test(code) && !/estrutura\.sql/.test(code) && !/ledger\.sh/.test(code),
  'não usa o dump da produção nem carimba o ledger (ledger.sh) — fim do drift por construção')
ok(/limpar-public\.sh/.test(sh), 'limpa o schema public antes de aplicar')
ok(/CREATE EXTENSION/.test(sh), 'cria as extensões que as migrations assumem já existentes')
ok(/led_max/.test(sh) && /repo_max/.test(sh) && /exit 1/.test(sh),
  'prova anti-drift: ledger == última migration do repo, senão falha')
ok(/PRODUÇÃO/.test(sh) && /pooler\.supabase\.com/.test(sh), 'travas de segurança: nunca a produção, só o Session pooler')

const wf = readFileSync('.github/workflows/montar-banco-testes.yml', 'utf8')
const afterFlag = wf.slice(wf.indexOf('do_zero:'))
ok(/do_zero:/.test(wf) && /default: false/.test(afterFlag.slice(0, 400)),
  'flag do_zero existe e default=false (opt-in — não altera o montar de hoje)')
ok(/inputs\.recriar && !inputs\.do_zero/.test(wf),
  'a montagem por dump e o ledger.sh só rodam com do_zero=false')
ok(/inputs\.recriar && inputs\.do_zero/.test(wf) && /montar-do-zero\.sh/.test(wf),
  'a montagem do zero roda com do_zero=true e chama o script')

if (falhas) { console.error(`\ncheck-montar-do-zero: ${falhas} falha(s)`); process.exit(1) }
console.log('\nMontar do zero (Causa 2): ok')

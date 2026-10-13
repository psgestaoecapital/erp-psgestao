// Gate (incidente 13/10 19:58) — contaminação entre PRs no banco da vaga. A aceitação precisa BARRAR banco sujo (ledger
// com versão de PR não aprovada além da main) antes de testar, senão a próxima PR herda schema não aprovado. Este gate
// trava: (a) o detector existe e é READ-ONLY (só lê o ledger — nunca derruba/apaga nada no banco da vaga); (b) a
// contaminação é definida como "ledger > maior versão da main" (NUNCA set-difference, que pegaria as ~800 linhas
// históricas); (c) aceitacao-pr.yml chama o detector ANTES dos testes e ao FIM (if: always()); (d) aceitacao-main também.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const sh = readFileSync('scripts/banco-testes/reconciliar-vaga.sh', 'utf8')
// (a) READ-ONLY: o detector não pode conter comando destrutivo no SQL que manda ao banco da vaga.
const semComentario = sh.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
ok(!/\b(drop|delete|truncate|update|insert|alter)\b/i.test(semComentario),
  'reconciliar-vaga.sh é READ-ONLY (sem drop/delete/update/insert/alter — só detecta e falha)')
// (b) contaminação = ledger > maior versão da main (não set-difference)
ok(/where version > '\$main_max'/.test(sh), 'contaminação definida como ledger > maior versão da main')
ok(/main_max=\$\(ls "\$MAIN_MIGR_DIR"/.test(sh), 'maior versão vem das migrations de origin/main (MAIN_MIGR_DIR)')
// (c) guardas de segurança e saída dedicada
ok(/horsymhsinqcimflrtjo/.test(sh) && /pooler\.supabase\.com/.test(sh), 'guarda: nunca a produção, exige Session pooler')
ok(/exit 2/.test(sh), 'contaminação sai com exit 2 (vaga precisa de recriar)')

// (c)/(d) wiring nos workflows
const pr = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
const nPr = (pr.match(/reconciliar-vaga\.sh/g) || []).length
ok(nPr >= 2, `aceitacao-pr.yml chama o detector no início e no fim (achei ${nPr})`)
ok(/if: always\(\) && vars\.ACEITACAO_BANCO == 'testes'[\s\S]{0,900}reconciliar-vaga\.sh/.test(pr),
  'aceitacao-pr.yml reconfere a contaminação ao FIM (if: always())')
// a guarda do início vem ANTES do passo de sincronização e dos testes
const iGuarda = pr.indexOf('reconciliar-vaga.sh')
const iSync = pr.indexOf('Sincronizar o banco da vaga com a produção')
const iTeste = pr.indexOf('Jornadas de aceitação contra o preview')
ok(iGuarda > 0 && iGuarda < iSync && iSync < iTeste, 'a guarda do início roda antes do sync e dos testes')

const main = readFileSync('.github/workflows/aceitacao-main.yml', 'utf8')
ok(/reconciliar-vaga\.sh/.test(main), 'aceitacao-main.yml chama o detector antes de testar a main')

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam — guarda de contaminação da vaga`); process.exit(1) }
console.log('\ncheck-aceitacao-reconcilia: ok')

// Gate — revert automático pós-merge (CEO 22/10, esteira contínua). Checagem ESTÁTICA (sem rede, sem banco): o script
// existe, tem as três travas de segurança, é observação por padrão, e está ligado no aceitacao-main.yml no vermelho.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const sh = readFileSync('scripts/merge/reverter-automatico.sh', 'utf8')
const wf = readFileSync('.github/workflows/aceitacao-main.yml', 'utf8')

// (1) NÃO-FLAKY: exige o run anterior também failure antes de reverter
ok(/aceitacao-main\.yml\/runs\?branch=main&per_page=\d+/.test(sh) && /\[1\]\.conclusion/.test(sh) && /!= failure/.test(sh),
  '(1) trava não-flaky: só reverte com 2 aceitações da main vermelhas seguidas')

// (2) ATRIBUIÇÃO 1:1: PRs desde o último verde; exatamente uma; descarta reverts
ok(/status=success&per_page=1/.test(sh) && /\$verde\.\.\$SHA/.test(sh) && /"\$\{#reais\[@\]\}" -ne 1/.test(sh),
  '(2) trava de atribuição: só reverte quando há UMA só PR culpada desde o último verde')
ok(/Revert \\?\*\|revert\*/.test(sh) || /case "\$t" in Revert/.test(sh),
  '(2) descarta PRs de revert da faixa (não reverte um revert)')

// (3) SEM MIGRATION: migration → não reverte, só alerta
ok(/supabase\/migrations\//.test(sh) && /tem.*MIGRATION|tem \*\*migration\*\*|grep -qE '\^supabase\/migrations/.test(sh),
  '(3) trava de migration: PR com migration não é revertida automaticamente (decisão humana)')

// OBSERVAÇÃO por padrão: só age com REVERT_AUTO=1
ok(/"\$\{REVERT_AUTO:-0\}" != 1/.test(sh) && /\[observação\]/.test(sh),
  'observação por padrão: só abre a PR de revert com REVERT_AUTO=1 (liga depois do OK do CEO)')

// idempotência: não abre segundo revert para a mesma PR
ok(/Revert #\$culpada/.test(sh) && /ja.*-ne 0|-ne 0.*ja/.test(sh.replace(/\n/g, ' ')),
  'idempotente: não abre um segundo revert se já houver um aberto para a PR')

// ligado no workflow, no VERMELHO, depois do main-vermelha, com a variável de liga/desliga
ok(/reverter-automatico\.sh/.test(wf) && /REVERT_AUTO: \$\{\{ vars\.REVERT_AUTO_LIGADO \|\| '0' \}\}/.test(wf),
  'wired no aceitacao-main.yml com a variável REVERT_AUTO_LIGADO (liga/desliga sem mexer no código)')
ok(/if: steps\.ja\.outputs\.pular == 'false' && failure\(\)/.test(wf.slice(wf.indexOf('Revert automático'))),
  'o passo de revert só roda no FAILURE da aceitação da main')

if (falhas) { console.error(`\ncheck-reverter-automatico: ${falhas} falha(s)`); process.exit(1) }
console.log('\nRevert automático pós-merge: ok')

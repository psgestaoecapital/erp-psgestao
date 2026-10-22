// Gate (incidente 14/10) — script de shell chamado DIRETO pelo workflow (ex.: `run: scripts/x.sh`) sem o bit de
// execução falha com "Permission denied" (exit 126). Foi o que derrubou o "Reconciliar vaga" #1 (prod-url.sh em 100644)
// e o que fazia o scripts/merge/aceitacao-prune.sh falhar SILENCIOSAMENTE (invocado com `|| true`, o 126 era engolido).
//
// Invariante simples e robusta (sem parsear YAML, sem falso-positivo de comentário): TODO shell script versionado em
// scripts/ tem de ser executável (modo 100755 no índice do git). Nenhum .sh do repo é "sourced" (conferido); dar +x é
// inócuo para os que fossem. Assim, qualquer .sh chamado direto por um workflow já nasce executável. Sem rede.
import { execFileSync } from 'node:child_process'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// modo + caminho de todos os .sh versionados em scripts/
const linhas = execFileSync('git', ['ls-files', '-s', 'scripts'], { encoding: 'utf8' })
  .split('\n').filter((l) => /\t.*\.sh$/.test(l))
const naoExec = linhas.filter((l) => !l.startsWith('100755 ')).map((l) => l.split('\t').pop())

ok(linhas.length > 0, `encontrou ${linhas.length} shell script(s) em scripts/`)
for (const f of naoExec) console.error(`✗ ${f} não é executável (git update-index --chmod=+x "${f}")`)
ok(naoExec.length === 0, 'todo scripts/**/*.sh é executável (100755) — nenhum quebra com exit 126 ao ser chamado direto')

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam — bit de execução de scripts de shell`); process.exit(1) }
console.log('\ncheck-scripts-executaveis: ok')

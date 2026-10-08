// Gate (CEO 07/10) — fila de merge SEM BLOQUEIO PELA CABEÇA. A PR atrás da main é atualizada e a PR com checks rodando
// fica esperando, mas a rodada SEGUE para as próximas (antes dava exit 0 e uma PR lenta segurava todas). Continua:
// no máximo 1 merge por rodada; ordem das migrations preservada; vermelhos de verdade saem da fila.
//
// Parte 1 (sempre): leitura do script. Parte 2 (se houver jq e git, como no Actions e na máquina do Code): roda o
// scripts/merge/fila-merge.sh de verdade contra um `gh` simulado, num repositório git temporário, nos cenários do CEO.
import { readFileSync } from 'node:fs'
import { SCRIPT_FILA, comFilaSimulada, merges, temFerramentas, updates } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1: estrutura do laço ───────────────────────────────────────────────────────────────────────────────────────
const sh = readFileSync(SCRIPT_FILA, 'utf8')
const laco = sh.slice(sh.indexOf('for n in $fila; do'))
ok(/SEM BLOQUEIO PELA CABEÇA/.test(sh), 'comentário do topo explica a fila sem bloqueio pela cabeça')
ok(/update-branch"[\s\S]*?\n\s*continue\n\s*fi/.test(laco), 'update-branch bem-sucedido → continue (segue para a próxima)')
ok(/esperar:\*\)[^\n]*continue;;/.test(laco), '"esperar:*" do estado_checks → continue (segue para a próxima)')
const exits = laco.match(/exit 0/g) ?? []
ok(exits.length === 1 && /MERGEADA[\s\S]*?exit 0/.test(laco), 'no laço, o único exit 0 é depois do merge (no máximo 1 merge por rodada)')
// incidente 07/10: a #2118 (migration, via revisada esperando a aceitação) travou a #2133 e todas as PRs com migration.
// Só a PR com migration que espera a MAIN (estado_main) segura as outras com migration; esperar os próprios checks ou
// ser atualizada não segura ninguém.
ok(!/\[ "\$com_migration" = 1 \] && so_sem_migration=1/.test(laco) && (laco.match(/so_sem_migration=1/g) ?? []).length === 1
  && /m=\$\(estado_main\)[\s\S]*?so_sem_migration=1; continue/.test(laco),
  'só a PR com migration que espera a MAIN (estado_main) segura as outras com migration')

// ── Parte 2: cenários de verdade contra um gh simulado (scripts/merge/fila-simulada.ts) ───────────────────────────
if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente (a parte 1 continua valendo)')
} else {
  comFilaSimulada((rodar) => {
    let x = rodar([{ n: 1, checksRodando: true }, { n: 2 }])
    ok(merges(x.escritas).join() === '2', 'cenário: PR 1 esperando + PR 2 pronta → PR 2 mergeada no mesmo run')
    x = rodar([{ n: 1, atras: 2 }, { n: 2 }])
    ok(updates(x.escritas).join() === '1' && merges(x.escritas).join() === '2', 'cenário: PR 1 atrás da main + PR 2 pronta → PR 1 atualizada e PR 2 mergeada')
    x = rodar([{ n: 1, atras: 1 }, { n: 2, atras: 3 }, { n: 3 }])
    ok(updates(x.escritas).join() === '1,2' && merges(x.escritas).join() === '3', 'cenário: duas atrás da main + uma pronta → duas atualizadas no mesmo run e a 3ª mergeada')
    x = rodar([{ n: 1 }, { n: 2 }])
    ok(merges(x.escritas).join() === '1', 'cenário: duas prontas → só 1 merge por run (a 1ª)')
    x = rodar([{ n: 1, atras: 1, migration: true }, { n: 2, migration: true }, { n: 3 }])
    ok(updates(x.escritas).join() === '1' && merges(x.escritas).join() === '2',
      'cenário: migration atrás da main é atualizada e não segura a outra COM migration (main livre → mergeada)')
    x = rodar([{ n: 1, checksRodando: true, migration: true }, { n: 2, migration: true }])
    ok(merges(x.escritas).join() === '2', 'cenário #2118/#2133: migration esperando os próprios checks → a outra COM migration é mergeada')
    x = rodar([{ n: 1, migration: true }, { n: 2, migration: true }, { n: 3 }], true)
    ok(merges(x.escritas).join() === '3' && /#2 tem migration: espera a main/.test(x.log),
      'cenário: main ocupada (deploy-migrations rodando) → PRs com migration esperam; a SEM migration é mergeada')
    x = rodar([{ n: 1, migration: true, migrationBaixa: true }, { n: 2, migration: true }])
    ok(merges(x.escritas).join() === '2' && /migration com versão NÃO maior que a última da main/.test(x.log),
      'cenário 08/10: migration com versão abaixo da última da main (recalculada na hora) sai da fila; a outra COM migration válida é mergeada')
  })
}

if (falhas) { console.error(`\ncheck-fila-sem-bloqueio: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila de merge sem bloqueio pela cabeça: ok')

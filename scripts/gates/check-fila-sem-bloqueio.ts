// Gate (CEO 07/10; LOTE CEO 09/10) — fila de merge SEM BLOQUEIO PELA CABEÇA. A PR atrás da main é atualizada e a PR com
// checks rodando fica esperando, mas a rodada SEGUE para as próximas. LOTE: PR SEM migration publica em lote (até
// LOTE_MAX) na mesma rodada; PR COM migration é UMA por rodada e encerra a rodada. Ordem das migrations preservada;
// vermelhos de verdade saem da fila.
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
ok(/LOTE_MAX=\$\{LOTE_MAX:-\d+\}/.test(sh) && /merges=\$\(\(merges \+ 1\)\)/.test(laco),
  'lote: PR sem migration incrementa o contador (merges) até o teto LOTE_MAX')
const exits = laco.match(/exit 0/g) ?? []
ok(exits.length === 2, 'no laço há 2 exit 0: o merge de migration (1/rodada) e o teto LOTE_MAX do lote')
ok(/MERGEADA[^\n]*tem migration[\s\S]*?exit 0/.test(laco), 'migration: merge seguido de exit 0 (uma por rodada e encerra a rodada)')
ok(/merges" -ge "\$LOTE_MAX" \][\s\S]*?exit 0/.test(laco) && /MERGEADA[^\n]*lote[\s\S]*?continue/.test(laco),
  'lote: merge sem migration faz continue (segue o lote); o 2º exit 0 é só no teto LOTE_MAX')
// MAIN0: o `atras` é medido contra a main do início da rodada, não contra a main viva (que anda a cada merge do lote)
ok(/MAIN0=\$\(git rev-parse origin\/main\)/.test(sh) && /compare\/\$MAIN0\.\.\.\$sha/.test(sh),
  'lote: o `atras` é medido contra MAIN0 (a PR em dia no começo não vira "atrás" sozinha depois de um merge do lote)')
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
    ok(merges(x.escritas).join() === '1,2', 'cenário LOTE: duas prontas SEM migration → ambas mergeadas no mesmo run')
    x = rodar([{ n: 1 }, { n: 2 }, { n: 3 }], false, 5000, { LOTE_MAX: '2' })
    ok(merges(x.escritas).join() === '1,2' && /teto do lote \(2\)/.test(x.log), 'cenário LOTE: o teto LOTE_MAX limita quantas PRs sem migration saem por rodada')
    x = rodar([{ n: 1 }, { n: 2, migration: true }])
    ok(merges(x.escritas).join() === '1' && /#2 tem migration: espera a main/.test(x.log),
      'cenário LOTE: PR sem migration publica; a migration atrás dela espera a próxima rodada (a main mudou no lote)')
    x = rodar([{ n: 1, migration: true }, { n: 2 }])
    ok(merges(x.escritas).join() === '1', 'cenário: migration mergeada primeiro → encerra a rodada (1 migration/rodada; a comum vai na próxima)')
    x = rodar([{ n: 1, atras: 1, migration: true }, { n: 2, migration: true }, { n: 3 }])
    ok(updates(x.escritas).join() === '1' && merges(x.escritas).join() === '2',
      'cenário: migration atrás da main é atualizada e não segura a outra COM migration (main livre → mergeada)')
    x = rodar([{ n: 1, checksRodando: true, migration: true }, { n: 2, migration: true }])
    ok(merges(x.escritas).join() === '2', 'cenário #2118/#2133: migration esperando os próprios checks → a outra COM migration é mergeada')
    x = rodar([{ n: 1, migration: true }, { n: 2, migration: true }, { n: 3 }], true)
    ok(merges(x.escritas).join() === '3' && /#2 tem migration: espera a main/.test(x.log),
      'cenário: main ocupada (deploy-migrations rodando) → PRs com migration esperam; a SEM migration é mergeada')
    x = rodar([{ n: 1, migration: true, migrationBaixa: true }, { n: 2, migration: true }])
    ok(merges(x.escritas).join() === '2' && /renumerada\(s\) pela fila/.test(x.log)
      && x.escritas.some((l) => /^PUT repos\/o\/r\/contents\/supabase\/migrations\/\d{14}_m\.sql .*branch=pr1/.test(l))
      && x.escritas.some((l) => /^DELETE repos\/o\/r\/contents\/supabase\/migrations\/20261001000001_m\.sql/.test(l)),
      'cenário 09/10: migration com versão abaixo da última da main (recalculada na hora) é RENUMERADA pela fila (commit no ramo); a outra COM migration válida é mergeada')
  })
}

if (falhas) { console.error(`\ncheck-fila-sem-bloqueio: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila de merge sem bloqueio pela cabeça: ok')

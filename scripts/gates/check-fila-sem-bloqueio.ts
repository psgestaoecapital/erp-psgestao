// Gate (CEO 07/10; LOTE CEO 09/10; VAZÃO CEO 22/10) — fila de merge SEM BLOQUEIO PELA CABEÇA. A PR atrás da main mas
// comprovadamente limpa (mergeable=true) mergeia direto (3-way, sem update-first — "lote sem moer"); a atrás e NÃO limpa
// (mergeable=false/null) é atualizada; a PR com checks rodando fica esperando — a rodada SEGUE para as próximas. LOTE:
// PR SEM migration publica em lote (até LOTE_MAX) na mesma rodada; migrations independentes batelam (até LOTE_MIG_MAX).
// Ordem das migrations preservada; vermelhos de verdade saem da fila.
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
ok(exits.length === 3, 'no laço há 3 exit 0: o teto do lote de migrations, o teto LOTE_MAX do lote comum e a crítica SOLO (CEO 01/11)')
ok(/MERGEADA[^\n]*tem migration[\s\S]*?exit 0/.test(laco), 'migration: merge seguido de exit 0 (uma por rodada e encerra a rodada)')
ok(/merges" -ge "\$LOTE_MAX" \][\s\S]*?exit 0/.test(laco) && /MERGEADA[^\n]*lote[\s\S]*?continue/.test(laco),
  'lote: merge sem migration faz continue (segue o lote); o 2º exit 0 é só no teto LOTE_MAX')
// MAIN0: o `atras` é medido contra a main do início da rodada, não contra a main viva (que anda a cada merge do lote)
ok(/MAIN0=\$\(git rev-parse origin\/main\)/.test(sh) && /compare\/\$MAIN0\.\.\.\$sha/.test(sh),
  'lote: o `atras` é medido contra MAIN0 (a PR em dia no começo não vira "atrás" sozinha depois de um merge do lote)')
// incidente 07/10: a #2118 (migration, via revisada esperando a aceitação) travou a #2133 e todas as PRs com migration.
// Só a PR com migration que espera a MAIN (estado_main) segura as outras com migration; esperar os próprios checks ou
// ser atualizada não segura ninguém.
// CEO 23/10: os flags de hold (deploy_travado / critica_na_main) são setados SÓ depois do estado_main.
ok((laco.match(/deploy_travado=1/g) ?? []).length >= 1 && (laco.match(/critica_na_main=1/g) ?? []).length >= 1
  && /m=\$\(estado_main( "\$(?:mig_)?via")?\)[\s\S]*?case "\$m" in[\s\S]*?deploy_travado=1/.test(laco),
  'só a PR com migration que espera a MAIN (estado_main) segura as outras — deploy_travado (todas) / critica_na_main (só críticas)')

// ── Parte 2: cenários de verdade contra um gh simulado (scripts/merge/fila-simulada.ts) ───────────────────────────
if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente (a parte 1 continua valendo)')
} else {
  comFilaSimulada((rodar) => {
    let x = rodar([{ n: 1, checksRodando: true }, { n: 2 }])
    ok(merges(x.escritas).join() === '2', 'cenário: PR 1 esperando + PR 2 pronta → PR 2 mergeada no mesmo run')
    // VAZÃO / LOTE SEM MOER (CEO 22/10): PR atrás da main mas mergeable=true mergeia direto (3-way), sem update-first.
    x = rodar([{ n: 1, atras: 2 }, { n: 2 }])
    ok(updates(x.escritas).length === 0 && merges(x.escritas).join() === '1,2', 'cenário: PR 1 atrás-mas-limpa (mergeable=true) + PR 2 pronta → AMBAS mergeadas no mesmo run (sem update-first)')
    x = rodar([{ n: 1, atras: 1 }, { n: 2, atras: 3 }, { n: 3 }])
    ok(updates(x.escritas).length === 0 && merges(x.escritas).join() === '1,2,3', 'cenário: três atrás-mas-limpas → as três mergeadas no mesmo run (lote sem moer)')
    // fallback seguro: PR atrás E NÃO comprovadamente limpa (mergeable=false) → update-first como antes (não mergeia)
    x = rodar([{ n: 1, atras: 2, mergeavel: false }, { n: 2 }])
    ok(updates(x.escritas).join() === '1' && merges(x.escritas).join() === '2', 'cenário: PR 1 atrás e mergeable=false → ATUALIZADA (update-first seguro) e PR 2 mergeada')
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
    ok(updates(x.escritas).length === 0 && merges(x.escritas).join() === '1',
      'cenário: migration atrás-mas-limpa mergeia direto (vazão); a 2ª migration não comprovadamente independente espera a próxima rodada')
    x = rodar([{ n: 1, checksRodando: true, migration: true }, { n: 2, migration: true }])
    ok(merges(x.escritas).join() === '2', 'cenário #2118/#2133: migration esperando os próprios checks → a outra COM migration é mergeada')
    x = rodar([{ n: 1, migration: true }, { n: 2, migration: true }, { n: 3 }], true)
    ok(merges(x.escritas).join() === '3' && /#2 tem migration: deploy-migrations da main não está verde/.test(x.log),
      'cenário: main ocupada (deploy-migrations rodando) → PRs com migration esperam; a SEM migration é mergeada')
    x = rodar([{ n: 1, migration: true }, { n: 2, migration: true, migrationCorrige: true }])
    ok(merges(x.escritas).join() === '2' && /não espera a main/.test(x.log),
      'cenário 14/10 (#2542): deploy da main vermelho + PR que só MODIFICA a migration que o quebrou → mergeada; outra migration (adicionada) continua esperando')
    x = rodar([{ n: 1, migration: true }], true)
    ok(merges(x.escritas).length === 0, 'cenário 14/10: sem deploy vermelho a regra segue (migration adicionada espera a main)')
    x = rodar([{ n: 1, migration: true, migrationBaixa: true }, { n: 2, migration: true }])
    ok(merges(x.escritas).join() === '2' && /renumerada\(s\) pela fila/.test(x.log)
      && x.escritas.some((l) => /^PUT repos\/o\/r\/contents\/supabase\/migrations\/\d{14}_m\.sql .*branch=pr1/.test(l))
      && x.escritas.some((l) => /^DELETE repos\/o\/r\/contents\/supabase\/migrations\/20261001000001_m\.sql/.test(l)),
      'cenário 09/10: migration com versão abaixo da última da main (recalculada na hora) é RENUMERADA pela fila (commit no ramo); a outra COM migration válida é mergeada')
  })
}

if (falhas) { console.error(`\ncheck-fila-sem-bloqueio: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila de merge sem bloqueio pela cabeça: ok')

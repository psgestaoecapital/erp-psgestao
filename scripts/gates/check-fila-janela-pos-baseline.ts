// Gate (CEO 15/10, contexto e89e0d62, com o CEO presente) — janela temporária do @pos-migration por LINHA-DE-BASE.
// Em scripts/merge/fila-merge.sh (estado_main), até 2026-10-17 11:00 America/Sao_Paulo (= 2026-10-17T14:00:00Z), o
// @pos-migration da main VERMELHO só BLOQUEIA a PR COM migration se houver falha NOVA — um spec fora da linha-de-base
// do run #496 (os specs que já falhavam antes das PRs do Hub). Mesma lista (ou subconjunto) → segue publicando, 1
// migration por rodada. Spec novo → bloqueia, comenta na PR que entrou por último e propõe reversão ao Eng. Chefe.
// Depois do limite, qualquer vermelho bloqueia sozinho.
//
// Parte 1: leitura do script (data-limite carimbada, linha-de-base do #496, extração de specs, escalonamento).
// Parte 2 (com jq e git): roda o fila-merge.sh de verdade contra o `gh` simulado nos TRÊS casos (base, subconjunto,
// falha nova) + os dois lados da data + o fail-closed de falha de infra.
import { readFileSync } from 'node:fs'
import { SCRIPT_FILA, comFilaSimulada, comentariosEm, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1 ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/JANELA_POS_BASELINE_FIM='2026-10-17T14:00:00Z'/.test(sh),
  'data-limite carimbada: 2026-10-17T14:00:00Z (= 2026-10-17 11:00 America/Sao_Paulo)')
ok(/pos_baseline_ativa\(\) \{ \[ "\$\{FILA_AGORA_EPOCH:-\$\(date -u \+%s\)\}" -lt "\$\(date -u -d "\$JANELA_POS_BASELINE_FIM" \+%s\)" \]; \}/.test(sh),
  'pos_baseline_ativa compara o agora (FILA_AGORA_EPOCH ou real) com o fim da janela')
ok(/POS_BASELINE_496=\$\{FILA_POS_BASELINE:-'e2e\/jornadas\/aceitacao\/atak-status-equipe-rls\.spec\.ts/.test(sh)
  && /e2e\/jornadas\/aceitacao\/pauta-p2\.spec\.ts'\}/.test(sh),
  'linha-de-base do #496: os 2 specs que falharam no run 38741770350 (provados no log do job, RD-38)')
ok(/pos_specs_falhos\(\)/.test(sh) && /check-runs\/\$jid\/annotations/.test(sh)
  && /annotation_level == "failure" or \(\(\.title \/\/ ""\) \| test\("Playwright Run Summary"\)\)/.test(sh)
  && /grep -oE 'e2e\/\[A-Za-z0-9_\.\/-\]\+\\\.spec\\\.ts'/.test(sh) && !/actions\/jobs\/\$jid\/logs/.test(sh),
  'pos_specs_falhos: specs pelas ANOTAÇÕES do check-run (path/título/mensagem + resumo Playwright), SEM baixar o log do job (CEO 15/10 17:50)')
const wf = readFileSync('.github/workflows/fila-merge.yml', 'utf8')
ok(/checks: read/.test(wf) && /actions: read/.test(wf), 'workflow fila-merge: permissões checks:read + actions:read para ler as anotações')
// a decisão na falha: baseline-only → livre; comm contra a baseline; novo → escala + esperar; sem spec → fail-closed
ok(/if pos_baseline_ativa; then/.test(sh) && /comm -23 <\(printf '%s\\n' "\$falhos"\)/.test(sh)
  && /if \[ -z "\$novos" \]; then/.test(sh) && /echo livre; return/.test(sh),
  'estado_main (failure, na janela): só falhas da linha-de-base → livre (migration publica)')
ok(/escalar_pos_novo "\$id" "\$novos"/.test(sh) && /esperar:@pos da main VERMELHO com falha NOVA fora da linha-de-base/.test(sh),
  'estado_main (failure, na janela): spec novo → escala e bloqueia')
ok(/VERMELHO sem spec de teste identificado.*bloqueia/.test(sh),
  'estado_main (failure, na janela): vermelho sem spec identificado (infra) → fail-closed (bloqueia)')
ok(/escalar_pos_novo\(\)/.test(sh) && /commits\/\$hsha\/pulls/.test(sh) && /<!-- fila:pos-novo-\$run -->/.test(sh)
  && /proposta é revertê-la/.test(sh),
  'escalar_pos_novo: comenta UMA vez na PR do head do run (marca pos-novo-$run) e propõe reversão')
// fora da janela, a regra antiga intacta
ok(/echo "esperar:@pos-migration da main VERMELHO \(run \$id\) — reverter a PR culpada"; return;;/.test(sh),
  'fora da janela: qualquer @pos vermelho volta a bloquear (regra original)')
const ag = readFileSync('AGENTS.md', 'utf8')
ok(/Janela temporária do @pos-migration por linha-de-base \(CEO 15\/10/.test(ag) && /run #496/.test(ag),
  'AGENTS.md: janela do @pos por linha-de-base documentada')

// ── Parte 2: os três casos + os dois lados da data + fail-closed ──
const ANTES = String(Math.floor(Date.UTC(2026, 9, 16) / 1000))   // 2026-10-16: DENTRO da janela
const BASE_A = 'e2e/jornadas/aceitacao/base-a.spec.ts'
const BASE_B = 'e2e/jornadas/aceitacao/base-b.spec.ts'
const NOVO = 'e2e/jornadas/aceitacao/novo-regressao.spec.ts'
const BASELINE = `${BASE_A}\n${BASE_B}`

if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente (a parte 1 continua valendo)')
} else {
  comFilaSimulada((rodar) => {
    // Modelo CEO 21/10: a VIA RÁPIDA (Mundo 1) não consulta mais o @pos — a janela da linha-de-base governa só a VIA
    // REVISADA (Mundo 2). Por isso as migrations destes cenários são revisadas (etiqueta + autorização + aceitação verde),
    // que é o que faz a PR chegar ao estado_main onde o @pos é avaliado.
    const mig = { n: 1, migration: true as const, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'success' as const }
    const naJanela = (b: string) => ({ FILA_AGORA_EPOCH: ANTES, FILA_POS_BASELINE: b })

    // 1) BASE: @pos vermelho com EXATAMENTE a linha-de-base → migration publica (1/rodada)
    let x = rodar([mig], false, 5000, naJanela(BASELINE), { conclusion: 'failure', specs: [BASE_A, BASE_B] })
    ok(merges(x.escritas).join() === '1' && /linha-de-base.*migration liberada/.test(x.log),
      '1) BASE: @pos vermelho só com a linha-de-base → migration COM migration publica na janela')

    // 2) SUBCONJUNTO: só uma da base falha → ainda é subconjunto → publica
    x = rodar([mig], false, 5000, naJanela(BASELINE), { conclusion: 'failure', specs: [BASE_A] })
    ok(merges(x.escritas).join() === '1', '2) SUBCONJUNTO: só parte da linha-de-base falha → migration publica')

    // 3) FALHA NOVA: base + um spec fora da base → NÃO publica; comenta na PR do head (headPr=1) e propõe reversão
    x = rodar([{ n: 1, draft: true, labels: [] }, { n: 2, migration: true, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'success' }],
      false, 5000, naJanela(BASELINE), { conclusion: 'failure', specs: [BASE_A, NOVO], headPr: 1 })
    ok(!merges(x.escritas).includes(2), '3) FALHA NOVA: a PR com migration NÃO publica (bloqueada)')
    ok(comentariosEm(x.escritas, 1).some((l) => /falha NOVA/.test(l) && /revert/i.test(l)),
      '3) FALHA NOVA: comenta na PR que entrou por último e propõe reversão (uma vez)')

    // 4) DATA-LIMITE: a MESMA base-only, mas FORA da janela (default pós-janela) → bloqueia
    x = rodar([mig], false, 5000, { FILA_POS_BASELINE: BASELINE }, { conclusion: 'failure', specs: [BASE_A, BASE_B] })
    ok(merges(x.escritas).length === 0, '4) DATA-LIMITE: fora da janela, @pos vermelho (mesmo só com a base) bloqueia')

    // 5) FAIL-CLOSED: @pos vermelho sem spec identificado (falha de infra) na janela → bloqueia
    x = rodar([mig], false, 5000, naJanela(BASELINE), { conclusion: 'failure', specs: [] })
    ok(merges(x.escritas).length === 0 && /sem spec de teste identificado/.test(x.log),
      '5) FAIL-CLOSED: vermelho sem spec de teste identificado → bloqueia (não publica no escuro)')

    // 6) @pos VERDE na janela → migration publica normalmente (sanidade: a janela não afrouxa o verde)
    x = rodar([mig], false, 5000, naJanela(BASELINE), { conclusion: 'success' })
    ok(merges(x.escritas).join() === '1', '6) @pos verde: migration publica normalmente')
  })
}

if (falhas) { console.error(`\ncheck-fila-janela-pos-baseline: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — janela do @pos por linha-de-base: ok')

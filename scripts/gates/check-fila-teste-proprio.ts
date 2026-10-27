// Gate (CEO 16/10 05:45, contexto fbd789a1, CEO presente) — REGRA DO TESTE PRÓPRIO.
// A #2506 entrou pela janela da aceitação revisada (#2665, aceitação informativa) com o PRÓPRIO spec vermelho
// (precificacao-markup-padrao-2710.spec.ts) e só foi pega pelo @pos #527 depois de publicada, travando 24 PRs.
// Em scripts/merge/fila-merge.sh:
//  1. Dentro da janela da aceitação revisada: se a aceitação está vermelha, lê os specs falhos pelas ANOTAÇÕES do
//     check-run (técnica da #2677) e cruza com os e2e/*.spec.ts que a PR tocou. Spec da PRÓPRIA PR falhando → NÃO
//     publica ("spec da própria PR falhando: <spec>"), comenta uma vez. Specs alheios → seguem informativos.
//  2. Falha NOVA no @pos após publicar: aciona o Code autor (erp_dev_entrega.code) automaticamente via
//     fn_agente_mensagem_enviar (tipo tarefa), sem esperar triagem.
//
// Parte 1: leitura do script. Parte 2 (com jq e git): roda o fila-merge.sh de verdade contra o gh/curl simulados
// nos quatro casos: (a) spec próprio falhando bloqueia; (b) só specs alheios → publica; (c) @pos novo → aciona o
// autor certo; (d) fora da janela → regra normal.
import { readFileSync } from 'node:fs'
import { SCRIPT_FILA, comFilaSimulada, comentariosEm, merges, acionamentos, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1 ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/if \[ "\$via" = revisada \] && aceitacao_dispensada && \[ -n "\$n" \]; then/.test(sh),
  'regra do teste próprio só vale na via revisada DENTRO da janela (aceitacao_dispensada)')
ok(/proprios=\$\(comm -12 <\(pos_specs_falhos "\$acc_run"\) <\(pr_specs_proprios "\$n"\)\)/.test(sh),
  'cruza os specs falhos da aceitação (anotações) com os specs e2e que a PR tocou')
ok(/echo "vermelho:spec da própria PR falhando: /.test(sh), 'spec da própria PR falhando → vermelho (não publica)')
ok(/pr_specs_proprios\(\)/.test(sh) && /pulls\/\$1\/files/.test(sh) && /grep -E '\^e2e\/\.\*\\\.spec\\\.ts\$'/.test(sh),
  'pr_specs_proprios: e2e/*.spec.ts criados/alterados pela PR (não removidos)')
ok(/c=\$\(estado_checks "\$sha" "\$via" "\$so_docs" "\$n"( "\$regime_disp")?\)/.test(sh), 'o laço passa o número da PR ($n) para estado_checks')
// Parte 2: acionamento automático do autor
ok(/acionar_autor_pos\(\)/.test(sh) && /rest\/v1\/erp_dev_entrega\?pr_numero=eq\.\$pr/.test(sh)
  && /rpc\/fn_agente_mensagem_enviar/.test(sh) && /p_de:"eng_chefe"/.test(sh) && /p_tipo:"tarefa"/.test(sh),
  'acionar_autor_pos: lê o Code em erp_dev_entrega e aciona via fn_agente_mensagem_enviar (de=eng_chefe, tipo=tarefa)')
ok(/acionar_autor_pos "\$pr" "\$novos" "\$run"/.test(sh) && /SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY.*\|\| return 0/.test(sh),
  'escalar_pos_novo aciona o autor; no-op sem SUPABASE (nunca quebra a fila)')
const ag = readFileSync('AGENTS.md', 'utf8')
ok(/Regra do teste próprio \(CEO 16\/10/.test(ag), 'AGENTS.md: regra do teste próprio documentada')

// ── Parte 2 (funcional) ──
const ANTES = String(Math.floor(Date.UTC(2026, 9, 16) / 1000))   // 2026-10-16: DENTRO das janelas (#2665 e #2667)
const PROPRIO = 'e2e/jornadas/aceitacao/precificacao-markup-padrao-2710.spec.ts'
const ALHEIO = 'e2e/jornadas/aceitacao/atak-status-equipe-rls.spec.ts'
const NOVO = 'e2e/jornadas/aceitacao/novo-regressao.spec.ts'
const BASE = 'e2e/jornadas/aceitacao/base-a.spec.ts'

if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente (a parte 1 continua valendo)')
} else {
  comFilaSimulada((rodar) => {
    const naJanela = (extra: Record<string, string> = {}) => ({ FILA_AGORA_EPOCH: ANTES, ...extra })

    // (a) dentro da janela: revisada autorizada, aceitação vermelha com o PRÓPRIO spec → NÃO publica + comenta uma vez
    let x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure',
      aceitacaoSpecs: [PROPRIO, ALHEIO], specsProprios: [PROPRIO] }], false, 5000, naJanela())
    ok(merges(x.escritas).length === 0, '(a) spec da própria PR falhando → NÃO publica')
    ok(comentariosEm(x.escritas, 1).some((l) => true) && /spec da própria PR falhando/.test(x.log),
      '(a) motivo "spec da própria PR falhando" e comentário na PR')

    // (b) dentro da janela: a MESMA aceitação vermelha, mas só com spec ALHEIO (que a PR não tocou) → publica
    x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure',
      aceitacaoSpecs: [ALHEIO], specsProprios: [PROPRIO] }], false, 5000, naJanela())
    ok(merges(x.escritas).join() === '1', '(b) só specs alheios falhando → publica (aceitação segue informativa)')

    // (c) falha NOVA no @pos após publicar → aciona o Code autor certo (jordana-code) com o spec
    x = rodar(
      [{ n: 1, draft: true, labels: [], autorCode: 'jordana-code' },
       { n: 2, migration: true, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'success' }],
      false, 5000, naJanela({ SUPABASE_URL: 'http://sb.local', SUPABASE_SERVICE_ROLE_KEY: 'k', FILA_POS_BASELINE: BASE }),
      { conclusion: 'failure', specs: [NOVO], headPr: 1 })
    const ac = acionamentos(x.curl)
    ok(ac.length === 1 && /jordana-code/.test(ac[0]) && ac[0].includes(NOVO),
      '(c) @pos com falha NOVA → aciona o Code autor (jordana-code) com o spec, via fn_agente_mensagem_enviar')
    ok(!merges(x.escritas).includes(2), '(c) a PR com migration não publica enquanto o @pos tem falha nova')

    // (d) COM BLOQUEIO FORÇADO: a mesma aceitação vermelha (mesmo só com spec alheio) bloqueia pela REGRA NORMAL
    // (aceitação informativa é o padrão de produção; FILA_ACEITACAO_BLOQUEIA=1 exerce o caminho de bloqueio).
    x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure',
      aceitacaoSpecs: [ALHEIO], specsProprios: [PROPRIO] }], false, 5000, { FILA_POS_BASELINE: BASE, FILA_ACEITACAO_BLOQUEIA: '1' })
    ok(merges(x.escritas).length === 0 && /check vermelho: aceitacao|vermelho:aceitação/.test(x.log.replace(/\n/g, ' ')),
      '(d) bloqueio forçado: aceitação vermelha bloqueia pela regra normal (não pela regra do teste próprio)')
  })
}

if (falhas) { console.error(`\ncheck-fila-teste-proprio: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — regra do teste próprio: ok')

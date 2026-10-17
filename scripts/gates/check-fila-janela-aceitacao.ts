// Gate (CEO 15/10, contexto e89e0d62, com o CEO presente) — janela temporária da aceitação na via REVISADA.
// Em scripts/merge/fila-merge.sh a aceitação VERMELHA da via revisada NÃO bloqueia até 2026-10-17 11:00 America/Sao_Paulo
// (= 2026-10-17T14:00:00Z) e VOLTA A BLOQUEAR sozinha depois. Continuam bloqueando dentro da janela: gates/checks
// estáticos vermelhos, preview (Vercel) com falha, conflito e falta do MERGE AUTORIZADO do revisor para o patch-id.
// Ritmo máximo de 4 publicações/hora; prioridade Hub (#2569 #2508 #2298) e FC/FCR (#2100).
//
// Parte 1: leitura do script (a data-limite está carimbada e ligada nos dois pontos; ritmo e prioridade existem).
// Parte 2 (com jq e git): roda o scripts/merge/fila-merge.sh de verdade contra o `gh` simulado, provando os dois lados
// da data, o teto de ritmo e a ordem de prioridade.
import { readFileSync } from 'node:fs'
import { SCRIPT_FILA, comFilaSimulada, comentariosEm, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1: a data-limite e a mecânica estão no script ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/JANELA_ACEITACAO_REVISADA_FIM='2026-10-17T14:00:00Z'/.test(sh),
  'data-limite carimbada: 2026-10-17T14:00:00Z (= 2026-10-17 11:00 America/Sao_Paulo)')
ok(/aceitacao_dispensada\(\) \{ \[ "\$\{FILA_AGORA_EPOCH:-\$\(date -u \+%s\)\}" -lt "\$\(date -u -d "\$JANELA_ACEITACAO_REVISADA_FIM" \+%s\)" \]; \}/.test(sh),
  'aceitacao_dispensada compara o agora (FILA_AGORA_EPOCH ou real) com o fim da janela')
// ligada nos DOIS pontos: na remoção da aceitação do cálculo e no "revisada exige aceitação verde"
ok(/if \[ "\$via" = rapida \] \|\| aceitacao_dispensada \|\| \[ "\$acc_quar" = 1 \]; then linhas=\$\(awk/.test(sh),
  'dentro da janela a aceitação sai do cálculo de pendentes/vermelhos (como na via rápida)')
ok(/if \[ "\$via" = revisada \] && ! aceitacao_dispensada && \[ "\$acc_quar" != 1 \]; then/.test(sh),
  'a exigência "revisada: aceitação verde" só vale FORA da janela')
// ritmo
ok(/RITMO_MAX_HORA=\$\{RITMO_MAX_HORA:-4\}/.test(sh) && /rodada adiada/.test(sh) && /disp_hora=\$\(\(RITMO_MAX_HORA - pub_hora\)\)/.test(sh),
  'ritmo: teto de 4 publicações/hora (RITMO_MAX_HORA), rodada adiada ao estourar')
ok(/pub_hora=\$\{FILA_PUB_HORA:-/.test(sh) && /\|\| echo 0\)\}/.test(sh),
  'ritmo: conta merges da última hora (fail-open: erro de API = 0)')
// prioridade
ok(/FILA_PRIORIDADE=\$\{FILA_PRIORIDADE:-'2569 2508 2298 2100'\}/.test(sh),
  'prioridade padrão: Hub (#2569 #2508 #2298) e FC/FCR (#2100) na frente')
// o que NUNCA deixa de bloquear (dentro ou fora da janela): gates, Vercel, autorização
ok(/echo "vermelho:gates não estão verdes"/.test(sh) && /echo "vermelho:Vercel/.test(sh)
  && /sem a autorização do revisor para o conteúdo atual/.test(sh),
  'dentro da janela, gates/Vercel/MERGE AUTORIZADO continuam bloqueando (só a aceitação é dispensada)')

const ag = readFileSync('AGENTS.md', 'utf8')
ok(/Janela temporária da aceitação \(CEO 15\/10/.test(ag) && /2026-10-17 11:00 America\/Sao_Paulo/.test(ag),
  'AGENTS.md: janela documentada')

// ── Parte 2: os dois lados da data, o ritmo e a prioridade ──
const ANTES = String(Math.floor(Date.UTC(2026, 9, 16) / 1000))   // 2026-10-16T00:00:00Z: DENTRO da janela
const DEPOIS = String(Math.floor(Date.UTC(2026, 9, 20) / 1000))  // 2026-10-20T00:00:00Z: FORA da janela (= padrão do harness)

if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente (a parte 1 continua valendo)')
} else {
  comFilaSimulada((rodar) => {
    const revVermelha = { n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure' as const }

    // 1) DENTRO da janela: revisada autorizada com aceitação VERMELHA → publica (a aceitação não bloqueia)
    let x = rodar([revVermelha], false, 5000, { FILA_AGORA_EPOCH: ANTES })
    ok(merges(x.escritas).join() === '1', '1) dentro da janela: revisada autorizada + aceitação vermelha → PUBLICA')

    // 2) FORA da janela: a MESMA PR não publica (a aceitação vermelha volta a bloquear) e a fila comenta o motivo
    x = rodar([revVermelha], false, 5000, { FILA_AGORA_EPOCH: DEPOIS })
    ok(merges(x.escritas).length === 0 && comentariosEm(x.escritas, 1).length === 1,
      '2) fora da janela: a mesma PR NÃO publica (aceitação vermelha bloqueia de novo)')

    // 3) DENTRO da janela, mas gate estático vermelho continua bloqueando mesmo com autorização
    //    (checksRodando deixa o check obrigatório pendente → esperar, nunca publica)
    x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure', checksRodando: true }],
      false, 5000, { FILA_AGORA_EPOCH: ANTES })
    ok(merges(x.escritas).length === 0, '3) dentro da janela: check obrigatório não-verde continua segurando a PR')

    // 4) DENTRO da janela: falta de MERGE AUTORIZADO continua bloqueando (autorizada=false)
    x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], aceitacao: 'failure' }], false, 5000, { FILA_AGORA_EPOCH: ANTES })
    ok(merges(x.escritas).length === 0 && comentariosEm(x.escritas, 1).some((l) => /sem a autorização do revisor/.test(l)),
      '4) dentro da janela: sem MERGE AUTORIZADO do revisor não publica')

    // 5) RITMO: 4 publicações na última hora → rodada adiada, nada publica
    x = rodar([{ n: 1, labels: [] }], false, 5000, { FILA_PUB_HORA: '4' })
    ok(merges(x.escritas).length === 0 && /rodada adiada/.test(x.log), '5) ritmo: 4 publicações/h atingido → rodada adiada')

    // 6) RITMO: 3 na última hora → sobra 1 vaga; das duas comuns prontas, publica só 1 nesta rodada
    x = rodar([{ n: 1, labels: [] }, { n: 2, labels: [] }], false, 5000, { FILA_PUB_HORA: '3' })
    ok(merges(x.escritas).length === 1, '6) ritmo: 3/4 na hora → só 1 vaga nesta rodada (lote cortado pelo ritmo)')

    // 7) PRIORIDADE: FILA_PRIORIDADE reordena a fila (os prioritários primeiro, resto na ordem de entrada)
    x = rodar([{ n: 1, labels: [] }, { n: 2, labels: [] }, { n: 3, labels: [] }, { n: 4, labels: [] }],
      false, 5000, { FILA_PRIORIDADE: '3 1' })
    ok(merges(x.escritas).join() === '3,1,2,4', '7) prioridade: FILA_PRIORIDADE="3 1" → publica 3, 1, depois 2, 4')
  })
}

if (falhas) { console.error(`\ncheck-fila-janela-aceitacao: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — janela da aceitação: ok')

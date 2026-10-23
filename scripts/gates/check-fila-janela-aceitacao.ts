// Gate — ESTEIRA CONTÍNUA (CEO 22/10): a aceitação e2e NÃO é mais porteiro do merge. Em scripts/merge/fila-merge.sh a
// aceitação é SEMPRE informativa no caminho do merge (o banco de testes saiu da frente; virou verificação pós-merge nas
// demos de produção, com revert). Continuam bloqueando: gates/checks estáticos, preview (Vercel), conflito e, se
// sensível, o MERGE AUTORIZADO do revisor. FILA_ACEITACAO_BLOQUEIA=1 força o caminho antigo (bloqueio) só nos testes.
//
// Parte 1: a mecânica está no script (flag, e ligada nos dois pontos). Parte 2 (jq+git): roda o fila-merge.sh de verdade
// contra o `gh` simulado, provando que a aceitação vermelha PUBLICA (informativa), que com a flag ela bloqueia, e que
// gates/autorização/ritmo/prioridade continuam valendo.
import { readFileSync } from 'node:fs'
import { SCRIPT_FILA, comFilaSimulada, comentariosEm, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1: a mecânica está no script ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/aceitacao_dispensada\(\) \{ \[ "\$\{FILA_ACEITACAO_BLOQUEIA:-0\}" != 1 \]; \}/.test(sh),
  'aceitação informativa por padrão (FILA_ACEITACAO_BLOQUEIA=1 força o bloqueio só nos testes)')
// ligada nos DOIS pontos: na remoção da aceitação do cálculo e no "revisada exige aceitação verde"
ok(/if \[ "\$via" = rapida \] \|\| aceitacao_dispensada \|\| \[ "\$acc_quar" = 1 \]; then linhas=\$\(awk/.test(sh),
  'aceitação informativa sai do cálculo de pendentes/vermelhos (como na via rápida)')
ok(/if \[ "\$via" = revisada \] && ! aceitacao_dispensada && \[ "\$acc_quar" != 1 \]; then/.test(sh),
  'a exigência "revisada: aceitação verde" só vale quando o bloqueio é forçado')
// ritmo
ok(/RITMO_MAX_HORA=\$\{RITMO_MAX_HORA:-30\}/.test(sh) && /rodada adiada/.test(sh) && /disp_hora=\$\(\(RITMO_MAX_HORA - pub_hora\)\)/.test(sh),
  'ritmo: teto de 30 publicações/hora (RITMO_MAX_HORA), rodada adiada ao estourar')
ok(/pub_hora=\$\{FILA_PUB_HORA:-/.test(sh) && /\|\| echo 0\)\}/.test(sh),
  'ritmo: conta merges da última hora (fail-open: erro de API = 0)')
// prioridade
ok(/FILA_PRIORIDADE=\$\{FILA_PRIORIDADE:-'2100'\}/.test(sh) && /_hub=''; for hn in \$fila; do jq -e[\s\S]*?index\("hub"\)/.test(sh),
  'prioridade: label hub na frente de tudo; FILA_PRIORIDADE fixa = FC/FCR (#2100)')
// o que NUNCA deixa de bloquear (dentro ou fora da janela): Vercel (preview), guardas focados, autorização.
// A suíte 'gates' passou a ser INFORMATIVA (novo modelo CEO 22/10): sai do bloqueio nas duas vias.
ok(/echo "vermelho:Vercel/.test(sh)
  && /sem a autorização do revisor para o conteúdo atual/.test(sh)
  && /\$1 != "gates"/.test(sh),
  'dentro da janela, Vercel/MERGE AUTORIZADO continuam bloqueando e a suíte "gates" é informativa (novo modelo CEO 22/10)')

const ag = readFileSync('AGENTS.md', 'utf8')
ok(/Esteira cont[ií]nua \(CEO 22\/10/.test(ag) && /aceita[çc][ãa]o[\s\S]{0,400}informativa/i.test(ag),
  'AGENTS.md: esteira contínua documentada (aceitação informativa)')

// ── Parte 2: o comportamento real ──
if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente (a parte 1 continua valendo)')
} else {
  comFilaSimulada((rodar) => {
    const revVermelha = { n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure' as const }

    // 1) PADRÃO (produção): revisada autorizada com aceitação VERMELHA → publica (a aceitação é informativa)
    let x = rodar([revVermelha], false, 5000, {})
    ok(merges(x.escritas).join() === '1', '1) aceitação vermelha + autorizada → PUBLICA (informativa, padrão de produção)')

    // 2) BLOQUEIO FORÇADO (caminho antigo, só nos testes): a MESMA PR não publica e a fila comenta o motivo
    x = rodar([revVermelha], false, 5000, { FILA_ACEITACAO_BLOQUEIA: '1' })
    ok(merges(x.escritas).length === 0 && comentariosEm(x.escritas, 1).length === 1,
      '2) com FILA_ACEITACAO_BLOQUEIA=1 a aceitação vermelha volta a bloquear')

    // 3) gate estático vermelho continua bloqueando mesmo com autorização e aceitação informativa
    x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure', checksRodando: true }], false, 5000, {})
    ok(merges(x.escritas).length === 0, '3) check obrigatório não-verde continua segurando a PR')

    // 4) falta de MERGE AUTORIZADO continua bloqueando (autorizada=false), mesmo com aceitação informativa
    x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], aceitacao: 'failure' }], false, 5000, {})
    ok(merges(x.escritas).length === 0 && comentariosEm(x.escritas, 1).some((l) => /sem a autorização do revisor/.test(l)),
      '4) sem MERGE AUTORIZADO do revisor não publica')

    // 5) RITMO: 30 publicações na última hora → rodada adiada (teto subido para 30 em 23/10)
    x = rodar([{ n: 1, labels: [] }], false, 5000, { FILA_PUB_HORA: '30' })
    ok(merges(x.escritas).length === 0 && /rodada adiada/.test(x.log), '5) ritmo: 30 publicações/h atingido → rodada adiada')

    // 6) RITMO: 29 na última hora → sobra 1 vaga; das duas comuns prontas, publica só 1 nesta rodada
    x = rodar([{ n: 1, labels: [] }, { n: 2, labels: [] }], false, 5000, { FILA_PUB_HORA: '29' })
    ok(merges(x.escritas).length === 1, '6) ritmo: 29/30 na hora → só 1 vaga nesta rodada (lote cortado pelo ritmo)')

    // 7) PRIORIDADE: FILA_PRIORIDADE reordena a fila
    x = rodar([{ n: 1, labels: [] }, { n: 2, labels: [] }, { n: 3, labels: [] }, { n: 4, labels: [] }], false, 5000, { FILA_PRIORIDADE: '3 1' })
    ok(merges(x.escritas).join() === '3,1,2,4', '7) prioridade: FILA_PRIORIDADE="3 1" → publica 3, 1, depois 2, 4')
  })
}

if (falhas) { console.error(`\ncheck-fila-aceitacao-informativa: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — aceitação informativa (esteira contínua): ok')

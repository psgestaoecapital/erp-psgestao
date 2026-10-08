// Gate (CEO 08/10 08:15, "ok fila sem etiqueta") — a fila de merge considera TODA PR não-draft, Ready, base main, com os
// checks obrigatórios verdes; a label `fila-merge` virou opcional (continua aceita) e a label `nao-publicar` tira a PR
// da fila (com UM comentário). PR revisao-eng-chefe continua exigindo "MERGE AUTORIZADO #N — gilberto-revisor ·
// patch-id" do conteúdo atual; migrations seguem as regras de sempre (uma por vez, esperando a main).
//
// Parte 1: leitura do script e do workflow. Parte 2 (com jq e git): roda o scripts/merge/fila-merge.sh de verdade
// contra um `gh` simulado (scripts/merge/fila-simulada.ts) nos 4 cenários do CEO.
import { readFileSync } from 'node:fs'
import { SCRIPT_FILA, comFilaSimulada, comentariosEm, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1 ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/repos\/\$REPO\/pulls\?state=open&base=main/.test(sh) && /select\(\.draft == false/.test(sh) && !/issues\?state=open&labels=\$LABEL/.test(sh),
  'fila: candidatas são todas as PRs abertas não-draft da main (não só as com a label fila-merge)')
ok(/NAO_PUBLICAR='nao-publicar'/.test(sh) && /comentar_uma_vez "\$n" "\$NAO_PUBLICAR"/.test(sh), 'label nao-publicar: pula a PR e comenta uma vez')
ok(!/api "repos\/\$REPO\/pulls\/\$n"\)/.test(sh) && /COTA_MINIMA/.test(sh) && /comentarios\(\) \{/.test(sh),
  'cota da API: sem chamada por PR para dados da lista, comentários lidos uma vez, válvula de cota')
{
  const laco = sh.slice(sh.indexOf('for n in $fila; do'))
  ok(laco.indexOf('c=$(estado_checks') > 0 && laco.indexOf('c=$(estado_checks') < laco.indexOf('/update-branch" -f expected_head_sha'),
    'só a PR verde é atualizada com a main (checks antes do update-branch: sem empurrar commit em PR vermelha)')
}
ok(/comentar_uma_vez\(\)/.test(sh) && /<!-- fila:\$chave -->/.test(sh), 'comentários da fila levam marca escondida (sem repetir a cada rodada)')
ok(/via=revisada/.test(sh) && /a=\$\(autorizacao "\$n"\)/.test(sh) && /patch-id/.test(sh), 'revisao-eng-chefe continua exigindo MERGE AUTORIZADO pelo patch-id')
ok(/m=\$\(estado_main\)/.test(sh) && /so_sem_migration=1; continue/.test(sh), 'migrations: uma por vez, esperando a main (regra intacta)')
const wf = readFileSync('.github/workflows/fila-merge.yml', 'utf8')
ok(/types: \[opened, reopened, labeled, unlabeled, synchronize, ready_for_review\]/.test(wf)
  && /!github\.event\.pull_request\.draft && github\.event\.pull_request\.base\.ref == 'main'/.test(wf)
  && !/contains\(github\.event\.pull_request\.labels\.\*\.name, 'fila-merge'\)/.test(wf),
  'workflow: acorda para qualquer PR Ready da main (sem exigir a label)')
const ag = readFileSync('AGENTS.md', 'utf8')
ok(/Fila sem etiqueta \(CEO 08\/10 08:15/.test(ag) && /nao-publicar/.test(ag), 'AGENTS.md: regra nova documentada')

// ── Parte 2: os 4 cenários do CEO ──
if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente (a parte 1 continua valendo)')
} else {
  comFilaSimulada((rodar) => {
    // 1) draft não publica (nem com a label) — e a comum pronta atrás dela publica
    let x = rodar([{ n: 1, draft: true, labels: ['fila-merge'] }, { n: 2, labels: [] }])
    ok(!merges(x.escritas).includes(1) && comentariosEm(x.escritas, 1).length === 0, '1) draft não publica (e a fila não comenta nela)')
    // 2) nao-publicar não publica e comenta UMA vez
    x = rodar([{ n: 1, labels: ['nao-publicar'] }])
    ok(merges(x.escritas).length === 0 && comentariosEm(x.escritas, 1).length === 1 && /nao-publicar/.test(comentariosEm(x.escritas, 1)[0]),
      '2) nao-publicar não publica e comenta o motivo')
    x = rodar([{ n: 1, labels: ['nao-publicar'], comentarios: ['⏸️ já avisado\n<!-- fila:nao-publicar -->'] }])
    ok(merges(x.escritas).length === 0 && comentariosEm(x.escritas, 1).length === 0, '2) nao-publicar: na rodada seguinte não comenta de novo')
    // 3) revisada sem autorização não publica (aceitação verde, checks verdes)
    x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], aceitacao: 'success' }])
    ok(merges(x.escritas).length === 0 && comentariosEm(x.escritas, 1).some((l) => /MERGE AUTORIZADO/.test(l)),
      '3) revisao-eng-chefe sem "MERGE AUTORIZADO" pelo patch-id não publica')
    // 4) comum, pronta e verde, SEM etiqueta → publica
    x = rodar([{ n: 1, labels: [] }])
    ok(merges(x.escritas).join() === '1', '4) PR comum, Ready e verde, SEM a label fila-merge → publicada')
    // válvula: com pouca cota da API a rodada não publica nada (e não gasta)
    x = rodar([{ n: 1, labels: [] }], false, 300)
    ok(merges(x.escritas).length === 0 && /cota da API baixa/.test(x.log), 'válvula: cota da API baixa → rodada adiada, nada publicado')
    // a label continua aceita
    x = rodar([{ n: 1, labels: [] }, { n: 2, labels: ['fila-merge'] }])
    ok(merges(x.escritas).length === 1, 'a label fila-merge continua aceita (1 merge por rodada)')
  })
}

if (falhas) { console.error(`\ncheck-fila-sem-etiqueta: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila sem etiqueta: ok')

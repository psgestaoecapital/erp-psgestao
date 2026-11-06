// Gate — ADITIVO COM ESCALA, CRÍTICO COM CAUTELA (CEO 23/10). A fila segura migration em 2 níveis:
//  - deploy-migrations da main não-verde → segura TODAS as migrations (deploy_travado).
//  - @pos de uma migration CRÍTICA (via revisada) em andamento/vermelho → segura só as OUTRAS CRÍTICAS; a migration
//    ADITIVA (via rápida) NÃO espera esse @pos (validada pelo deploy + auditor PDCA pós-publicação).
// O crítico NUNCA afrouxa: migration crítica (etiqueta SENSIVEL, ou crítica-por-conteúdo que o classificador rotula e
// pula) nunca publica enquanto o gate não está verde. Este teste prova os dois lados contra o `gh` simulado.
import { readFileSync } from 'node:fs'
import { SCRIPT_FILA, comFilaSimulada, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1: a mecânica está no script ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/deploy_travado=0; critica_na_main=0/.test(sh), 'dois níveis declarados: deploy_travado + critica_na_main')
ok(/\*deploy-migrations\*\)\s*deploy_travado=1/.test(sh), 'deploy-migrations não-verde → deploy_travado (segura todas)')
ok(/\[ "\$critica_na_main" = 1 \] && \[ "\$n_critica" = 1 \]/.test(sh), '@pos de crítica segura só migration CRÍTICA (n_critica pela etiqueta)')
ok(/case "\$m" in\s*\n\s*\*deploy-migrations\*\)/.test(sh), 'o resultado do estado_main é separado por tipo de espera')

// ── Parte 2: o comportamento real ──
if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente (a parte 1 continua valendo)')
} else {
  comFilaSimulada((rodar) => {
    const critica = { n: 1, labels: ['revisao-eng-chefe'], autorizada: true, migration: true }
    const aditiva = { n: 2, labels: [] as string[], migration: true }

    // 1) deploy VERDE + @pos de crítica VERMELHO: a ADITIVA publica, a CRÍTICA espera.
    let x = rodar([critica, aditiva], false, 5000, {}, { conclusion: 'failure', specs: ['e2e/x.spec.ts'], headPr: 1 })
    ok(merges(x.escritas).includes(2) && !merges(x.escritas).includes(1),
      '1) @pos de crítica vermelho (deploy verde): ADITIVA publica, CRÍTICA espera')

    // 2) deploy NÃO-verde (em andamento): NENHUMA migration publica — nem a aditiva (não dá para aplicar nada).
    x = rodar([critica, aditiva], true, 5000, {}, {})
    ok(merges(x.escritas).length === 0, '2) deploy-migrations não-verde: nenhuma migration publica (nem aditiva)')

    // 3) CRÍTICA sozinha com @pos vermelho: espera (cautela do crítico intacta).
    x = rodar([critica], false, 5000, {}, { conclusion: 'failure', specs: ['e2e/x.spec.ts'], headPr: 1 })
    ok(merges(x.escritas).length === 0, '3) crítica sozinha com @pos vermelho: espera (zero regressão no crítico)')

    // 4) só ADITIVAS com @pos vermelho de uma crítica anterior: publicam em lote (escala).
    x = rodar([{ n: 2, labels: [], migration: true }, { n: 3, labels: [], migration: true }], false, 5000, {}, { conclusion: 'failure', specs: ['e2e/x.spec.ts'], headPr: 1 })
    ok(merges(x.escritas).length >= 1, '4) aditivas com @pos de crítica vermelho: publicam (escala, não ficam represadas)')
  })
}

if (falhas) { console.error(`\ncheck-fila-aditiva-escala: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — aditivo com escala, crítico com cautela: ok')

// Gate — MIGRATION SÓ DE CATÁLOGO NÃO SERIALIZA (CEO 31/10 · Eng. Chefe, "FILA CRÍTICA ENTUPIDA").
// Uma PR de RD-95 ("?") / RD-98 p3 leva a etiqueta `revisao-eng-chefe` por causa da TELA, mas a migration só grava
// texto de ajuda/metadado (INSERT em erp_ajuda_*/system_screens). A fila deve: manter a VIA REVISADA (a tela exige
// MERGE AUTORIZADO) e, ao mesmo tempo, NÃO serializar o @pos como crítica — batelar a migration como ADITIVA.
// A migration que de fato muta estrutura/dado continua CRÍTICA (serializa). Prova o classificador puro e o comportamento.
import { readFileSync } from 'node:fs'
import { soCatalogo } from '../merge/migracao-catalogo'
import { SCRIPT_FILA, comFilaSimulada, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1: o classificador puro (soCatalogo) ──
const INSERT_AJUDA = `-- RD-95
INSERT INTO public.erp_ajuda_campo (chave, rotulo, status)
SELECT v.chave, v.rotulo, 'publicado' FROM (VALUES
 ('pm.dia.resumo', 'Resumo do dia; veja o total'),
 ('pm.dia.meu', 'O que é meu')
) AS v(chave, rotulo)
ON CONFLICT (chave) DO NOTHING;`
ok(soCatalogo(INSERT_AJUDA).catalogo === true, 'INSERT em erp_ajuda_campo (com ; dentro do texto) = catálogo')
ok(soCatalogo(`INSERT INTO system_screens (rota, auditada_ok) VALUES ('/x', true) ON CONFLICT (rota) DO UPDATE SET auditada_ok = excluded.auditada_ok;`).catalogo === true, 'UPSERT em system_screens = catálogo')
ok(soCatalogo(`INSERT INTO public.erp_ajuda_campo (chave) VALUES ('a'); INSERT INTO erp_ajuda_artigo (slug) VALUES ('b');`).catalogo === true, 'vários INSERT só em tabelas de catálogo = catálogo')
// UPDATE de texto de ajuda / metadado (CEO 31/10 pediu "insere/ATUALIZA"): também é aditivo em risco → não serializa.
ok(soCatalogo(`UPDATE public.system_screens SET views_consumidas = ARRAY['erp_clientes']::text[], rpcs_chamadas = ARRAY['fn_x']::text[] WHERE rota = '/dashboard/x';`).catalogo === true, 'UPDATE em system_screens (origem do dado, RD-98 p3) = catálogo')
ok(soCatalogo(`UPDATE erp_ajuda_campo SET o_que_preencher = 'novo texto' WHERE chave = 'pm.x';`).catalogo === true, 'UPDATE de texto de ajuda (erp_ajuda_campo) = catálogo')
// Padrão REAL da #3614 (RD-95 + RD-98 p3): INSERT ajuda ON CONFLICT DO NOTHING + UPDATE system_screens da origem.
ok(soCatalogo(`INSERT INTO public.erp_ajuda_campo (chave, rotulo) SELECT v.chave, v.rotulo FROM (VALUES ('a','x; y'),('b','z')) AS v(chave, rotulo) ON CONFLICT (chave) DO NOTHING;
UPDATE public.system_screens SET views_consumidas = ARRAY['erp_clientes','erp_gov_nfse_municipios']::text[], rpcs_chamadas = ARRAY['fn_hub_criar_obra_rapida']::text[] WHERE rota = '/dashboard/projetos/obras/nova';`).catalogo === true, 'padrão #3614 (INSERT ajuda + UPDATE system_screens) = catálogo')

// NÃO-catálogo (viés de segurança → serializa como crítica):
ok(soCatalogo('select 1;').catalogo === false, 'select 1 não é catálogo')
ok(soCatalogo('ALTER TABLE erp_clientes ADD COLUMN x int;').catalogo === false, 'ALTER em tabela existente não é catálogo')
ok(soCatalogo(`CREATE TABLE nova (id int); INSERT INTO erp_ajuda_campo (chave) VALUES ('a');`).catalogo === false, 'CREATE TABLE (DDL aditivo) não é catálogo')
ok(soCatalogo(`INSERT INTO erp_ajuda_campo (chave) VALUES ('a'); UPDATE titulos SET pago = true;`).catalogo === false, 'INSERT catálogo + UPDATE em dado de cliente não é catálogo')
ok(soCatalogo(`UPDATE erp_clientes SET nome = 'x' WHERE id = 1;`).catalogo === false, 'UPDATE em tabela de cliente (fora do catálogo) não é catálogo')
ok(soCatalogo(`DELETE FROM system_screens WHERE rota = '/x';`).catalogo === false, 'DELETE em tabela de catálogo não é catálogo (eng_chefe excluiu DELETE)')
ok(soCatalogo(`INSERT INTO erp_contratos (valor) VALUES (10);`).catalogo === false, 'INSERT em tabela de cliente (não-catálogo) não é catálogo')
ok(soCatalogo(`DELETE FROM erp_ajuda_campo WHERE chave = 'x';`).catalogo === false, 'DELETE não é catálogo')
ok(soCatalogo(`GRANT SELECT ON erp_ajuda_campo TO authenticated;`).catalogo === false, 'GRANT não é catálogo')
ok(soCatalogo(`DO $$ BEGIN INSERT INTO erp_ajuda_campo (chave) VALUES ('a'); END $$;`).catalogo === false, 'bloco DO/$$ não é catálogo')
ok(soCatalogo('').catalogo === false, 'migration vazia não é catálogo')

// ── Parte 2: a mecânica está no script (linha da 887 preservada + bloco de downgrade) ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/migracao-catalogo\.ts/.test(sh), 'a fila chama o classificador migracao-catalogo.ts')
ok(/catalogo \/\/ false/.test(sh) && /n_critica=0/.test(sh), 'catálogo comprovado → n_critica=0 (ADITIVA p/ serialização)')
ok(/\[ "\$n_hub" = 0 \] && jq -e --arg l "\$SENSIVEL"[^\n]*n_critica=1/.test(sh), 'base preservada: etiqueta SENSIVEL ⇒ crítica (hub não conta)')

// ── Parte 3: o comportamento real contra o `gh` simulado ──
if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente (as partes 1 e 2 continuam valendo)')
} else {
  comFilaSimulada((rodar) => {
    // PR com migration CRÍTICA de verdade (ALTER em tabela existente), etiquetada e autorizada.
    const critica = { n: 1, labels: ['revisao-eng-chefe'], autorizada: true, migration: true, sqlMigration: 'ALTER TABLE erp_clientes ADD COLUMN z int;\n' }
    // PR de TELA (etiquetada + autorizada) cuja migration só grava catálogo de ajuda.
    const catalogo = { n: 2, labels: ['revisao-eng-chefe'], autorizada: true, migration: true, sqlMigration: "INSERT INTO public.erp_ajuda_campo (chave, rotulo) VALUES ('x', 'y') ON CONFLICT (chave) DO NOTHING;\n" }

    // @pos de uma crítica VERMELHO (deploy verde): a CATÁLOGO publica (aditiva), a CRÍTICA espera.
    let x = rodar([critica, catalogo], false, 5000, {}, { conclusion: 'failure', specs: ['e2e/x.spec.ts'], headPr: 1 })
    ok(merges(x.escritas).includes(2) && !merges(x.escritas).includes(1),
      '1) @pos de crítica vermelho: a migration SÓ DE CATÁLOGO publica (aditiva); a CRÍTICA espera')
    ok(/#2:.*catálogo de ajuda\/metadado.*ADITIVA/.test(x.log), '1) o log registra o downgrade de #2 para aditiva')

    // Só a CATÁLOGO, @pos de crítica vermelho: publica (não fica represada pela serialização).
    x = rodar([catalogo], false, 5000, {}, { conclusion: 'failure', specs: ['e2e/x.spec.ts'], headPr: 1 })
    ok(merges(x.escritas).includes(2), '2) catálogo sozinha com @pos vermelho: publica (não serializa)')

    // Só a CRÍTICA (conteúdo não-catálogo), @pos vermelho: espera — cautela do crítico intacta.
    x = rodar([critica], false, 5000, {}, { conclusion: 'failure', specs: ['e2e/x.spec.ts'], headPr: 1 })
    ok(merges(x.escritas).length === 0, '3) crítica (ALTER) com @pos vermelho: espera (serialização do crítico intacta)')
  })
}

if (falhas) { console.error(`\ncheck-fila-catalogo-aditivo: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — migration só de catálogo não serializa: ok')

// Gate — LOTE DE MIGRATIONS CRÍTICAS (CEO 01/11). A fila crítica chegou a 44 com vazão de 2-3/h: cada crítica saía
// sozinha e esperava ~20 min de @pos. O CEO aprovou batelar até LOTE_MIG_CRIT_MAX=5 migrations CRÍTICAS num MESMO @pos,
// com CARVE-OUT das categorias perigosas (NR-36, fiscal, financeiro de cliente, RLS/permissão/LGPD) e de qualquer
// conserto-main, que continuam publicando SOZINHAS (1 por @pos). Se o @pos do lote falhar, o guardião bisseta.
//
// Este teste prova, nesta ordem:
//  Parte 1 — a mecânica está no script (teto 5, n_critica_solo, encerra a rodada no SOLO).
//  Parte 2 — o classificador critica-solo.ts (puro): fiscal/financeiro/RLS/NR-36 → SOLO; função/estrutura → batelável;
//            migration ilegível → SOLO (viés de segurança).
//  Parte 3 — o comportamento real contra o `gh` simulado: até 5 críticas batelam num @pos; teto respeitado; SOLO publica
//            sozinha e encerra a rodada; e o CAMINHO DE FALHA — @pos do lote vermelho segura toda crítica seguinte.
import { readFileSync } from 'node:fs'
import { criticaSolo } from '../merge/critica-solo'
import { soDemoBatelavel } from '../merge/so-demo-batelavel'
import { SCRIPT_FILA, comFilaSimulada, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    falhas++
    console.error('✗', msg)
  } else console.log('✓', msg)
}

// ── Parte 1: a mecânica está no script ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/LOTE_MIG_CRIT_MAX=\$\{LOTE_MIG_CRIT_MAX:-5\}/.test(sh), 'teto do lote de críticas = 5 por padrão (CEO 01/11)')
ok(/n_critica_solo=0/.test(sh), 'n_critica_solo declarado (carve-out das categorias perigosas)')
ok(/critica-solo\.ts/.test(sh), 'a fila chama o classificador critica-solo.ts')
ok(/index\("conserto-main"\)/.test(sh) && /n_critica_solo=1/.test(sh), 'conserto-main é SOLO (pela etiqueta)')
ok(/n_critica_solo" = 1 \] && \[ "\$lote_mig_n" -gt 0/.test(sh), 'SOLO não entra num lote já aberto (publica sozinha)')
ok(/n_critica_solo" = 1 \][\s\S]*encerra a rodada/.test(sh) || /SOLO: encerra|encerra a rodada \(publica sozinha/.test(sh),
  'SOLO encerra a rodada ao publicar (nada batela no @pos dela)')
ok(/n_critica" = 1 \] && \[ "\$n_critica_solo" = 0 \] && \[ "\$lote_mig_crit_n" -ge "\$LOTE_MIG_CRIT_MAX"/.test(sh),
  'o teto de críticas vale só para as BATELÁVEIS (n_critica_solo=0)')
// SO-DEMO (CEO 21/11): a label `so-demo` numa PR revisada rebaixa a crítica de SOLO p/ BATELÁVEL (backstop de segurança).
ok(/so-demo-batelavel\.ts/.test(sh), 'a fila chama o classificador so-demo-batelavel.ts (label so-demo)')
ok(/index\("so-demo"\)/.test(sh) && /n_critica_solo=0/.test(sh), 'label so-demo rebaixa a crítica p/ BATELÁVEL (n_critica_solo=0)')
ok(/batelavel == true/.test(sh), 'so-demo: só rebaixa com .batelavel==true EXPLÍCITO (viés p/ SOLO)')
ok(/index\("conserto-main"\)/.test(sh) && /so-demo/.test(sh), 'conserto-main nunca é so-demo (fica SOLO)')

// ── Parte 2: o classificador puro ──
const diz = (r: { solo: boolean }) => (r.solo ? 'SOLO' : 'batelável')
ok(criticaSolo([{ nome: 'supabase/migrations/1_x.sql', conteudo: 'create table nfe_lote(id int);' }]).solo,
  'fiscal (nfe) no conteúdo → SOLO')
ok(criticaSolo([{ nome: 'supabase/migrations/1_x.sql', conteudo: 'update titulos set pago = true;' }]).solo,
  'financeiro de cliente (titulos) no conteúdo → SOLO')
ok(criticaSolo([{ nome: 'supabase/migrations/1_x.sql', conteudo: 'create policy p on erp_clientes for select using (true);' }]).solo,
  'RLS/policy em tabela existente → SOLO')
ok(criticaSolo([{ nome: 'supabase/migrations/1_nr36.sql', conteudo: 'select 1;' }]).solo,
  'NR-36 pelo caminho do arquivo → SOLO')
ok(criticaSolo([{ nome: 'src/app/dashboard/fiscal/page.tsx' }]).solo, 'tela fiscal pelo caminho → SOLO')
ok(!criticaSolo([{ nome: 'supabase/migrations/1_x.sql', conteudo: 'drop function if exists fn_auditor_matriz_disparar(text); create function fn_auditor_matriz_disparar(text) returns void language sql as $$ select 1 $$;' }]).solo,
  'DROP+CREATE de função (padrão #3599) → batelável')
ok(!criticaSolo([{ nome: 'supabase/migrations/1_x.sql', conteudo: 'create table erp_catalogo_novo(id int); alter table erp_catalogo_novo enable row level security;' }]).solo,
  'tabela NOVA com RLS própria (aditivo) → batelável')
ok(criticaSolo([{ nome: 'supabase/migrations/1_x.sql' }]).solo, 'migration sem conteúdo p/ avaliar → SOLO (viés de segurança)')
ok(!criticaSolo([{ nome: 'e2e/x.spec.ts' }, { nome: 'docs/y.md' }]).solo, 'só teste/doc → batelável (ignora)')
void diz

// ── Parte 2b: o classificador so-demo-batelavel.ts (puro) — backstop de segurança da label so-demo (CEO 21/11) ──
const bat = (r: { batelavel: boolean }) => (r.batelavel ? 'batelável' : 'SOLO')
ok(soDemoBatelavel([{ nome: 'supabase/migrations/1_demo.sql', conteudo: 'delete from titulos where company_id in (select id from companies where is_demo);' }]).batelavel,
  'so-demo: DML de dado financeiro SÓ na DEMO (titulos), sem DDL → BATELÁVEL (is_demo cobre a linha)')
ok(soDemoBatelavel([{ nome: 'supabase/migrations/1_demo.sql', conteudo: "insert into erp_bot_config(id, nome) values (1, 'demo') on conflict do nothing;" }]).batelavel,
  'so-demo: INSERT de dado demo em tabela não-fiscal (bot P&M) → BATELÁVEL')
ok(!soDemoBatelavel([{ nome: 'supabase/migrations/1_demo.sql', conteudo: 'insert into nfe_lote(id) values (1);' }]).batelavel,
  'so-demo + fiscal (nfe) no conteúdo → SOLO (is_demo não cobre a nota fiscal)')
ok(!soDemoBatelavel([{ nome: 'supabase/migrations/1_demo.sql', conteudo: 'alter table veic_veiculo add column demo_flag boolean;' }]).batelavel,
  'so-demo + DDL em tabela de domínio (ALTER existente) → SOLO (muda o schema de todas as empresas)')
ok(!soDemoBatelavel([{ nome: 'supabase/migrations/1_demo.sql', conteudo: 'create policy p on erp_clientes for select using (true);' }]).batelavel,
  'so-demo + RLS/policy em tabela existente → SOLO')
ok(!soDemoBatelavel([{ nome: 'supabase/migrations/1_nr36_demo.sql', conteudo: 'select 1;' }]).batelavel,
  'so-demo + NR-36 pelo caminho → SOLO')
ok(!soDemoBatelavel([{ nome: 'src/app/dashboard/fiscal/page.tsx' }]).batelavel, 'so-demo + tela fiscal pelo caminho → SOLO')
ok(!soDemoBatelavel([{ nome: 'supabase/migrations/1_demo.sql' }]).batelavel,
  'so-demo sem conteúdo p/ avaliar → SOLO (viés de segurança)')
void bat

// ── Parte 3: o comportamento real ──
if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente (as partes 1 e 2 continuam valendo)')
} else {
  comFilaSimulada((rodar) => {
    // crítica BATELÁVEL: revisao-eng-chefe + autorizada + migration, SQL estrutural (não cai no carve-out).
    const crit = (n: number) => ({ n, labels: ['revisao-eng-chefe'], autorizada: true, migration: true,
      sqlMigration: `create function fn_nova_${n}() returns void language sql as $$ select 1 $$;` })
    // crítica SOLO: conteúdo fiscal.
    const solo = (n: number) => ({ n, labels: ['revisao-eng-chefe'], autorizada: true, migration: true,
      sqlMigration: `insert into nfe_lote(id) values (${n});` })

    // 1) teto PADRÃO (5): 4 críticas bateláveis publicam TODAS numa rodada só (um @pos para o lote).
    let x = rodar([crit(1), crit(2), crit(3), crit(4)], false, 5000, {}, {})
    ok([1, 2, 3, 4].every((n) => merges(x.escritas).includes(n)),
      '1) teto 5: 4 críticas bateláveis publicam no MESMO lote (um @pos)')

    // 2) teto = 1 (env): volta ao comportamento antigo — só 1 crítica por rodada.
    x = rodar([crit(1), crit(2), crit(3)], false, 5000, { LOTE_MIG_CRIT_MAX: '1' }, {})
    ok(merges(x.escritas).length === 1, '2) LOTE_MIG_CRIT_MAX=1: só 1 crítica publica (comportamento antigo)')

    // 3) SOLO publica SOZINHA e ENCERRA a rodada: [solo, batelável] → só a solo sai.
    x = rodar([solo(1), crit(2)], false, 5000, {}, {})
    ok(merges(x.escritas).includes(1) && !merges(x.escritas).includes(2),
      '3) crítica SOLO (fiscal) publica sozinha e encerra a rodada (batelável espera)')

    // 4) SOLO não entra num lote já aberto: [batelável, solo] → só a batelável sai nesta rodada.
    x = rodar([crit(1), solo(2)], false, 5000, {}, {})
    ok(merges(x.escritas).includes(1) && !merges(x.escritas).includes(2),
      '4) crítica SOLO não batela num lote já aberto (espera a próxima rodada)')

    // 5) CAMINHO DE FALHA: @pos do lote anterior VERMELHO segura TODA crítica seguinte (zero regressão no crítico).
    x = rodar([crit(1), crit(2)], false, 5000, {}, { conclusion: 'failure', specs: ['e2e/x.spec.ts'], headPr: 1 })
    ok(merges(x.escritas).length === 0,
      '5) caminho de falha: @pos do lote vermelho → nenhuma crítica publica (o guardião bisseta/reverte)')

    // ── SO-DEMO (CEO 21/11): a label `so-demo` numa PR revisada+autorizada rebaixa a crítica de SOLO p/ BATELÁVEL ──
    // so-demo VÁLIDO: DML de dado financeiro guardado por is_demo, sem DDL de estrutura.
    const soDemo = (n: number) => ({ n, labels: ['revisao-eng-chefe', 'so-demo'], autorizada: true, migration: true,
      sqlMigration: `delete from titulos where company_id in (select id from companies where is_demo);` })
    // MESMA migration SEM a label so-demo: cai no carve-out financeiro do critica-solo → SOLO (como hoje).
    const soDemoSemLabel = (n: number) => ({ n, labels: ['revisao-eng-chefe'], autorizada: true, migration: true,
      sqlMigration: `delete from titulos where company_id in (select id from companies where is_demo);` })
    // so-demo mas com DDL de ESTRUTURA em tabela de domínio: critica-solo marca SOLO (token `titulo`), e o backstop
    // MANTÉM SOLO — o ALTER muda o schema de TODAS as empresas, não só da DEMO (is_demo não cobre). Diferente do cenário
    // 6 (DELETE de dado demo em titulos), onde SÓ o DML financeiro é rebaixado p/ batelável.
    const soDemoDdl = (n: number) => ({ n, labels: ['revisao-eng-chefe', 'so-demo'], autorizada: true, migration: true,
      sqlMigration: `alter table titulos add column obs_demo text;` })

    // 6) so-demo VÁLIDO é BATELÁVEL: batela com outra crítica no MESMO lote (um @pos para as duas).
    x = rodar([soDemo(1), crit(2)], false, 5000, {}, {})
    ok(merges(x.escritas).includes(1) && merges(x.escritas).includes(2),
      '6) so-demo comprovado (DML financeiro só-demo) é BATELÁVEL: batela com outra crítica no mesmo @pos')

    // 7) so-demo + DDL em tabela de domínio: backstop mantém SOLO (publica sozinha e encerra a rodada).
    x = rodar([soDemoDdl(1), crit(2)], false, 5000, {}, {})
    ok(merges(x.escritas).includes(1) && !merges(x.escritas).includes(2),
      '7) so-demo + DDL de estrutura: backstop mantém SOLO (publica sozinha, encerra a rodada)')

    // 8) SEM a label so-demo, a MESMA migration financeira é SOLO como hoje (batelável atrás dela espera).
    x = rodar([soDemoSemLabel(1), crit(2)], false, 5000, {}, {})
    ok(merges(x.escritas).includes(1) && !merges(x.escritas).includes(2),
      '8) sem a label so-demo: migration financeira cai no carve-out → SOLO (como hoje)')
  })
}

if (falhas) {
  console.error(`\ncheck-fila-lote-critico: ${falhas} falha(s)`)
  process.exit(1)
}
console.log('\ncheck-fila-lote-critico: OK')

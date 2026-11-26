// Gate — ITEM A (CEO 25/11, "FILA CRÍTICA ENTUPIDA 2"): "precisa de revisão" ≠ "migration crítica". A etiqueta
// `revisao-eng-chefe` vem de TELA/cálculo/área crítica; a SERIALIZAÇÃO do @pos só precisa acontecer quando a MIGRATION
// em si é crítica. Para PR com MERGE AUTORIZADO VÁLIDO, a fila decide n_critica pelo CONTEÚDO (migracao-criticidade.ts →
// migracaoCritica de exige-via-revisada + rede do dinheiro), não pela etiqueta. Prova o classificador puro E o
// comportamento real contra o `gh` simulado, com os casos de fronteira e o viés de segurança (sem autorização → crítica).
import { readFileSync } from 'node:fs'
import { migracaoCriticidade } from '../merge/migracao-criticidade'
import { SCRIPT_FILA, comFilaSimulada, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1: o classificador puro (migracaoCriticidade) ──
// ADITIVA (não serializa) — cria objeto novo / RPC não-crítico / GRANT / índice / catálogo:
ok(!migracaoCriticidade('create table if not exists public.rh_x (id uuid primary key); alter table public.rh_x enable row level security; create policy p on public.rh_x for select using (true);').critica,
  'tabela NOVA + RLS própria (aditivo) → aditiva')
ok(!migracaoCriticidade('create or replace function public.fn_x(a int) returns int language sql as $$ select a + 1 $$;').critica,
  'CREATE OR REPLACE FUNCTION em tabela não-crítica → aditiva')
ok(!migracaoCriticidade('create index if not exists idx_x on public.erp_lancamentos (company_id);').critica, 'CREATE INDEX novo → aditiva')
ok(!migracaoCriticidade('grant execute on function public.fn_x(int) to authenticated;').critica, 'GRANT → aditiva')
ok(!migracaoCriticidade("insert into public.erp_ajuda_campo (chave, rotulo) values ('a','b') on conflict (chave) do nothing;").critica, 'INSERT em catálogo → aditiva')
ok(!migracaoCriticidade('create or replace function public.fn_r() returns numeric language sql as $$ select sum(valor_pago) from erp_receber $$;').critica,
  'RPC que só LÊ (SELECT) erp_receber no corpo → aditiva (não move dinheiro)')

// CRÍTICA (serializa o @pos) — muta objeto existente / RLS existente / view / dinheiro:
ok(migracaoCriticidade('alter table public.erp_clientes add column z int;').critica, 'ALTER em tabela existente → crítica')
ok(migracaoCriticidade('create or replace view public.v_x as select 1;').critica, 'CREATE OR REPLACE VIEW (muda leitura existente) → crítica')
ok(migracaoCriticidade('update public.titulos set pago = true where id = 1;').critica, 'UPDATE em tabela crítica (titulos) → crítica')
ok(migracaoCriticidade('drop table public.alguma_coisa;').critica, 'DROP de objeto existente → crítica')
ok(migracaoCriticidade('create policy p on public.erp_clientes for select using (true);').critica, 'policy/RLS em tabela existente → crítica')
// FRONTEIRA — rede de segurança do dinheiro (RD-103): RPC cujo CORPO move dinheiro em tabela de movimento (não coberta
// pela TABELA_CRITICA do migracaoCritica) continua crítica.
ok(migracaoCriticidade('create or replace function public.fn_y() returns void language plpgsql as $$ begin update erp_receber set valor_pago = 0; end $$;').critica,
  'FRONTEIRA: RPC cujo corpo faz UPDATE em erp_receber → crítica (rede do dinheiro, RD-103)')
ok(migracaoCriticidade('create or replace function public.fn_z() returns void language plpgsql as $$ begin insert into erp_pagar (valor) values (1); end $$;').critica,
  'FRONTEIRA: RPC cujo corpo faz INSERT em erp_pagar → crítica (rede do dinheiro, RD-103)')
// FRONTEIRA — bloco DO/anônimo (DDL dinâmico em tempo de migration) → crítica; EXECUTE no CORPO de RPC → aditiva.
ok(migracaoCriticidade("do $$ begin execute 'alter table public.x enable row level security'; end $$;").critica,
  'FRONTEIRA: bloco DO/anônimo (ALTER via EXECUTE em tempo de migration) → crítica (viés de segurança)')
ok(!migracaoCriticidade('create or replace function public.fn_d(t text) returns void language plpgsql as $$ begin execute format(\'select 1 from %I\', t); end $$;').critica,
  'FRONTEIRA: EXECUTE no CORPO de uma RPC (dinâmica legítima, roda no call-time) → aditiva')
// VIÉS DE SEGURANÇA: vazio/ilegível → crítica
ok(migracaoCriticidade('').critica, 'migration vazia/ilegível → crítica (viés de segurança)')

// ── Parte 2: a mecânica está no script ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/migracao-criticidade\.ts/.test(sh), 'a fila chama o classificador migracao-criticidade.ts')
ok(/autoriz_cache=\$\(autorizacao "\$n"\)/.test(sh), 'a autorização é calculada e cacheada no bloco de criticidade (gate: só autorizada rebaixa)')
ok(/if \.critica == false then "nao" else "sim"/.test(sh), 'viés de segurança: só rebaixa com .critica==false EXPLÍCITO (crash/true → crítica)')
ok(/autoriz_cache" = ok \][\s\S]*?migracao-criticidade\.ts[\s\S]*?n_critica=0/.test(sh), 'rebaixa p/ aditiva SÓ quando autorizada E conteúdo aditivo')
ok(/a=\$\{autoriz_cache:-\$\(autorizacao "\$n"\)\}/.test(sh), 'a via revisada reusa a autorização cacheada (sem 2ª chamada)')

// ── Parte 3: comportamento real contra o `gh` simulado ──
if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente (as partes 1 e 2 continuam valendo)')
} else {
  comFilaSimulada((rodar) => {
    const ADITIVA = 'create or replace function public.fn_nova(a int) returns int language sql as $$ select a $$;\n'
    const CRITICA = 'alter table erp_clientes add column z int;\n'

    // 1) AUTORIZADA + conteúdo ADITIVO: com @pos de crítica VERMELHO, publica mesmo assim (batela como aditiva).
    let x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], autorizada: true, migration: true, aceitacao: 'success', sqlMigration: ADITIVA }],
      false, 5000, {}, { conclusion: 'failure', specs: ['e2e/x.spec.ts'], headPr: 1 })
    ok(merges(x.escritas).includes(1) && /migration ADITIVA pelo conteúdo/.test(x.log),
      '1) autorizada + conteúdo aditivo (CREATE OR REPLACE FUNCTION) → batela como aditiva (não espera o @pos de crítica)')

    // 2) AUTORIZADA + conteúdo CRÍTICO: com @pos de crítica VERMELHO, ESPERA (serialização intacta).
    x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], autorizada: true, migration: true, aceitacao: 'success', sqlMigration: CRITICA }],
      false, 5000, {}, { conclusion: 'failure', specs: ['e2e/x.spec.ts'], headPr: 1 })
    ok(merges(x.escritas).length === 0, '2) autorizada + conteúdo crítico (ALTER existente) → continua crítica (espera o @pos)')

    // 3) VIÉS DE SEGURANÇA: conteúdo aditivo mas SEM autorização → NÃO publica (não rebaixa sem o OK do revisor).
    x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], autorizada: false, migration: true, aceitacao: 'success', sqlMigration: ADITIVA }],
      false, 5000, {}, { conclusion: 'failure', specs: ['e2e/x.spec.ts'], headPr: 1 })
    ok(merges(x.escritas).length === 0, '3) sem MERGE AUTORIZADO → não rebaixa p/ aditiva (fica bloqueada; viés de segurança)')

    // 4) conserto-main NUNCA é rebaixado: mesmo com conteúdo aditivo e autorizado, continua crítico/SOLO (@pos vermelho → espera).
    x = rodar([{ n: 1, labels: ['revisao-eng-chefe', 'conserto-main'], autorizada: true, migration: true, aceitacao: 'success', sqlMigration: ADITIVA }],
      false, 5000, {}, { conclusion: 'failure', specs: ['e2e/x.spec.ts'], headPr: 1 })
    ok(merges(x.escritas).length === 0, '4) conserto-main (conteúdo aditivo) → NÃO rebaixa; continua crítico/SOLO (espera o @pos)')
  })
}

if (falhas) { console.error(`\ncheck-fila-criticidade-conteudo: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — criticidade por conteúdo (item A): ok')

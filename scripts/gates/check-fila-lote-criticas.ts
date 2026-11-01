// Gate (CEO 01/11) — LOTE DE MIGRATIONS CRÍTICAS + exceção SEMPRE SOZINHA.
// Com a fila crítica em 44 e vazão de 2-3/h, o CEO aprovou batelar até LOTE_MIG_CRIT_MAX (5) migrations CRÍTICAS
// independentes sob UM só @pos. EXCEÇÃO: as de núcleo ULTRA-sensível (NR-36, fiscal, financeiro de cliente,
// RLS/permissão/LGPD) e qualquer conserto-main publicam SOZINHAS — fora do lote, com @pos próprio. Um erro numa dessas
// é inaceitável e o revert de migration não desfaz o que rodou no banco (RD-52 / reverter-automatico.sh trava 3).
//
// Prova o classificador puro (migracao-sempre-sozinha) e a fila de verdade (fila-merge.sh), incluindo o CAMINHO DE
// FALHA: a sozinha nunca é batelada (atribuição da falha inequívoca, sem precisar bissectar um lote).
import { readFileSync } from 'node:fs'
import { migracaoSozinha } from '../merge/migracao-sempre-sozinha'
import { SCRIPT_FILA, comFilaSimulada, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── leitura do script: a mecânica do lote de críticas e da sozinha está na fila ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/LOTE_MIG_CRIT_MAX=\$\{LOTE_MIG_CRIT_MAX:-5\}/.test(sh), 'teto do lote de críticas = 5 por padrão (CEO 01/11)')
ok(/com_migration=0; so_docs=0; n_critica=0; n_sozinha=0/.test(sh), 'n_sozinha é inicializado a cada PR')
ok(/index\("conserto-main"\)[\s\S]*?n_sozinha=1/.test(sh), 'conserto-main (pela label) publica sozinha')
ok(/migracao-sempre-sozinha\.ts[\s\S]*?n_sozinha=1/.test(sh), 'a fila consulta o classificador de núcleo ultra-sensível')
ok(/jq -r '\.sozinha'[\s\S]*?!= false/.test(sh), 'viés de segurança: só "false" explícito não é sozinha (erro/vazio → sozinha)')
ok(/n_sozinha" = 1 \] && \{ \[ "\$lote_mig_n" -gt 0 \] \|\| \[ "\$merges" -gt 0 \]/.test(sh), 'a sozinha espera a próxima rodada se já houve migration/merge (é a única da rodada)')
ok(/n_sozinha" = 1 \] \|\| \[ "\$lote_mig_n" -ge "\$LOTE_MIG_MAX"/.test(sh), 'o merge de uma sozinha encerra a rodada (exit 0) para ter o @pos só dela')

// ── classificador puro ──
ok(migracaoSozinha('', 'alter table public.nota_fiscal add column obs text;').sozinha, 'fiscal (nota_fiscal) → sozinha')
ok(migracaoSozinha('supabase/migrations/20261101000030_boleto.sql', 'select 1;').sozinha, 'financeiro no NOME do arquivo (boleto) → sozinha')
ok(migracaoSozinha('', 'create policy "p" on public.erp_x for all using (true);').sozinha, 'RLS/policy → sozinha')
ok(migracaoSozinha('', 'alter table public.folha_pag add column y int;').sozinha, 'LGPD/salários (folha_pag) → sozinha')
ok(migracaoSozinha('', 'create table public.nr36_epi (id int);').sozinha, 'NR-36 → sozinha')
ok(migracaoSozinha('', 'revoke all on public.titulos from anon;').sozinha, 'permissão (revoke/título) → sozinha')
ok(!migracaoSozinha('', 'create table public.relatorio (id int); create index i on public.relatorio(id);').sozinha, 'crítica comum (relatório) → batelável, não sozinha')
ok(!migracaoSozinha('', 'create or replace function public.fn_x() returns int language sql as $$ select 1 $$;').sozinha, 'função nova comum → batelável')
ok(migracaoSozinha('', undefined).sozinha, 'migration sem conteúdo → sozinha (viés de segurança)')
ok(migracaoSozinha('', '   ').sozinha, 'SQL vazio → sozinha (viés de segurança)')
// não casa palavra dentro de literal/comentário (texto de ajuda que menciona "fiscal" não torna a migration sozinha)
ok(!migracaoSozinha('', "insert into public.cat_x(id, txt) values (1, 'texto sobre nota fiscal'); -- fiscal").sozinha, 'palavra em literal/comentário não conta (catálogo com texto)')

// ── fila simulada (roda o fila-merge.sh de verdade) ──
const A = 'create table public.t_a (id int);\n'
const B = 'create table public.t_b (id int);\n'
const C = 'create or replace function public.fn_c() returns int language sql as $$ select 1 $$;\n'
const D = 'create table public.t_d (id int);\n'
const FISCAL = 'alter table public.nota_fiscal add column obs text;\n'
const RLS = 'create policy "p" on public.erp_x for all using (true);\n'
const rev = { labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'success' as const, migration: true }
const conserto = { labels: ['conserto-main', 'revisao-eng-chefe'], autorizada: true, aceitacao: 'success' as const, migration: true }
if (!temFerramentas()) console.log('… cenários da fila pulados: jq ou git ausente')
else comFilaSimulada((rodar) => {
  // LOTE DE CRÍTICAS: 4 críticas comuns independentes batelam sob o teto 5
  let x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2, ...rev, sqlMigration: B }, { n: 3, ...rev, sqlMigration: C }, { n: 4, ...rev, sqlMigration: D }])
  ok(merges(x.escritas).join() === '1,2,3,4', 'fila: 4 críticas comuns independentes batelam (teto 5)')
  // o teto corta o excedente (o simulador só provê 4 PRs, então provamos o corte com LOTE_MIG_CRIT_MAX=3 → bate 3 de 4)
  x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2, ...rev, sqlMigration: B }, { n: 3, ...rev, sqlMigration: C }, { n: 4, ...rev, sqlMigration: D }], false, 5000, { LOTE_MIG_CRIT_MAX: '3' })
  ok(merges(x.escritas).join() === '1,2,3', 'fila: o teto LOTE_MIG_CRIT_MAX corta a crítica excedente para a próxima rodada')
  // CAMINHO DE FALHA / ISOLAMENTO: uma crítica fiscal publica SOZINHA mesmo com outras críticas prontas na fila
  x = rodar([{ n: 1, ...rev, sqlMigration: FISCAL }, { n: 2, ...rev, sqlMigration: B }, { n: 3, ...rev, sqlMigration: C }])
  ok(merges(x.escritas).join() === '1', 'fila: crítica FISCAL publica SOZINHA (encerra a rodada; atribuição inequívoca)')
  // RLS/policy também sozinha
  x = rodar([{ n: 1, ...rev, sqlMigration: RLS }, { n: 2, ...rev, sqlMigration: B }])
  ok(merges(x.escritas).join() === '1', 'fila: crítica de RLS/policy publica SOZINHA')
  // conserto-main (pela label) publica sozinha
  x = rodar([{ n: 1, ...conserto, sqlMigration: A }, { n: 2, ...rev, sqlMigration: B }])
  ok(merges(x.escritas).join() === '1', 'fila: conserto-main publica SOZINHA')
  // a sozinha não entra em lote JÁ aberto: crítica comum entra primeiro, a fiscal espera a próxima rodada
  x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2, ...rev, sqlMigration: FISCAL }, { n: 3, ...rev, sqlMigration: C }])
  ok(merges(x.escritas).join() === '1,3', 'fila: a sozinha (fiscal) NÃO entra em lote aberto — espera; a comum independente segue')
  // teto configurável (prova dos dois lados): LOTE_MIG_CRIT_MAX=2 bate 2 comuns
  x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2, ...rev, sqlMigration: B }, { n: 3, ...rev, sqlMigration: C }], false, 5000, { LOTE_MIG_CRIT_MAX: '2' })
  ok(merges(x.escritas).join() === '1,2', 'fila: LOTE_MIG_CRIT_MAX=2 bate 2 críticas; LOTE_MIG_CRIT_MAX=1 volta ao antigo')
})

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — lote de críticas + sempre sozinha: ok')

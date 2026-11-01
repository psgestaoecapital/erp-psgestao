// Gate (CEO 01/11) — LOTE DE MIGRATIONS CRÍTICAS. Com a fila crítica em ~44 e crescendo (cada crítica sozinha esperava
// ~20 min do seu @pos, vazão 2-3/h), o CEO aprovou batelar até LOTE_MIG_CRIT_MAX (padrão 5) críticas INDEPENDENTES numa
// rodada, com UM @pos para o lote. A cautela fica nas migrations de MAIOR risco, que publicam SOZINHAS (nunca batelam):
// NR-36, fiscal, financeiro de cliente, RLS/permissão, LGPD, Wealth/CVM e qualquer `conserto-main`.
//
// Este gate prova, SEM rede/banco: (1) o teto padrão de críticas é 5; (2) a fila consulta o classificador de risco
// máximo; (3) o classificador puro migracaoSempreSozinha reconhece cada área (fiscal/financeiro/RLS/LGPD/NR-36) e deixa
// passar a crítica comum; (4) na fila simulada (fila-merge.sh de verdade): críticas comuns batelam; a de risco máximo e a
// `conserto-main` publicam SOZINHAS (encerram a rodada / esperam a próxima se o lote já abriu).
import { readFileSync } from 'node:fs'
import { migracaoSempreSozinha } from '../merge/migracao-sempre-sozinha'
import { SCRIPT_FILA, comFilaSimulada, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── leitura do script ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/LOTE_MIG_CRIT_MAX=\$\{LOTE_MIG_CRIT_MAX:-5\}/.test(sh), 'teto padrão de críticas por rodada = 5 (lote de críticas)')
ok(/migracao-sempre-sozinha\.ts/.test(sh), 'a fila consulta o classificador de risco máximo (migracao-sempre-sozinha.ts)')
ok(/index\("conserto-main"\)/.test(sh), 'a fila trata conserto-main (label) como sempre-sozinha')
ok(/"\$n_sozinha" = 1 \] && \[ "\$lote_mig_n" -gt 0 \].*espera a próxima/.test(sh), 'a sozinha espera a próxima rodada se já há lote aberto (é exclusiva)')
ok(/"\$n_sozinha" = 1 \]; then log[^\n]*MERGEADA SOZINHA[^\n]*exit 0/.test(sh), 'ao mergear a sozinha, a rodada encerra (o @pos do lote avalia só ela)')

// ── classificador puro ──
const S = (sql?: string, arqs: string[] = ['supabase/migrations/20261101000030_x.sql']) => migracaoSempreSozinha(arqs, sql)
ok(S('create table public.nfe_lote (id int);').sozinha, 'classificador: fiscal (nfe) no SQL → sozinha')
ok(S('insert into public.titulos (id) values (1);').sozinha, 'classificador: mexe em dado financeiro de cliente (titulos) → sozinha')
ok(S('create policy "p" on public.erp_pedidos for select using (true);').sozinha, 'classificador: RLS/policy em tabela existente → sozinha')
ok(S('alter table public.erp_clientes enable row level security;').sozinha, 'classificador: liga RLS em tabela existente → sozinha')
ok(S('select 1;', ['src/fiscal/nota.tsx', 'supabase/migrations/20261101000030_x.sql']).sozinha, 'classificador: área fiscal no NOME do arquivo → sozinha')
ok(S('select 1;', ['src/compliance/lgpd-consentimento.ts', 'supabase/migrations/x.sql']).sozinha, 'classificador: LGPD no nome do arquivo → sozinha')
ok(S('select 1;', ['e2e/nr-36/jornada.spec.ts', 'supabase/migrations/x.sql']).sozinha === false, 'classificador: token só em arquivo de TESTE (e2e/) é ignorado — não é sozinha por isso')
ok(S('create table public.t_novo (id int);\ncreate index i on public.t_novo(id);\n').sozinha === false, 'classificador: migration aditiva comum (tabela/índice novos) → NÃO sozinha (pode batelar)')
ok(S('create or replace function public.fn_x() returns int language sql as $$ select 1 $$;').sozinha === false, 'classificador: função nova comum → NÃO sozinha')

// ── fila simulada (roda o fila-merge.sh de verdade) ──
const crit = { labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'success' as const, migration: true }
const A = 'create table public.t_a (id int);\n'
const B = 'create table public.t_b (id int);\n'
const C = 'create table public.t_c (id int);\n'
const Dt = 'create table public.t_d (id int);\n'
const FISCAL = 'create table public.nfe_lote (id int);\n'   // área fiscal → sozinha
if (!temFerramentas()) console.log('… cenários da fila pulados: jq ou git ausente')
else comFilaSimulada((rodar) => {
  // 4 críticas COMUNS independentes batelam numa rodada (teto padrão 5)
  let x = rodar([{ n: 1, ...crit, sqlMigration: A }, { n: 2, ...crit, sqlMigration: B }, { n: 3, ...crit, sqlMigration: C }, { n: 4, ...crit, sqlMigration: Dt }])
  ok(merges(x.escritas).join() === '1,2,3,4', 'fila: 4 críticas comuns independentes batelam no lote (teto 5)')
  // a de RISCO MÁXIMO (fiscal) publica SOZINHA: entra 1ª, encerra a rodada; a comum atrás espera
  x = rodar([{ n: 1, ...crit, sqlMigration: FISCAL }, { n: 2, ...crit, sqlMigration: B }])
  ok(merges(x.escritas).join() === '1', 'fila: migration de risco máximo (fiscal) publica SOZINHA e encerra a rodada')
  // sozinha é EXCLUSIVA: se o lote já abriu com comuns, a sozinha espera a próxima rodada (as comuns batelam)
  x = rodar([{ n: 1, ...crit, sqlMigration: A }, { n: 2, ...crit, sqlMigration: B }, { n: 3, ...crit, sqlMigration: FISCAL }])
  ok(merges(x.escritas).join() === '1,2', 'fila: comuns batelam; a de risco máximo espera a próxima rodada (não entra no lote)')
  // conserto-main (label) também publica sozinha
  x = rodar([{ n: 1, ...crit, labels: ['revisao-eng-chefe', 'conserto-main'], sqlMigration: A }, { n: 2, ...crit, sqlMigration: B }])
  ok(merges(x.escritas).join() === '1', 'fila: conserto-main publica SOZINHA e encerra a rodada')
  // o teto continua configurável (prova do outro lado): LOTE_MIG_CRIT_MAX=1 volta ao comportamento antigo (1/rodada)
  x = rodar([{ n: 1, ...crit, sqlMigration: A }, { n: 2, ...crit, sqlMigration: B }], false, 5000, { LOTE_MIG_CRIT_MAX: '1' })
  ok(merges(x.escritas).join() === '1', 'fila: LOTE_MIG_CRIT_MAX=1 mantém 1 crítica por rodada (comportamento antigo)')
})

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — lote de migrations críticas (sempre-sozinha nas áreas de risco máximo): ok')

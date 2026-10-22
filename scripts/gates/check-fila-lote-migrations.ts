// Gate (CEO 16/10) — LOTE DE MIGRATIONS INDEPENDENTES por rodada. A fila publica até LOTE_MIG_MAX (3) PRs COM migration
// na mesma rodada, desde que INDEPENDENTES (scripts/merge/migrations-independentes.ts). Qualquer dúvida → 1 por rodada.
// Casos: 3 independentes publicam juntas; mesma tabela não entra junto; dependência impede o lote; sensível sem
// autorização fica fora; dúvida (SQL ilegível/dinâmico) cai para 1.
import { readFileSync } from 'node:fs'
import { independentes } from '../merge/migrations-independentes'
import { SCRIPT_FILA, comFilaSimulada, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── leitura do script ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/LOTE_MIG_MAX=\$\{LOTE_MIG_MAX:-3\}/.test(sh), 'LOTE_MIG_MAX padrão 3 (LOTE_MIG_MAX=1 volta ao comportamento antigo)')
ok(/migrations-independentes\.ts/.test(sh) && /duvida:checagem falhou/.test(sh), 'a fila consulta o analisador de independência e, se ele falha, é dúvida')
ok(/lote_mig_n" -ge "\$LOTE_MIG_MAX"/.test(sh), 'o lote de migrations fecha no teto')
ok(/\[ "\$com_migration" = 1 \] && \[ "\$corrige_deploy" = 0 \] && \[ "\$lote_mig_n" = 0 \]/.test(sh), 'estado_main (deploy + @pos da main) só vale para a 1ª do lote')

// ── analisador ──
const A = 'create table public.t_a (id int);\ncreate index i_a on public.t_a(id);\n'
const B = 'create table public.t_b (id int);\nalter table public.t_b add column x int;\n'
const C = 'create or replace function public.fn_c() returns int language sql as $$ select 1 $$;\n'
const AA = 'alter table public.t_a add column y int;\n'
const DEP = 'create view public.v_d as select * from public.t_a;\n'
ok(independentes(B, [A]) === 'ok', 'analisador: tabelas diferentes → independentes')
ok(independentes(C, [A, B]) === 'ok', 'analisador: função nova + 2 tabelas distintas → independentes')
ok(independentes(AA, [A]).startsWith('duvida:'), 'analisador: duas migrations na mesma tabela → NÃO independentes')
ok(independentes(DEP, [A]).startsWith('duvida:'), 'analisador: view que usa tabela criada por outra do lote → dependência')
ok(independentes(B, [DEP]) === 'ok', 'analisador: sem relação → ok')
ok(independentes('do $$ begin execute \'drop table x\'; end $$;', [A]).startsWith('duvida:'), 'analisador: SQL dinâmico → dúvida')
ok(independentes('', [A]).startsWith('duvida:'), 'analisador: SQL ilegível/vazio → dúvida')
ok(independentes('select 1;', [A]).startsWith('duvida:'), 'analisador: nenhum objeto identificado → dúvida')
ok(independentes('create policy "p" on public.t_a for select using (true);', [A]).startsWith('duvida:'), 'analisador: policy na tabela do lote → mesma tabela')
ok(independentes('insert into public.cat_x(id) values (1);', [A]) === 'ok', 'analisador: INSERT em catálogo distinto → independente')
ok(independentes('insert into public.t_a(id) values (1);', [A]).startsWith('duvida:'), 'analisador: INSERT na tabela do lote → dúvida')

// ── fila simulada (roda o fila-merge.sh de verdade) ──
const rev = { labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'success' as const, migration: true }
if (!temFerramentas()) console.log('… cenários da fila pulados: jq ou git ausente')
else comFilaSimulada((rodar) => {
  let x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2, ...rev, sqlMigration: B }, { n: 3, ...rev, sqlMigration: C }])
  ok(merges(x.escritas).join() === '1,2,3', 'fila: 3 migrations independentes publicam juntas na mesma rodada')
  x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2, ...rev, sqlMigration: AA }, { n: 3, ...rev, sqlMigration: C }])
  ok(merges(x.escritas).join() === '1,3', 'fila: a que toca a mesma tabela fica para a próxima rodada; a independente entra')
  x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2, ...rev, sqlMigration: DEP }])
  ok(merges(x.escritas).join() === '1', 'fila: dependência de objeto criado por outra do lote impede o lote')
  x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2, ...rev, autorizada: false, sqlMigration: B }, { n: 3, ...rev, sqlMigration: C }])
  ok(merges(x.escritas).join() === '1,3', 'fila: sensível sem autorização fica fora; as outras independentes seguem')
  x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2, ...rev, sqlMigration: 'select 1;' }])
  ok(merges(x.escritas).join() === '1', 'fila: dúvida (nenhum objeto identificável) cai para 1 por rodada')
  x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2, ...rev, sqlMigration: B }, { n: 3, ...rev, sqlMigration: C }, { n: 4, ...rev, sqlMigration: 'create table public.t_e (id int);' }], false, 5000, { LOTE_MIG_MAX: '2' })
  ok(merges(x.escritas).join() === '1,2', 'fila: o teto LOTE_MIG_MAX limita o lote')
  x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2, ...rev, sqlMigration: B }], false, 5000, { LOTE_MIG_MAX: '1' })
  ok(merges(x.escritas).join() === '1', 'fila: LOTE_MIG_MAX=1 mantém o comportamento antigo (1 migration por rodada)')
  x = rodar([{ n: 1, ...rev, sqlMigration: A }, { n: 2 }])
  ok(merges(x.escritas).join() === '1', 'fila: depois do lote de migrations, PR sem migration espera a próxima rodada')
})

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — lote de migrations independentes: ok')

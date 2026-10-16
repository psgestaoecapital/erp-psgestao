/**
 * Gate: lote de migrations independentes por rodada da fila (CEO 16/10 12:30).
 *   tsx scripts/gates/check-fila-lote-migrations.ts
 */
import { readFileSync } from 'node:fs'
import { montarLote, type Mig } from '../merge/lote-migrations'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }
const m = (n: number, versao: string, sql: string): Mig => ({ n, versao, sql })

const A = m(1, '20261016230010', 'CREATE TABLE public.erp_a (id int); ALTER TABLE public.erp_a ENABLE ROW LEVEL SECURITY;')
const B = m(2, '20261016230020', 'CREATE TABLE public.erp_b (id int); CREATE POLICY p_b ON public.erp_b USING (true);')
const C = m(3, '20261016230030', 'CREATE OR REPLACE FUNCTION public.fn_c() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;')
const B2 = m(4, '20261016230040', 'ALTER TABLE public.erp_a ADD COLUMN x int;')
const D = m(5, '20261016230050', 'CREATE VIEW public.vw_d AS SELECT * FROM public.erp_a;')
const OPACA = m(6, '20261016230060', 'DO $$ BEGIN PERFORM 1; END $$;')
const FORA = m(7, '20261016230015', 'CREATE TABLE public.erp_f (id int);')

ok(montarLote([A, B, C]).join() === '1,2,3', 'lote de 3 independentes publica junto')
ok(montarLote([A, B, C, m(8, '20261016230070', 'CREATE TABLE public.erp_g (i int);')]).length === 3, 'teto do lote = 3')
ok(montarLote([A, B2, C]).join() === '1,3', '2 que tocam a mesma tabela não entram juntas')
ok(montarLote([A, D, C]).join() === '1,3', 'dependência (view lê tabela da outra) impede o lote')
ok(montarLote([A, OPACA, C]).join() === '1,3', 'dúvida (migration opaca) cai para fora do lote')
ok(montarLote([OPACA, A]).join() === '6', 'dúvida: opaca na frente => 1 por rodada')
ok(montarLote([B, FORA]).join() === '2', 'número fora de ordem não entra')
ok(montarLote([A, m(9, '20261016230010', 'CREATE TABLE public.erp_h (i int);')]).join() === '1', 'versão repetida não entra')
ok(montarLote([A]).join() === '1', 'uma só segue como hoje')

const sh = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
ok(sh.includes('lote-migrations.ts'), 'fila-merge.sh usa lote-migrations.ts')
ok(sh.includes('LOTE_MIG_MAX'), 'fila-merge.sh tem teto LOTE_MIG_MAX')
ok(/sensível sem autorização fica fora/.test(sh) || sh.includes('mig_lote'), 'fila-merge.sh controla o lote de migrations')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nlote de migrations: OK')

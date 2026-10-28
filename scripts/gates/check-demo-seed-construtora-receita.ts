// Gate (Hub · semente da Construtora DEMO — receita realizada nas obras DEMO, 27/10). Sem rede.
// A semente da receita:
//  · só age na empresa demo do Hub (…0006) e só se is_demo; sem GRANT a usuário;
//  · entra pela via comercial (erp_pedidos.obra_id) — NÃO insere em fiscal (o guarda de emissão em demo fica intacto);
//  · idempotente (ON CONFLICT company_id+numero), sem DELETE/TRUNCATE;
//  · pedido = Σ valor_contratado × pct_conclusao / 100, cmv = 55%;
//  · liga no fn_demo_seed_construtora por âncora (aborta se a âncora sumir), depois do custo das tarefas.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261029120047_demo_seed_construtora_receita_obra.sql', 'utf8')
const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_receita'),
  mig.indexOf('REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_receita'))

ok(fn.length > 0, 'função nova fn_demo_seed_construtora_receita')
ok(/c constant uuid := 'b0700000-0000-4000-a000-000000000006'/.test(fn), 'semente fixa na empresa demo do Hub')
ok(/p_company_id IS DISTINCT FROM c/.test(fn) && /is_demo IS TRUE/.test(fn), 'só age na 006 e só se for demo')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_construtora_receita\(uuid\) FROM PUBLIC, anon, authenticated/.test(mig), 'sem GRANT a usuário')
ok(!/GRANT EXECUTE[^;]*(authenticated|anon)/.test(mig), 'nenhum GRANT a anon/authenticated')
ok(!/DELETE FROM|TRUNCATE/.test(fn), 'não apaga nada')
ok(/INSERT INTO erp_pedidos/.test(fn) && /ON CONFLICT \(company_id, numero\) DO UPDATE/.test(fn), 'receita via erp_pedidos, idempotente')
ok(!/erp_nfse|erp_pagar|erp_receber|erp_lancamentos/.test(fn), 'não toca fiscal nem financeiro')
ok(/sum\(i\.valor_contratado\) \* COALESCE\(o\.pct_conclusao, 0\) \/ 100/.test(fn) && /round\(b\.total \* 0\.55, 2\)/.test(fn),
  'pedido = valor contratado × % concluído; cmv 55%')

const patch = mig.slice(mig.indexOf('DO $do$'))
ok(/IF v_new = v_def THEN RAISE EXCEPTION/.test(patch) && /fn_demo_seed_construtora_custo_tarefa\(c\);\\n  PERFORM fn_demo_seed_construtora_receita\(c\)/.test(patch),
  'patch por âncora, depois do custo das tarefas')
const agora = patch.slice(patch.indexOf('-- aplica agora'))
ok(/PERFORM public\.fn_demo_seed_construtora_receita\(/.test(agora) && !/fn_demo_seed_construtora\('/.test(agora), 'aplicação imediata roda só a função nova')

// prova numérica (DEMO, 27/10): margem alocada positiva em toda obra com medição
const casos: [string, number, number, number][] = [
  ['DEMO-FC-001', 253940.40, 139667.22, 46811.52], ['DEMO-OB-001', 19858.00, 10921.90, 4210.56],
  ['DEMO-OB-002', 24572.82, 13515.05, 4458.24], ['DEMO-OB-003', 15439.98, 8491.99, 1981.44], ['DEMO-OB-004', 43215.20, 23768.36, 4458.24],
]
for (const [n, t, cmv, mo] of casos) ok(Math.round(t * 0.55 * 100) / 100 === cmv && t - cmv - mo > 0, `${n}: cmv 55% e margem positiva`)

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }

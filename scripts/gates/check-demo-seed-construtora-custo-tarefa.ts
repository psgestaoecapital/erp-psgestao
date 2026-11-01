// Gate (Hub · semente da Construtora DEMO — custo previsto nas tarefas das obras DEMO-OB-*, 25/10). Sem rede.
// A semente do custo das tarefas:
//  · só age na empresa demo do Hub (…0006) e só se is_demo; sem GRANT a usuário;
//  · só faz UPDATE de custo_previsto (não apaga, não insere, não toca financeiro/fiscal);
//  · custo da obra = Σ quantidade_contratada × custo_unitario_previsto dos itens (sem excluídos), só nas DEMO-OB-%;
//  · pesos fixos 5/35/40/20 pela ordem da etapa e a ÚLTIMA etapa leva o resto (Σ tarefas = custo dos itens ao centavo);
//  · liga no fn_demo_seed_construtora por âncora (aborta se a âncora sumir), depois da semente FC;
//  · a aplicação imediata roda só a função nova, não o reset inteiro.
// Também confere a regra de repartição em TS contra os números da DEMO (prova no PR, 24/10).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261026030000_demo_seed_construtora_custo_tarefa.sql', 'utf8')
const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_custo_tarefa'),
  mig.indexOf('REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_custo_tarefa'))

ok(fn.length > 0, 'função nova fn_demo_seed_construtora_custo_tarefa')
ok(/c constant uuid := 'b0700000-0000-4000-a000-000000000006'/.test(fn), 'semente fixa na empresa demo do Hub')
ok(/p_company_id IS DISTINCT FROM c/.test(fn) && /is_demo IS TRUE/.test(fn), 'só age na 006 e só se for demo')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_construtora_custo_tarefa\(uuid\) FROM PUBLIC, anon, authenticated/.test(mig), 'sem GRANT a usuário')
ok(!/GRANT EXECUTE[^;]*(authenticated|anon)/.test(mig), 'nenhum GRANT a anon/authenticated')
ok(!/DELETE FROM|INSERT INTO|TRUNCATE/.test(fn), 'não apaga nem insere nada')
ok((fn.match(/UPDATE /g) ?? []).length === 1 && /UPDATE projetos_obra_tarefa t SET custo_previsto = f\.valor/.test(fn)
  && /t\.company_id = c;/.test(fn), 'só atualiza custo_previsto das tarefas da 006')
ok(!/erp_pagar|erp_receber|erp_nfse|erp_lancamentos|pagar_id/.test(fn), 'não toca financeiro nem fiscal')
ok(/o\.numero LIKE 'DEMO-OB-%'/.test(fn), "só as obras DEMO-OB-% (a FC já semeia o próprio custo)")
ok(/sum\(i\.quantidade_contratada \* i\.custo_unitario_previsto\)/.test(fn) && /i\.excluido_em IS NULL/.test(fn),
  'custo da obra = Σ itens (sem excluídos)')
ok(/ARRAY\[5, 35, 40, 20\]/.test(fn) && /WHEN rev = 1/.test(fn), 'pesos 5/35/40/20 e o resto na última etapa')

const patch = mig.slice(mig.indexOf('DO $do$'))
ok(/pg_get_functiondef\('public\.fn_demo_seed_construtora\(uuid\)'::regprocedure\)/.test(patch)
  && /IF v_new = v_def THEN RAISE EXCEPTION/.test(patch), 'patch por âncora no fn_demo_seed_construtora (aborta se a âncora sumir)')
ok(/fn_demo_seed_construtora_fc\(c, ''semear''\);\\n  PERFORM fn_demo_seed_construtora_custo_tarefa\(c\)/.test(patch), 'roda depois da semente FC')
const agora = patch.slice(patch.indexOf('-- aplica agora'))
ok(/PERFORM public\.fn_demo_seed_construtora_custo_tarefa\(/.test(agora) && !/fn_demo_seed_construtora\('/.test(agora),
  'aplicação imediata roda só a função nova (não o reset inteiro)')

// regra de repartição em centavos, contra os custos reais da DEMO (Σ itens, 24/10)
const pesos = [5, 35, 40, 20]
const repartir = (total: number) => {
  const cents = Math.round(total * 100)
  const partes = pesos.slice(0, 3).map((p) => Math.round(cents * p / 100))
  return [...partes, cents - partes.reduce((a, b) => a + b, 0)].map((v) => v / 100)
}
const casos: [string, number, number[]][] = [
  ['DEMO-OB-001', 29419.55, [1470.98, 10296.84, 11767.82, 5883.91]],
  ['DEMO-OB-002', 45504.75, [2275.24, 15926.66, 18201.90, 9100.95]],
  ['DEMO-OB-003', 38121.70, [1906.09, 13342.60, 15248.68, 7624.33]],
  ['DEMO-OB-004', 32010.30, [1600.52, 11203.61, 12804.12, 6402.05]],
]
for (const [obra, total, esperado] of casos) {
  const r = repartir(total)
  const soma = Math.round(r.reduce((a, b) => a + b, 0) * 100) / 100
  ok(r.every((v, i) => v === esperado[i]) && soma === total, `${obra}: ${r.join(' + ')} = ${total}`)
}

if (falhas) { console.error(`\n${falhas} falha(s) na semente do custo das tarefas da Construtora DEMO`); process.exit(1) }
console.log('\nSemente do custo previsto das tarefas da Construtora DEMO: ok')

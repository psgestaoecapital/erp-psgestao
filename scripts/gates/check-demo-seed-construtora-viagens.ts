// Gate (Hub · semente da Construtora DEMO, parte 2 — viagens e contrato de preços, 24/10). Sem rede. A semente extra:
//  · só age na empresa demo do Hub (…0006) e só se is_demo; sem GRANT a usuário;
//  · todo DELETE é escopado por company_id da demo; a tabela de preço apagada é só a FIXA da semente;
//  · nunca apaga plano de contas, contas a pagar ou fiscal; para se houver viagem ligada ao contas a pagar;
//  · lançamento de viagem nasce SEM título no contas a pagar (isso é a GE das viagens);
//  · 2 viagens (1 fechada com evento oficial, 1 aberta) e 1 contrato de preços com faixas, condições e códigos;
//  · liga no fn_demo_seed_construtora por âncora (aborta se a âncora sumir), limpando ANTES de apagar as obras.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261024010000_demo_seed_construtora_viagens_tabela_preco.sql', 'utf8')
const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_extras'),
  mig.indexOf('REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_extras'))

ok(/c constant uuid := 'b0700000-0000-4000-a000-000000000006'/.test(fn), 'semente fixa na empresa demo do Hub')
ok(/p_company_id IS DISTINCT FROM c/.test(fn) && /is_demo IS TRUE/.test(fn), 'só age na 006 e só se for demo')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_construtora_extras\(uuid, text\) FROM PUBLIC, anon, authenticated/.test(mig), 'sem GRANT a usuário')
ok(!/GRANT EXECUTE[^;]*(authenticated|anon)/.test(mig), 'nenhum GRANT a anon/authenticated')

const dels = [...fn.matchAll(/DELETE FROM [\s\S]*?;/g)].map((m) => m[0])
ok(dels.length === 5 && dels.every((d) => /company_id = c;$/.test(d)), 'todo DELETE é escopado por company_id da demo')
ok(dels.filter((d) => /erp_tabela_preco/.test(d)).every((d) => /(tabela_id|id) = tp AND/.test(d)), 'só a tabela de preço FIXA da semente é apagada')
ok(!dels.some((d) => /erp_plano_contas|erp_pagar|erp_receber|erp_nfse|erp_lancamentos|erp_centros_custo|erp_clientes/.test(d)),
  'nunca apaga plano de contas, financeiro, fiscal ou cliente')
ok(/pagar_id IS NOT NULL\) THEN\s+RAISE EXCEPTION/.test(fn), 'para se houver viagem ligada ao contas a pagar')
ok(!/pagar_id\s*,/.test(fn.slice(fn.indexOf("'semear'"))), 'lançamento de viagem nasce sem título no contas a pagar')
ok(/NOT EXISTS \(SELECT 1 FROM erp_plano_contas e WHERE e\.company_id = c AND e\.codigo = g\.codigo\)/.test(fn)
  && /'Deslocamento e viagem'/.test(fn), 'plano de contas: só o que falta + Deslocamento e viagem')
ok((fn.match(/INSERT INTO erp_viagem \(/g) ?? []).length === 2, '2 viagens')
ok(/status = 'fechada'/.test(fn) && /'viagem_fechada'/.test(fn) && /fn_viagem_resumo\(v_v1\)/.test(fn), 'viagem 1 fechada com o evento e o resumo oficiais')
for (const t of ['erp_tabela_preco_cliente', 'erp_tabela_preco_item', 'erp_tabela_preco_condicao', 'erp_tabela_preco_codigo']) {
  ok(new RegExp(`INSERT INTO ${t} `).test(fn), `contrato de preços: ${t}`)
}

const patch = mig.slice(mig.indexOf('DO $do$'))
ok(/pg_get_functiondef\('public\.fn_demo_seed_construtora\(uuid\)'::regprocedure\)/.test(patch)
  && (patch.match(/IF v_new = v_def THEN RAISE EXCEPTION/g) ?? []).length === 3, 'patch por âncora no fn_demo_seed_construtora (aborta se a âncora sumir)')
ok(/fn_demo_seed_construtora_extras\(c, ''limpar''\);\\n  DELETE FROM projetos_obra_tarefa_dependencia/.test(patch), 'limpa as viagens ANTES de apagar as obras')
ok(/fn_demo_seed_construtora_extras\(c, ''semear''\);\\n  RETURN/.test(patch), 'semeia depois das obras')

if (falhas) { console.error(`\n${falhas} falha(s) na semente de viagens/contrato da Construtora DEMO`); process.exit(1) }
console.log('\nSemente de viagens e contrato de preços da Construtora DEMO: ok')

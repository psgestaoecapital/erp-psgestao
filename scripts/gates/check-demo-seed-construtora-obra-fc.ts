// Gate (Hub · semente da Construtora DEMO, parte 3 — obra "cara de FC": piso industrial uretano/epóxi, 25/10). Sem rede.
// A semente da obra FC:
//  · só age na empresa demo do Hub (…0006) e só se is_demo; sem GRANT a usuário;
//  · 'limpar' apaga só a tabela de preço FIXA desta semente (…e0002), escopada por company_id;
//  · nunca apaga plano de contas, financeiro, fiscal ou cliente; nunca cria título no contas a pagar;
//  · contrato do cliente com faixas × regimes × códigos, e os itens da obra saem do PREÇO DO CONTRATO (faixa pela quantidade);
//  · obra com orçamento aprovado, cronograma com dependências e custo previsto por etapa, apontamentos e 1 viagem fechada;
//  · códigos dos serviços/mão de obra fora de 'DEMO-S%'/'DEMO-M%' (não desloca os arrays da semente principal);
//  · liga no fn_demo_seed_construtora por âncora (aborta se a âncora sumir): limpa ANTES de apagar as obras, semeia depois.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261025080000_demo_seed_construtora_obra_fc_piso.sql', 'utf8')
const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_fc'),
  mig.indexOf('REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_fc'))
const semear = fn.slice(fn.indexOf("p_etapa IS DISTINCT FROM 'semear'"))

ok(/c constant uuid := 'b0700000-0000-4000-a000-000000000006'/.test(fn), 'semente fixa na empresa demo do Hub')
ok(/p_company_id IS DISTINCT FROM c/.test(fn) && /is_demo IS TRUE/.test(fn), 'só age na 006 e só se for demo')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_construtora_fc\(uuid, text\) FROM PUBLIC, anon, authenticated/.test(mig), 'sem GRANT a usuário')
ok(!/GRANT EXECUTE[^;]*(authenticated|anon)/.test(mig), 'nenhum GRANT a anon/authenticated')

const dels = [...fn.matchAll(/DELETE FROM [\s\S]*?;/g)].map((m) => m[0])
ok(dels.length === 6 && dels.every((d) => /erp_tabela_preco_\w+ WHERE (tabela_id|id) = tp AND company_id = c;$/.test(d)
  || /erp_medicao_cliente(_item)? WHERE company_id = c AND [^;]*;$/.test(d)),
  'limpar apaga só a tabela de preço FIXA da semente e a medição demo da …e0001, escopadas por company_id')
ok(!/DELETE FROM/.test(semear), 'semear não apaga nada')
ok(!/erp_pagar|erp_receber|erp_nfse|erp_lancamentos|pagar_id/.test(fn), 'não toca financeiro nem fiscal')
ok(/tp constant uuid := 'b0700000-0000-4000-a000-0000000e0002'/.test(fn), 'tabela de preço com id fixo próprio (não colide com a …e0001)')

for (const t of ['erp_tabela_preco_cliente', 'erp_tabela_preco_item', 'erp_tabela_preco_condicao', 'erp_tabela_preco_codigo']) {
  ok(new RegExp(`INSERT INTO ${t} `).test(semear), `contrato de preços: ${t}`)
}
ok(/'noturno', 25\), \(c, tp, 'sabado', 50\), \(c, tp, 'domingo_feriado', 100\)/.test(semear), 'regimes: noturno, sábado, domingo/feriado')
ok(/JOIN erp_tabela_preco_item ti ON ti\.tabela_id = tp AND ti\.servico_ref = s\.codigo\s+AND q\.qtd >= ti\.faixa_de AND \(ti\.faixa_ate IS NULL OR q\.qtd < ti\.faixa_ate\)/.test(semear),
  'itens da obra a preço do contrato (faixa pela quantidade)')
ok(/'DEMO-FC-S0\d'/.test(fn) && !/'DEMO-S\d/.test(fn) && /'DEMO-FC-M0\d'/.test(fn) && !/'DEMO-M\d/.test(fn),
  "serviços e mão de obra fora de 'DEMO-S%'/'DEMO-M%'")
ok(/'DEMO-FC-001'/.test(fn) && !/'DEMO-OB-/.test(fn), "obra DEMO-FC-001 (fora do laço 'DEMO-OB-%' da semente principal)")
ok(/'rascunho'[\s\S]*UPDATE projetos_obras SET orcamento_id = v_orc[\s\S]*SET status = 'aprovado'/.test(semear),
  'orçamento: rascunho → obra aponta → aprovado (o gatilho não cria outra obra)')
ok((semear.match(/INSERT INTO projetos_obra_tarefa \(/g) ?? []).length === 6 && /INSERT INTO projetos_obra_tarefa_dependencia/.test(semear)
  && /SET custo_previsto = x\.custo/.test(semear), 'cronograma: 6 etapas, dependências e custo previsto por etapa')
ok(/INSERT INTO projetos_obra_mao_obra_apontamento/.test(semear) && /extract\(isodow FROM d\) < 7/.test(semear), 'apontamentos de segunda a sábado')
ok((semear.match(/INSERT INTO erp_viagem \(/g) ?? []).length === 1 && /status = 'fechada'/.test(semear)
  && /'viagem_fechada'/.test(semear) && /fn_viagem_resumo\(v_via\)/.test(semear), 'viagem da equipe fechada com o evento e o resumo oficiais')
ok(/pct_conclusao = LEAST\(100, round\(valor_medido \/ NULLIF\(valor_previsto, 0\) \* 100\)\)/.test(semear), '% de conclusão sai do medido')

const patch = mig.slice(mig.indexOf('DO $do$'))
ok(/pg_get_functiondef\('public\.fn_demo_seed_construtora\(uuid\)'::regprocedure\)/.test(patch)
  && (patch.match(/IF v_new = v_def THEN RAISE EXCEPTION/g) ?? []).length === 2, 'patch por âncora no fn_demo_seed_construtora (aborta se a âncora sumir)')
ok(/fn_demo_seed_construtora_fc\(c, ''limpar''\);\\n  PERFORM fn_demo_seed_construtora_extras\(c, ''limpar''\)/.test(patch), 'limpa ANTES de apagar as obras')
ok(/fn_demo_seed_construtora_extras\(c, ''semear''\);\\n  PERFORM fn_demo_seed_construtora_fc\(c, ''semear''\)/.test(patch), 'semeia depois das viagens/plano de contas')

if (falhas) { console.error(`\n${falhas} falha(s) na semente da obra FC da Construtora DEMO`); process.exit(1) }
console.log('\nSemente da obra de piso industrial (FC) da Construtora DEMO: ok')

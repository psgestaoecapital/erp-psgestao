// Gate (Hub · durabilidade da DEMO da Construtora, 23/10). Sem rede. A semente:
//  · só age na empresa demo do Hub (…0006) e só se is_demo; sem GRANT a usuário;
//  · todo DELETE é escopado por company_id da demo e nada fiscal/financeiro é apagado;
//  · encadeia a base + cronograma e irriga apontamentos, orçamentos, plantas e visitas;
//  · liga no fn_demo_reset por âncora (corpo vigente preservado, aborta se a âncora sumir);
//  · o Montar do banco de testes reseta a 006.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261023233000_demo_seed_construtora.sql', 'utf8')
const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora'), mig.indexOf('REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora'))

ok(/c constant uuid := 'b0700000-0000-4000-a000-000000000006'/.test(fn), 'seed fixo na empresa demo do Hub')
ok(/p_company_id IS DISTINCT FROM c/.test(fn) && /is_demo IS TRUE/.test(fn), 'só age na 006 e só se for demo')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_construtora\(uuid\) FROM PUBLIC, anon, authenticated/.test(mig), 'sem GRANT a usuário')
ok(!/GRANT EXECUTE[^;]*(authenticated|anon)/.test(mig), 'nenhum GRANT a anon/authenticated')
const dels = [...fn.matchAll(/DELETE FROM [\s\S]*?;/g)].map((m) => m[0])
ok(dels.length > 0 && dels.every((d) => /WHERE company_id = c;$/.test(d)), 'todo DELETE é escopado por company_id da demo')
ok(!dels.some((d) => /erp_pagar|erp_receber|erp_nfse|erp_lancamentos|erp_viagem|erp_centros_custo/.test(d)), 'nada fiscal/financeiro é apagado')
ok(/obra_demo_com_fiscal_ou_viagem/.test(fn), 'para sem mexer se houver NFS-e/viagem ligada à obra demo')
ok(/fn_gold_hub_seed_reparar\(c\)/.test(fn) && /fn_gold_hub_cronograma_seed_reparar\(c\)/.test(fn), 'encadeia base + cronograma')
for (const t of ['projetos_obra_mao_obra_apontamento', 'erp_orcamentos', 'erp_orcamentos_itens', 'erp_obra_planta', 'erp_obra_planta_ambiente', 'erp_crm_visita']) {
  ok(new RegExp(`INSERT INTO ${t} `).test(fn), `irriga ${t}`)
}
ok(/UPDATE projetos_obras SET orcamento_id = v_orc/.test(fn) && fn.indexOf('orcamento_id = v_orc') < fn.indexOf("status = 'aprovado'"),
  'obra aponta para o orçamento ANTES de aprovar (o gatilho não cria obra duplicada)')
ok(/valor_previsto = COALESCE\(\(SELECT round\(sum\(i\.quantidade_contratada \* i\.preco_unitario\)/.test(fn), 'valor previsto = soma dos itens')
ok(/fn_obra_recalcular_medido\(v_obra\.id\)/.test(fn), 'valor medido pela função oficial')
ok(/'confirmada'/.test(fn), "planta entra 'confirmada' (não dispara a medição de uso do takeoff)")

ok(/pg_get_functiondef\('public\.fn_demo_reset\(uuid\)'::regprocedure\)/.test(mig) && /THEN ''fn_demo_seed_construtora''/.test(mig)
  && /IF v_new = v_def THEN RAISE EXCEPTION/.test(mig), 'ligada no fn_demo_reset por âncora (aborta se a âncora sumir)')

// 24/10 (caixa 61297941): planta de takeoff em TODAS as obras demo, por patch de âncora sobre o corpo vivo
const plantas = readFileSync('supabase/migrations/20261024031000_demo_seed_construtora_plantas_todas_obras.sql', 'utf8')
ok(/IF v_obra\.n <= 2 THEN/.test(plantas) && /IF v_obra\.n >= 1 THEN/.test(plantas) && /IF v_new = v_def THEN\s+RAISE EXCEPTION/.test(plantas),
  'planta de takeoff em todas as obras demo (aborta se a âncora sumir)')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_construtora\(uuid\) FROM PUBLIC, anon, authenticated/.test(plantas)
  && !/GRANT EXECUTE[^;]*(authenticated|anon)/.test(plantas), 'patch das plantas segue sem GRANT a usuário')

const mbt = readFileSync('.github/workflows/montar-banco-testes.yml', 'utf8')
ok(/emp=b0700000-0000-4000-a000-000000000006\n\s+if ! psql "\$TEST_DATABASE_URL"[^\n]*fn_demo_reset\('\$emp'\)/.test(mbt), 'Montar do banco de testes reseta a Construtora DEMO')

if (falhas) { console.error(`\n${falhas} falha(s) na semente da Construtora DEMO`); process.exit(1) }
console.log('\nSemente durável da Construtora DEMO: ok')

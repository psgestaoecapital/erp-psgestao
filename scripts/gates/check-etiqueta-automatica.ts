// Gate (Eng. Chefe 14/10) — a etiqueta revisao-eng-chefe é posta por CONTEÚDO e a fila nunca publica essas PRs pela via rápida.
import { readFileSync } from 'node:fs'
import { exigeViaRevisada } from '../merge/exige-via-revisada'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// Modelo CEO 21/10: PRODUTO NOVO/aditivo publica DIRETO; só o núcleo crítico (fiscal, financeiro-cliente, RLS/LGPD,
// migration não-aditiva, cálculo) espera verde — pelo CONTEÚDO, com viés de segurança.
const AD = `CREATE TABLE public.hub_x (id uuid primary key, company_id uuid, nome text);
  ALTER TABLE public.hub_x ENABLE ROW LEVEL SECURITY;
  CREATE POLICY p ON public.hub_x FOR SELECT TO authenticated USING (true);
  CREATE OR REPLACE FUNCTION public.fn_hub_x() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;
  GRANT EXECUTE ON FUNCTION public.fn_hub_x() TO authenticated;`
// — DIRETO (Mundo 1) —
ok(!exigeViaRevisada(['src/app/dashboard/obras/page.tsx']).revisada, 'tela nova → publica direto')
ok(!exigeViaRevisada(['supabase/functions/x/index.ts']).revisada, 'edge function genérica → direto')
ok(!exigeViaRevisada([{ nome: 'supabase/migrations/1_hub.sql', conteudo: AD }]).revisada, 'migration aditiva (cria tabela/função/RLS NOVAS) → direto')
ok(!exigeViaRevisada([{ nome: 'supabase/migrations/2_ajuda.sql', conteudo: "INSERT INTO public.erp_ajuda_campo (chave) VALUES ('x');\nINSERT INTO public.module_catalog (id) VALUES ('y');" }]).revisada, 'INSERT em ajuda/menu → direto')
ok(!exigeViaRevisada(['docs/x.md', '.github/workflows/a.yml', 'e2e/jornadas/a.spec.ts']).revisada, 'docs/CI/e2e → direto')
ok(!exigeViaRevisada(['scripts/gates/check-x.ts']).revisada, 'script/gate → direto')
ok(!exigeViaRevisada([]).revisada, 'sem arquivos → direto')
// — CRÍTICO (espera verde) —
ok(exigeViaRevisada(['src/app/dashboard/financeiro/dre/page.tsx']).revisada, 'tela de financeiro (área crítica no caminho) → revisada')
ok(exigeViaRevisada(['src/lib/preco/calculo-markup.ts']).revisada, 'cálculo financeiro → revisada')
ok(exigeViaRevisada(['src/lib/nfe/montar-xml.ts']).revisada, 'fiscal/NF-e no caminho → revisada')
ok(exigeViaRevisada([{ nome: 'supabase/migrations/3.sql', conteudo: 'ALTER TABLE public.erp_clientes ADD COLUMN z text;' }]).revisada, 'ALTER em tabela existente → revisada')
ok(exigeViaRevisada([{ nome: 'supabase/migrations/4.sql', conteudo: 'DROP TABLE antiga;' }]).revisada, 'DROP → revisada')
ok(exigeViaRevisada([{ nome: 'supabase/migrations/5.sql', conteudo: 'DELETE FROM public.config WHERE k=1;' }]).revisada, 'DELETE em dado existente → revisada')
ok(exigeViaRevisada([{ nome: 'supabase/migrations/6.sql', conteudo: 'UPDATE public.clientes SET ativo=true;' }]).revisada, 'UPDATE em dado existente → revisada')
ok(exigeViaRevisada([{ nome: 'supabase/migrations/7.sql', conteudo: 'CREATE TABLE nova(id uuid); CREATE POLICY p ON public.titulos FOR SELECT USING (true);' }]).revisada, 'RLS em tabela existente (titulos) → revisada')
ok(exigeViaRevisada([{ nome: 'supabase/migrations/8_nfe_x.sql', conteudo: 'CREATE TABLE y(id uuid);' }]).revisada, 'migration de nome fiscal (nfe) → revisada')
ok(exigeViaRevisada([{ nome: 'supabase/migrations/9.sql' }]).revisada, 'migration SEM conteúdo p/ avaliar → revisada (viés de segurança)')
ok(exigeViaRevisada([{ nome: 'supabase/migrations/10.sql', conteudo: 'CREATE OR REPLACE VIEW v_saldo AS SELECT 1;' }]).revisada, 'CREATE OR REPLACE VIEW → revisada')
ok(exigeViaRevisada([{ nome: 'supabase/migrations/12.sql', conteudo: 'CREATE OR REPLACE FUNCTION fn_pagar() RETURNS void AS $$ BEGIN UPDATE public.titulo SET pago=true; END $$ LANGUAGE plpgsql;' }]).revisada, 'RPC que mexe em titulo (crítico) → revisada')
// RPC que mexe em tabela NÃO-crítica dentro do corpo = produto novo → direto (caso #2942 cronômetro)
ok(!exigeViaRevisada([{ nome: 'supabase/migrations/13.sql', conteudo: 'CREATE TABLE public.prod_tarefa_tempo(id uuid); DROP POLICY IF EXISTS p ON public.prod_tarefa_tempo; CREATE POLICY p ON public.prod_tarefa_tempo FOR SELECT USING (true); CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN UPDATE public.prod_tarefa SET cap_hora=1; END $$ LANGUAGE plpgsql; REVOKE ALL ON FUNCTION f() FROM anon;' }]).revisada, 'RPC que mexe em prod_tarefa (não-crítica) + DROP POLICY IF EXISTS + REVOKE → direto')
// Financeiro de cliente DENTRO do corpo de função (gap do incidente 21/10) → revisada, mesmo "aditivo"
ok(exigeViaRevisada([{ nome: 'supabase/migrations/14.sql', conteudo: 'CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN INSERT INTO public.erp_contratos(id) VALUES (gen_random_uuid()); INSERT INTO public.agency_comissao(id) VALUES (gen_random_uuid()); END $$ LANGUAGE plpgsql;' }]).revisada, 'RPC que cria contrato/comissão do cliente → revisada (#2613)')
ok(exigeViaRevisada([{ nome: 'supabase/migrations/15.sql', conteudo: 'CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN UPDATE public.erp_pedidos SET obra_id=1; END $$ LANGUAGE plpgsql;' }]).revisada, 'RPC que altera pedido do cliente → revisada (#2896)')

const y = readFileSync('.github/workflows/etiquetar-revisao.yml', 'utf8').replace(/^\s*#.*$/gm, '')
ok(/pull_request_target:\s*\n\s*types:\s*\[opened, reopened, synchronize, ready_for_review\]/.test(y) && !/\n\s+pull_request:/.test(y), 'pull_request_target (código da main)')
const co = [...y.matchAll(/uses: actions\/checkout@[^\n]*\n((?:\s+with:\n(?:\s+[^\n]*\n)*)?)/g)]
ok(co.length === 1 && /base\.ref/.test(co[0][1]) && !/head\.(sha|ref)/.test(co[0][1]), 'único checkout é o da BASE')
ok(/exige-via-revisada\.ts/.test(y) && /labels\[\]=revisao-eng-chefe/.test(y) && !/-X DELETE/.test(y), 'coloca a etiqueta e nunca a tira')
const f = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
ok(/exige-via-revisada\.ts/.test(f) && /ponho \$SENSIVEL e espero/.test(f), 'fila não publica pela via rápida PR de conteúdo sensível sem etiqueta')
ok(/etiquetar-revisao\.yml/.test(readFileSync('AGENTS.md', 'utf8')), 'AGENTS.md documenta etiquetar-revisao.yml')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nEtiqueta automática: ok')

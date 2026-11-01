/**
 * Gate de build · chamado #3866 (Jordana · Troian): o corte do histórico importado vale SÓ para a empresa configurada
 * em erp_empresa_corte_historico. Na empresa com corte, título vencido e pago antes da data fica só para consulta
 * (fora do saldo e do "Sem conta"); pagamento a partir do corte conta. Empresa sem linha = cálculo de antes.
 * Migration: supabase/migrations/<versão>_corte_historico_importado_troian.sql (procurada pelo sufixo).
 */
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const arq = readdirSync('supabase/migrations').find((f) => f.endsWith('_corte_historico_importado_troian.sql'))
ok(!!arq, 'migration do corte do histórico por empresa existe')
const sql = arq ? readFileSync(`supabase/migrations/${arq}`, 'utf8') : ''
const s = sql.replace(/\s+/g, ' ')

// configuração por empresa, com RLS e sem escrita pelo logado
ok(/CREATE TABLE IF NOT EXISTS public\.erp_empresa_corte_historico/.test(s), 'tabela de corte por empresa')
ok(s.includes('ALTER TABLE public.erp_empresa_corte_historico ENABLE ROW LEVEL SECURITY'), 'RLS ligada')
ok(s.includes('REVOKE ALL ON public.erp_empresa_corte_historico FROM PUBLIC, anon, authenticated'), 'REVOKE de anon/authenticated')
ok(s.includes('GRANT SELECT ON public.erp_empresa_corte_historico TO authenticated'), 'logado só lê')
ok(/FOR SELECT TO authenticated USING \(public\.is_admin\(\) OR company_id IN \(SELECT public\.get_user_company_ids\(\)\)\)/.test(s), 'leitura só da própria empresa')
ok(!/FOR (INSERT|UPDATE|DELETE|ALL)/.test(s), 'nenhuma policy de escrita')

// só a Troian recebe corte, em 01/10/2026; nenhuma outra empresa
const inserts = s.match(/INSERT INTO public\.erp_empresa_corte_historico[^;]*;/g) ?? []
ok(inserts.length === 1, 'um único INSERT de configuração')
ok(!!inserts[0]?.includes("'d577602d-b21a-4d97-ae59-401777383c23'") && !!inserts[0]?.includes("DATE '2026-10-01'"), 'Troian com corte em 01/10/2026')
ok(!/UPDATE public\.erp_(receber|pagar)|DELETE FROM public\.erp_(receber|pagar)/.test(s), 'nenhum título importado é alterado ou apagado')

// a função: corte por LEFT JOIN na configuração (sem linha = sem corte), vencimento E pagamento antes do corte
ok(s.includes('CREATE OR REPLACE FUNCTION public.fn_saldo_gerencial_contas(p_company_ids uuid[])'), 'mesma assinatura da função de saldo')
ok(s.includes('FROM erp_empresa_corte_historico ch WHERE ch.company_id = ANY(v_ids)'), 'corte lido da configuração da empresa')
ok(!/MIN\(\s*data_saldo_inicial\s*\)/i.test(s), 'não usa a menor data de saldo inicial (regra da PR #2924 descartada)')
const filtro = 'WHERE k.dc IS NULL OR l.d >= k.dc OR COALESCE(l.venc, l.d) >= k.dc'
ok(s.split(filtro).length - 1 === 2, 'recebido e pago filtrados: sem corte, pago a partir do corte ou vencimento a partir do corte')
ok(/rlan AS \( SELECT l\.id, l\.cid, l\.conta, l\.v, l\.d FROM rlan0 l LEFT JOIN corte k/.test(s), 'LEFT JOIN: empresa sem corte mantém todos os lançamentos (recebido)')
ok(/plan AS \( SELECT l\.id, l\.cid, l\.nkey, l\.v, l\.d FROM plan0 l LEFT JOIN corte k/.test(s), 'LEFT JOIN: empresa sem corte mantém todos os lançamentos (pago)')
ok(s.includes('er.data_vencimento AS venc') && s.includes('ep.data_vencimento AS venc'), 'critério pelo VENCIMENTO do título')
ok(/FROM rlan l WHERE l\.cid = vid AND l\.conta IS NULL/.test(s), '"Sem conta" lê os lançamentos já cortados')

// guarda e grants iguais
ok(s.includes('SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids())'), 'guarda de empresa preservada')
ok(s.includes('REVOKE ALL ON FUNCTION public.fn_saldo_gerencial_contas(uuid[]) FROM PUBLIC, anon, authenticated'), 'função sem acesso de anon/authenticated')
ok(s.includes('GRANT EXECUTE ON FUNCTION public.fn_saldo_gerencial_contas(uuid[]) TO service_role'), 'só service_role executa')

// simulação da regra (mesmo predicado da migration)
type L = { d: string; venc: string | null }
const conta = (l: L, dc: string | null) => dc === null || l.d >= dc || (l.venc ?? l.d) >= dc
ok(conta({ d: '2025-03-10', venc: '2025-03-05' }, null), 'empresa sem corte: histórico continua contando (igual a hoje)')
ok(!conta({ d: '2025-03-10', venc: '2025-03-05' }, '2026-10-01'), 'Troian: vencido e pago antes de 01/10 → só consulta')
ok(conta({ d: '2026-10-03', venc: '2026-09-20' }, '2026-10-01'), 'Troian: vencido antes, pago a partir de 01/10 → conta no saldo')
ok(conta({ d: '2026-10-05', venc: '2026-10-10' }, '2026-10-01'), 'Troian: vencimento a partir de 01/10 → conta')

if (falhas) { console.error(`\n${falhas} falha(s) no gate do corte do histórico por empresa (#3866)`); process.exit(1) }
console.log('✓ #3866: corte do histórico importado só na empresa configurada')
